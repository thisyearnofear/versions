// MODULAR: initial payload for the EconomyTicker. Live updates arrive over
// SSE (/api/events, economy-event), but a judge landing on the page
// shouldn't stare at an empty feed — this route replays the most recent
// economy activity from the DB in the same normalized shape the bus emits.

import type { NextRequest } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import {
  agentReviews,
  arPlayEvents,
  settlementLegs,
  submissions,
  x402Proofs,
} from '../../../../lib/schema';
import type { EconomyEvent } from '../../../../lib/event-bus';
import { jsonResponse, requestIdFor } from '../../../../lib/services';

export const dynamic = 'force-dynamic';

const PER_KIND = 5;
const TOTAL = 12;

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
    // Each query is independent — a failure in one (e.g. a table not
    // existing on a fresh deploy) doesn't kill the whole route.
    const [reviewRes, tipRes, batchRes, legRes, playRes] = await Promise.allSettled([
      db
        .select({
          submissionId: agentReviews.submissionId,
          agentName: agentReviews.agentName,
          solo: agentReviews.soloIntensity,
          vocal: agentReviews.vocalQuality,
          energy: agentReviews.energyVsStudio,
          tempo: agentReviews.tempoFeel,
          notes: agentReviews.notes,
          submittedAt: agentReviews.submittedAt,
          title: submissions.title,
          artistName: submissions.artistName,
        })
        .from(agentReviews)
        .leftJoin(submissions, eq(submissions.id, agentReviews.submissionId))
        .orderBy(desc(agentReviews.submittedAt))
        .limit(PER_KIND),

      db
        .select({
          tipperWallet: x402Proofs.tipperWallet,
          artistWallet: x402Proofs.artistWallet,
          amountMicroUsdc: x402Proofs.amountMicroUsdc,
          createdAt: x402Proofs.createdAt,
        })
        .from(x402Proofs)
        .where(eq(x402Proofs.status, 'verified'))
        .orderBy(desc(x402Proofs.createdAt))
        .limit(PER_KIND),

      db
        .select({
          txHash: x402Proofs.txHash,
          artistWallet: x402Proofs.artistWallet,
          settledCount: sql<number>`COUNT(*)::int`,
          totalMicro: sql<string>`SUM(CAST(${x402Proofs.amountMicroUsdc} AS NUMERIC))`,
          // Raw SQL aggregates bypass drizzle's timestamp mapping and
          // come back as strings — normalized to Date in the map below.
          settledAt: sql<string | null>`MAX(${x402Proofs.settledAt})`,
        })
        .from(x402Proofs)
        .where(eq(x402Proofs.status, 'settled'))
        .groupBy(x402Proofs.txHash, x402Proofs.artistWallet)
        .orderBy(desc(sql`MAX(${x402Proofs.settledAt})`))
        .limit(PER_KIND),

      db
        .select({
          submissionId: settlementLegs.submissionId,
          recipientRole: settlementLegs.recipientRole,
          recipientWallet: settlementLegs.recipientWallet,
          amountUsdc: settlementLegs.amountUsdc,
          txHash: settlementLegs.txHash,
          settledAt: settlementLegs.settledAt,
        })
        .from(settlementLegs)
        .where(eq(settlementLegs.status, 'settled'))
        .orderBy(desc(settlementLegs.settledAt))
        .limit(PER_KIND),

      db
        .select({
          versionId: arPlayEvents.versionId,
          playType: arPlayEvents.playType,
          artistWallet: arPlayEvents.artistWallet,
          artistPayoutUsdc: arPlayEvents.artistPayoutUsdc,
          listenerTxHash: arPlayEvents.listenerTxHash,
          artistTxHash: arPlayEvents.artistTxHash,
          playedAt: arPlayEvents.playedAt,
        })
        .from(arPlayEvents)
        .where(eq(arPlayEvents.status, 'settled'))
        .orderBy(desc(arPlayEvents.playedAt))
        .limit(PER_KIND),
    ]);

    const reviewRows = reviewRes.status === 'fulfilled' ? reviewRes.value : [];
    const tipRows = tipRes.status === 'fulfilled' ? tipRes.value : [];
    const batchRows = batchRes.status === 'fulfilled' ? batchRes.value : [];
    const legRows = legRes.status === 'fulfilled' ? legRes.value : [];
    const playRows = playRes.status === 'fulfilled' ? playRes.value : [];

    const events: EconomyEvent[] = [
      ...reviewRows.map((r) => ({
        kind: 'review' as const,
        submissionId: r.submissionId,
        agentName: r.agentName,
        title: r.title,
        artistName: r.artistName,
        solo: r.solo,
        vocal: r.vocal,
        energy: r.energy,
        tempo: r.tempo,
        notes: r.notes,
        timestamp: r.submittedAt.toISOString(),
      })),
      ...tipRows.map((t) => ({
        kind: 'tip' as const,
        fromWallet: t.tipperWallet,
        toWallet: t.artistWallet,
        amountUsdc: (Number(t.amountMicroUsdc) / 1_000_000).toFixed(6),
        timestamp: t.createdAt.toISOString(),
      })),
      ...batchRows.map((b) => ({
        kind: 'tip_batch_settled' as const,
        toWallet: b.artistWallet,
        amountUsdc: (Number(b.totalMicro ?? 0) / 1_000_000).toFixed(6),
        txHash: b.txHash,
        settledCount: b.settledCount,
        timestamp: (b.settledAt ? new Date(b.settledAt) : new Date(0)).toISOString(),
      })),
      ...legRows.map((l) => ({
        kind: 'leg_settled' as const,
        submissionId: l.submissionId,
        recipientRole: l.recipientRole,
        toWallet: l.recipientWallet,
        amountUsdc: l.amountUsdc,
        txHash: l.txHash,
        timestamp: (l.settledAt ?? new Date(0)).toISOString(),
      })),
      ...playRows.map((p) => ({
        kind: 'play' as const,
        versionId: p.versionId,
        playType: p.playType,
        toWallet: p.artistWallet,
        amountUsdc: p.artistPayoutUsdc,
        listenerTxHash: p.listenerTxHash,
        artistTxHash: p.artistTxHash,
        timestamp: p.playedAt.toISOString(),
      })),
    ];

    events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return jsonResponse(200, { success: true, data: { events: events.slice(0, TOTAL) } }, rid, {
      'Cache-Control': 'no-store',
    });
  } catch (err) {
    return jsonResponse(
      500,
      { success: false, error: { code: 'ACTIVITY_FAILED', message: (err as Error).message } },
      rid,
    );
  }
}
