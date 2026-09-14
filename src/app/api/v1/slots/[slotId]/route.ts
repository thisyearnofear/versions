// MODULAR: Single slot. Detail + pause/resume (either party may take offline).

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slotId: string }> }) {
  const requestId = requestIdFor(req);
  const { slotId } = await ctx.params;
  const slot = await services().slots.get(slotId);
  if (!slot) return errorResponse(requestId, 404, 'SLOT_NOT_FOUND', 'No placement with that id.');
  const legs = await services().slots.legs(slotId);
  return successResponse(200, { slot, legs }, requestId);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slotId: string }> }) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to manage this placement.');
  const { slotId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(requestId, 400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const action = (body as { action?: string } | null)?.action;
  if (action !== 'pause' && action !== 'resume') {
    return errorResponse(requestId, 400, 'INVALID_ACTION', 'action must be \"pause\" or \"resume\".');
  }

  const svc = services().slots;
  const result = action === 'pause' ? await svc.pause(slotId, identity.wallet) : await svc.resume(slotId, identity.wallet);
  if (!result.ok) {
    const status = result.code === 'SLOT_NOT_FOUND' ? 404 : 400;
    return errorResponse(requestId, status, result.code, result.message);
  }
  return successResponse(200, { slot: result.slot }, requestId);
}
