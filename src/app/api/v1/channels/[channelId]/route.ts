// MODULAR: Single channel read.
//
// A VERIFIED channel is public — it is the demand-side proof the marketplace
// shows alongside a listing ("used by 12 channels, 3.1M subscribers"). An
// unverified one is visible only to its owner, so a pending or failed
// registration is not discoverable by id. The owner wallet is redacted for
// anyone but the owner: reach is public, identity is not.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor } from '@/lib/services';
import { resolveAuthenticatedSupervisorIdentity } from '@/lib/supervisor-identity';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ channelId: string }> }) {
  const requestId = requestIdFor(req);
  const { channelId } = await ctx.params;

  const channel = await services().channels.get(channelId);
  if (!channel) {
    return errorResponse(requestId, 404, 'CHANNEL_NOT_FOUND', 'No channel with that id.');
  }

  const identity = await resolveAuthenticatedSupervisorIdentity();
  const isOwner = !!identity && identity.wallet.toLowerCase() === channel.owner_wallet.toLowerCase();

  if (channel.verification_status !== 'verified' && !isOwner) {
    // Same 404 as a missing id — do not confirm that an unverified channel
    // exists to a caller who has no business knowing.
    return errorResponse(requestId, 404, 'CHANNEL_NOT_FOUND', 'No channel with that id.');
  }

  return successResponse(
    200,
    { channel: isOwner ? channel : { ...channel, owner_wallet: null } },
    requestId,
  );
}
