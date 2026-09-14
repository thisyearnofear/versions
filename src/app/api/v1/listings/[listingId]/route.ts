// MODULAR: Single listing. Public read; owner-only status control.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';
import { ListingStatusUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ listingId: string }> }) {
  const requestId = requestIdFor(req);
  const { listingId } = await ctx.params;
  const listing = await services().listings.get(listingId);
  if (!listing) {
    return errorResponse(requestId, 404, 'LISTING_NOT_FOUND', 'No listing with that id.');
  }
  return successResponse(200, { listing }, requestId);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ listingId: string }> }) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to manage this listing.');
  }
  const { listingId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(requestId, 400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const parsed = ListingStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      400,
      'INVALID_STATUS',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '),
    );
  }

  const result = await services().listings.setStatus(listingId, identity.wallet, parsed.data.status);
  if (!result.ok) {
    const status = result.code === 'LISTING_NOT_FOUND' ? 404 : 400;
    return errorResponse(requestId, status, result.code, result.message);
  }
  return successResponse(200, { listing: result.listing }, requestId);
}
