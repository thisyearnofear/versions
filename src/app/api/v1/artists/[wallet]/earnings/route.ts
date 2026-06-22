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
    const url = new URL(req.url);
    const limit = parsePositiveIntParam(url.searchParams.get('limit'), 50, 200);
    const result = services().settlement.listEarnings(wallet, { limit });
    return successResponse(200, result, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
