// MODULAR: Slots — paid placements bought by verified channels.
//   POST → reserve a placement against a listing + channel (creates pending_payment).
//   GET  → the caller's placements (`?channelId=` or `?listingId=` adds a filter, still caller-scoped).

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor, parsePositiveIntParam } from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';
import { SlotCreateSchema } from '@/lib/validation';
import type { SlotFailureCode } from '@/services/slots';

export const dynamic = 'force-dynamic';

const STATUS_FOR_FAILURE: Record<SlotFailureCode, number> = {
  LISTING_NOT_FOUND: 404,
  LISTING_NOT_PAID: 400,
  LISTING_NOT_SERVABLE: 409,
  CHANNEL_NOT_FOUND: 404,
  CHANNEL_UNVERIFIED: 403,
  PRICING_MISMATCH: 409,
  BUDGET_REQUIRED: 400,
  INVALID_BUDGET: 400,
  BUDGET_BELOW_FEE: 400,
  CAMPAIGN_EXHAUSTED: 409,
  SLOT_NOT_FOUND: 404,
  SLOT_NOT_PAYABLE: 409,
  SETTLEMENT_IN_PROGRESS: 409,
  SETTLEMENT_CLAIM_LOST: 409,
  PAYMENT_FAILED: 502,
};

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to view your placements.');
  }
  const { searchParams } = new URL(req.url);
  const limit = parsePositiveIntParam(searchParams.get('limit'), 20, 100);
  const channelId = searchParams.get('channelId');
  const listingId = searchParams.get('listingId');

  const svc = services().slots;
  if (channelId) {
    const slots = await svc.listForChannel(channelId, { limit });
    return successResponse(200, { slots }, requestId);
  }
  if (listingId) {
    const slots = await svc.listForListing(listingId, { limit });
    return successResponse(200, { slots }, requestId);
  }
  const slots = await svc.listForBuyer(identity.wallet, { limit });
  return successResponse(200, { slots }, requestId);
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to buy a placement.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(requestId, 400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const parsed = SlotCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      400,
      'INVALID_SLOT',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '),
    );
  }

  const result = await services().slots.create({
    listingId: parsed.data.listingId,
    channelId: parsed.data.channelId,
    buyerWallet: identity.wallet,
    budgetUsdc: parsed.data.budgetUsdc ?? null,
  });
  if (!result.ok) {
    return errorResponse(requestId, STATUS_FOR_FAILURE[result.code], result.code, result.message);
  }
  const status = result.alreadyExisted ? 200 : 201;
  return successResponse(status, { slot: result.slot, alreadyExisted: result.alreadyExisted ?? false }, requestId);
}
