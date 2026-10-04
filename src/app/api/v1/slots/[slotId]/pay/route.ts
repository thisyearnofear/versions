// MODULAR: Slot checkout — move a pending_payment placement to active.
// Collects the gross, mints the three-leg flat split, and emits the receipt.

import { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  rateLimitedResponse,
  requestIdFor,
  clientIpFor,
  headerBag,
} from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';

export const dynamic = 'force-dynamic';

// Reject absurd keys rather than storing them: this column is unique-indexed,
// so an unbounded key is unbounded index growth.
const MAX_IDEMPOTENCY_KEY = 255;

export async function POST(req: NextRequest, ctx: { params: Promise<{ slotId: string }> }) {
  const requestId = requestIdFor(req);
  const svc = services();
  // Moves money, and the smallest cap of the three: this is the one route where
  // a retry storm would be an incident rather than a nuisance.
  if (!(await svc.slotPayLimiter.allow({ headers: headerBag(req) }, clientIpFor(req)))) {
    return rateLimitedResponse(requestId);
  }
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to pay for this placement.');
  const { slotId } = await ctx.params;

  const rawKey = req.headers.get('idempotency-key');
  if (rawKey && rawKey.length > MAX_IDEMPOTENCY_KEY) {
    return errorResponse(requestId, 400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key is too long.');
  }

  const result = await svc.slots.pay(slotId, identity.wallet, rawKey);
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
  return successResponse(
    200,
    {
      slot: result.slot,
      charged_usdc: result.charged_usdc,
      tx_hash: result.tx_hash,
      mock: result.mock,
      legs: result.legs,
      replayed: result.replayed ?? false,
    },
    requestId,
  );
}
