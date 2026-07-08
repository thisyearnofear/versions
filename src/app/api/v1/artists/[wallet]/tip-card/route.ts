import type { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  requestIdFor,
} from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

// MODULAR: slim endpoint surfaced ONLY by the TipButton hover-card.
// Returns the 3 latest published versions (energy/tempo consensus +
// rating count + mood tags) and the 5 latest x402 nanopayment tips
// the artist has received, plus aggregate totals for a footer line.
// Reuses getArtistTipCard (parallel 4-query bundle in curation.ts)
// so a fresh hover settles in one round-trip.
export async function GET(req: NextRequest, ctx: { params: Promise<{ wallet: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { wallet } = await ctx.params;
    const card = await services().curation.getArtistTipCard(wallet);
    return successResponse(200, card, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
