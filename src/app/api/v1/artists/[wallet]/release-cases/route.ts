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

export async function GET(req: NextRequest, ctx: { params: Promise<{ wallet: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { wallet } = await ctx.params;
    const limit = parsePositiveIntParam(new URL(req.url).searchParams.get('limit'), 50, 100);
    const rows = await services().releaseCases.getCasesForArtist(wallet, { limit });
    return successResponse(200, { rows }, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}