import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';

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
    const profile = await services().listeners.ensureProfile(wallet);
    return successResponse(200, profile, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
