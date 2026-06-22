import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { id } = await ctx.params;
    const playlist = await services().ar.getPlaylist(id);
    if (!playlist) return errorResponse(rid, 404, 'NOT_FOUND', 'Playlist not found');
    const stats = await services().ar.getPlaylistStats(id);
    return successResponse(200, { ...playlist, stats }, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
