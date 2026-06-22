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

export async function GET(req: NextRequest) {
  const rid = requestIdFor(req);
  try {
    const url = new URL(req.url);
    const limit = parsePositiveIntParam(url.searchParams.get('limit'), 20, 100);
    const offset = parsePositiveIntParam(url.searchParams.get('offset'), 0);
    const rows = await services().submissions.listQueueAsync({ limit, offset });
    return successResponse(200, rows, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
