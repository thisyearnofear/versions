// MODULAR: Per-channel placements. Channel-owned history plus compliance signal.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor, parsePositiveIntParam } from '@/lib/services';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ channelId: string }> }) {
  const requestId = requestIdFor(req);
  const { channelId } = await ctx.params;
  const channel = await services().channels.get(channelId);
  if (!channel) return errorResponse(requestId, 404, 'CHANNEL_NOT_FOUND', 'No channel with that id.');

  const { searchParams } = new URL(req.url);
  const limit = parsePositiveIntParam(searchParams.get('limit'), 20, 100);
  const slots = await services().slots.listForChannel(channelId, { limit });
  const usage = await services().usage.listForChannel(channelId, { limit: Math.min(limit, 20) });
  return successResponse(200, { channel, slots, usage }, requestId);
}
