import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { publishedVersions as pvTable } from '@/lib/schema';
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

    const listenerSvc = services().listeners;
    const arSvc = services().ar;

    // Check if listener has free plays available
    const freePlayCheck = await listenerSvc.checkFreePlay(listenerWallet);
    const isFree = freePlayCheck.free;

    // Record the play via AR service — free plays skip the listener on-chain charge
    const playResult = await arSvc.recordPlay({
      playlistId,
      versionId,
      listenerWallet,
      playType: isFree ? 'free' : 'paid',
    });

    if (!playResult.ok) {
      return errorResponse(rid, 400, 'PLAY_FAILED', playResult.error);
    }

    // Update listener profile (free play stats, reputation, badges)
    const incentiveResult = await listenerSvc.recordPlay({
      wallet: listenerWallet,
      versionId,
      playlistId,
    });

    return successResponse(200, {
      ...playResult.play,
      play_type: isFree ? 'free' : 'paid',
      free_plays_remaining: incentiveResult.remaining,
      reputation_earned: incentiveResult.reputationEarned,
      new_badges: incentiveResult.newBadges,
    }, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
