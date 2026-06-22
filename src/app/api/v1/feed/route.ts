import type { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  requestIdFor,
  parsePositiveIntParam,
} from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

const VALID_ENERGY = new Set(['lower', 'same', 'higher']);
const VALID_TEMPO = new Set(['dragging', 'locked', 'rushing']);

export async function GET(req: NextRequest) {
  const rid = requestIdFor(req);
  try {
    const url = new URL(req.url);
    const mood = url.searchParams.get('mood') ?? undefined;
    const energyRaw = url.searchParams.get('energy');
    const tempoRaw = url.searchParams.get('tempo');
    const energy = energyRaw && VALID_ENERGY.has(energyRaw) ? energyRaw : undefined;
    const tempo = tempoRaw && VALID_TEMPO.has(tempoRaw) ? tempoRaw : undefined;
    const minSoloRaw = url.searchParams.get('minSolo');
    const maxSoloRaw = url.searchParams.get('maxSolo');
    const minSolo = minSoloRaw != null ? Number(minSoloRaw) : undefined;
    const maxSolo = maxSoloRaw != null ? Number(maxSoloRaw) : undefined;
    const artistWallet = url.searchParams.get('artist') ?? undefined;
    const limit = parsePositiveIntParam(url.searchParams.get('limit'), 20, 100);
    const offset = parsePositiveIntParam(url.searchParams.get('offset'), 0);

    const result = await services().feed.listPublished({
      limit,
      offset,
      mood,
      energy: energy as 'lower' | 'same' | 'higher' | undefined,
      tempo: tempo as 'dragging' | 'locked' | 'rushing' | undefined,
      minSolo: Number.isFinite(minSolo) ? minSolo : undefined,
      maxSolo: Number.isFinite(maxSolo) ? maxSolo : undefined,
      artistWallet,
    });
    return successResponse(200, result, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
