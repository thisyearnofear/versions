import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function POST(req: NextRequest) {
  const rid = requestIdFor(req);
  try {
    const body = (await req.json().catch(() => null)) || {};
    const { playlistId, versionId, listenerWallet } = body;
    if (!playlistId || !versionId || !listenerWallet) {
      return errorResponse(rid, 400, 'MISSING_FIELD', 'playlistId, versionId, and listenerWallet are required');
    }
    const result = await services().ar.recordPlay({ playlistId, versionId, listenerWallet });
    if (!result.ok) return errorResponse(rid, 400, 'PLAY_FAILED', result.error);
    return successResponse(200, result.play, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
