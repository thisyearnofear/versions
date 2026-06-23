import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor, parsePositiveIntParam } from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wallet: string }> },
) {
  const rid = requestIdFor(req);
  try {
    const { wallet } = await params;
    if (!wallet) return errorResponse(rid, 400, 'MISSING_PARAM', 'wallet is required');
    const url = new URL(req.url);
    const limit = parsePositiveIntParam(url.searchParams.get('limit'), 50, 200);
    const offset = parsePositiveIntParam(url.searchParams.get('offset'), 0);
    const playType = url.searchParams.get('playType') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const dateFrom = url.searchParams.get('dateFrom') || undefined;
    const dateTo = url.searchParams.get('dateTo') || undefined;
    const history = await services().listeners.getPlayHistory(wallet, { limit, offset, playType, status, dateFrom, dateTo });
    return successResponse(200, history, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
