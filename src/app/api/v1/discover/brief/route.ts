// MODULAR: Supervisor inverse-search route. The supervisor pastes a
// natural-language brief plus optional structured filters; the
// service ranks every published version (joined with its placement
// brief) and returns top-N with `why_fits` citations.
//
// Persisted under "brief:*" cache keys invalidated by 'feed-update'
// so a publish wipes the index surface without revising existing rows.
// Response envelope mirrors /api/v1/feed so the DiscoverView dropdown
// can swap data sources without restructuring.
//
// Per-IP token-bucket rate limit (60 req / min) protects the
// in-process scoring loop from accidental or hostile burst traffic.
// Real-world supervisors iterate briefs; ~60 in a 60s window is more
// than enough headroom and matches the existing /api/v1/feed pace.

import type { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  requestIdFor,
  parsePositiveIntParam,
} from '@/lib/services';
import { createRateLimiter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

const inverseSearchLimiter = createRateLimiter({
  label: 'discover.brief',
  windowMs: 60_000,
  max: 60,
});

const VALID_ENERGY = new Set(['lower', 'same', 'higher']);
const VALID_TEMPO = new Set(['dragging', 'locked', 'rushing']);
const BRIEF_MIN_LEN = 3;
const BRIEF_MAX_LEN = 500;
const BRIEF_DEFAULT_LIMIT = 20;

function splitCsv(s: string | null): string[] | undefined {
  if (!s) return undefined;
  const parts = s
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : undefined;
}

export async function GET(req: NextRequest) {
  const rid = requestIdFor(req);
  // MODULAR: NextRequest.headers is a WHATWG Headers object; the
  // rate-limiter expects a `Record<string, string|string[]|undefined>`.
  // `Object.fromEntries(headers.entries())` produces a structurally
  // compatible plain object (`Record<string, string>` is assignable
  // to the wider signature because `string` ∈ the union).
  const headerSnapshot = Object.fromEntries(req.headers.entries());
  if (!inverseSearchLimiter.allow({ headers: headerSnapshot })) {
    return errorResponse(rid, 429, 'RATE_LIMITED', 'Too many requests; please slow down.');
  }
  try {
    const url = new URL(req.url);
    const briefRaw = url.searchParams.get('brief') ?? '';
    if (briefRaw.length < BRIEF_MIN_LEN || briefRaw.length > BRIEF_MAX_LEN) {
      return errorResponse(
        rid,
        400,
        'INVALID_BRIEF',
        `brief must be ${BRIEF_MIN_LEN}-${BRIEF_MAX_LEN} characters`,
      );
    }
    const energyRaw = url.searchParams.get('energy');
    const tempoRaw = url.searchParams.get('tempo');
    const energy = energyRaw && VALID_ENERGY.has(energyRaw) ? energyRaw : undefined;
    const tempo = tempoRaw && VALID_TEMPO.has(tempoRaw) ? tempoRaw : undefined;
    const limit = parsePositiveIntParam(url.searchParams.get('limit'), BRIEF_DEFAULT_LIMIT, 50);
    const offset = parsePositiveIntParam(url.searchParams.get('offset'), 0);

    const result = await services().feed.searchByBrief({
      brief: briefRaw,
      sceneTags: splitCsv(url.searchParams.get('sceneTags')),
      instruments: splitCsv(url.searchParams.get('instruments')),
      energy: energy as 'lower' | 'same' | 'higher' | undefined,
      tempo: tempo as 'dragging' | 'locked' | 'rushing' | undefined,
      limit,
      offset,
    });
    return successResponse(200, result, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
