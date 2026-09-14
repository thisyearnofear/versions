// MODULAR: Re-probe a channel against the platform. Owner-only.
//
// This is the path that turns a pending row into a verified one — typically
// after YOUTUBE_API_KEY is configured, or when a channel's numbers need
// refreshing. It re-reads the stored platform_url rather than accepting a new
// one, so re-verification can never be used to swap in a different (larger)
// distribution surface behind an existing channel id.
//
// SAFE: a failed re-probe does not downgrade a verified channel. Losing
// verification because of a transient quota error would silently strip a
// legitimate channel's access to the paid tier; the failure is recorded in
// verification_error and the existing status stands.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor } from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';
import type { ChannelFailureCode } from '@/services/channels';

export const dynamic = 'force-dynamic';

const STATUS_FOR_FAILURE: Record<ChannelFailureCode, number> = {
  AGREEMENT_VERSION_STALE: 409,
  PLATFORM_UNSUPPORTED: 400,
  INVALID_PLATFORM_URL: 400,
  PROBE_FAILED: 502,
  CHANNEL_NOT_FOUND: 404,
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ channelId: string }> }) {
  const requestId = requestIdFor(req);
  const identity = await resolveAuthenticatedSupervisorIdentity();
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to verify a channel.');
  }
  const { channelId } = await ctx.params;

  const svc = services();
  const existing = await svc.channels.get(channelId);
  if (!existing) {
    return errorResponse(requestId, 404, 'CHANNEL_NOT_FOUND', 'No channel with that id.');
  }
  if (existing.owner_wallet.toLowerCase() !== identity.wallet.toLowerCase()) {
    // 404 rather than 403: do not confirm the channel exists to a caller who
    // does not own it.
    return errorResponse(requestId, 404, 'CHANNEL_NOT_FOUND', 'No channel with that id.');
  }

  const result = await svc.channels.verify(channelId);
  if (!result.ok) {
    return errorResponse(requestId, STATUS_FOR_FAILURE[result.code], result.code, result.message);
  }

  return successResponse(200, { channel: result.channel }, requestId);
}
