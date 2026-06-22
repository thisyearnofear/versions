import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function POST(req: NextRequest) {
  const rid = requestIdFor(req);
  try {
    const result = await services().sweeper.tick();
    return successResponse(200, result, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}

export async function GET(req: NextRequest) {
  const rid = requestIdFor(req);
  try {
    const result = await services().sweeper.tick();
    return successResponse(200, result, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
