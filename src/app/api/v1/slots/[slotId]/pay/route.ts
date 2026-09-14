// MODULAR: Slot checkout — move a pending_payment placement to active.
// Collects the gross, mints the three-leg flat split, and emits the receipt.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor } from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ slotId: string }> }) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to pay for this placement.');
  const { slotId } = await ctx.params;

  const result = await services().slots.pay(slotId, identity.wallet);
  if (!result.ok) {
    const map: Record<string, number> = {
      SLOT_NOT_FOUND: 404,
      SLOT_NOT_PAYABLE: 409,
      SETTLEMENT_IN_PROGRESS: 409,
      SETTLEMENT_CLAIM_LOST: 409,
      PRICING_MISMATCH: 409,
      CAMPAIGN_EXHAUSTED: 409,
      PAYMENT_FAILED: 502,
    };
    return errorResponse(requestId, map[result.code] ?? 400, result.code, result.message);
  }
  return successResponse(200, { slot: result.slot, charged_usdc: result.charged_usdc, tx_hash: result.tx_hash, mock: result.mock, legs: result.legs }, requestId);
}
