// MODULAR: What this channel has actually been paid. Owner-only —
// the operator's ledger is not public. Reads `slot_legs` (the only
// money table for placements) through `slots.earningsForChannel`, so
// the response's `split` comes from `SLOT_SPLITS` and `settled` comes
// from on-chain `settled` legs on Arc.
//
// SAFE: a non-owner gets the same 404 as a bad channel id, so the
// existence of the channel (and whether it has earnings) is not
// leaked. Every amount is a decimal USDC text; the route never
// invents money.

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
  const isOwner =
    !!identity && identity.wallet.toLowerCase() === channel.owner_wallet.toLowerCase();

  if (!isOwner) {
    // Same 404 as a missing id — do not confirm a channel's earnings exist.
    return errorResponse(requestId, 404, 'CHANNEL_NOT_FOUND', 'No channel with that id.');
  }

  const earnings = await services().slots.earningsForChannel(channelId);
  return successResponse(200, { earnings }, requestId);
}
