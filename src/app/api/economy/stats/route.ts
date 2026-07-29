// MODULAR: aggregate economy stats for the landing page live counter.
// Returns counts that the LiveStats component increments in real time
// as SSE economy events arrive. Each query is independent so a
// missing table on a fresh deploy doesn't 500 the route.

import type { NextRequest } from 'next/server';
import { eq, count, sql } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import {
  agentReviews,
  arPlayEvents,
  publishedVersions,
  settlementLegs,
  x402Proofs,
} from '../../../../lib/schema';
import { jsonResponse, requestIdFor } from '../../../../lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-request-id',
      'Access-Control-Max-Age': '600',
    },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const rid = requestIdFor(req);
  try {
    const [pubRes, reviewRes, legRes, tipRes, playRes] = await Promise.allSettled([
      db.select({ c: count() }).from(publishedVersions),
      db.select({ c: count() }).from(agentReviews),
      db
        .select({ total: sql<string>`COALESCE(SUM(${settlementLegs.amountUsdc}::numeric), 0)` })
        .from(settlementLegs)
        .where(eq(settlementLegs.status, 'settled')),
      db
        .select({ total: sql<string>`COALESCE(SUM(${x402Proofs.amountMicroUsdc}::numeric), 0)` })
        .from(x402Proofs)
        .where(eq(x402Proofs.status, 'settled')),
      db
        .select({ total: sql<string>`COALESCE(SUM(${arPlayEvents.artistPayoutUsdc}::numeric), 0)` })
        .from(arPlayEvents)
        .where(eq(arPlayEvents.status, 'settled')),
    ]);

    const tracksPublished =
      pubRes.status === 'fulfilled' ? Number(pubRes.value[0]?.c ?? 0) : 0;
    const agentReviewsCount =
      reviewRes.status === 'fulfilled' ? Number(reviewRes.value[0]?.c ?? 0) : 0;

    // Sum USDC across all settlement surfaces.
    const legsUsdc = legRes.status === 'fulfilled' ? Number(legRes.value[0]?.total ?? 0) : 0;
    const tipsUsdc = tipRes.status === 'fulfilled' ? Number(tipRes.value[0]?.total ?? 0) / 1_000_000 : 0;
    const playsUsdc = playRes.status === 'fulfilled' ? Number(playRes.value[0]?.total ?? 0) : 0;
    const usdcSettled = legsUsdc + tipsUsdc + playsUsdc;

    return jsonResponse(
      200,
      {
        success: true,
        data: {
          tracksPublished,
          agentReviews: agentReviewsCount,
          usdcSettled: usdcSettled.toFixed(2),
        },
      },
      rid,
      { 'Cache-Control': 'no-store' },
    );
  } catch {
    // Never 500 — return zeros so the landing page counter still renders.
    return jsonResponse(
      200,
      { success: true, data: { tracksPublished: 0, agentReviews: 0, usdcSettled: '0.00' } },
      rid,
    );
  }
}
