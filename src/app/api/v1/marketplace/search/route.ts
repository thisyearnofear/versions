// MODULAR: Marketplace semantic search — channel-ethos ranking of listings.
// GET /api/v1/marketplace/search?q=...&channelId=...&kind=&tier=&limit=&offset=
// Public, guest-friendly (no wallet). Supports three query shapes:
//   ?q=lo-fi night drive              — free-text query, ranked by tags/semantic
//   ?channelId=<id>                   — personalized by an existing channel's ethos
//   ?q=lo-fi&channelId=<id>&kind=music  — hybrid: channel ethos + extra query terms
//
// Invalid channelId is ignored (falls back to q-only ranking) rather than 404,
// so a deep link with a deleted channel still returns relevant supply.

import { NextRequest } from 'next/server';
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

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  const channelId = searchParams.get('channelId');
  const kind = searchParams.get('kind');
  const tier = searchParams.get('tier');
  const limit = parsePositiveIntParam(searchParams.get('limit'), 20, 50);
  const offset = parsePositiveIntParam(searchParams.get('offset'), 0);

  const kindVal = kind === 'music' || kind === 'placement' ? kind : null;
  const tierVal = tier === 'free' || tier === 'paid' ? tier : null;

  try {
    const result = await services().marketplace.search({
      query,
      channelId,
      kind: kindVal,
      tier: tierVal,
      limit,
      offset,
    });
    return successResponse(200, result, requestId);
  } catch (err) {
    return errorResponse(requestId, 500, 'MARKETPLACE_SEARCH_FAILED', (err as Error).message);
  }
}
