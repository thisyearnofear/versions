import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { id } = await ctx.params;
    const row = await services().submissions.getSubmissionAsync(id);
    if (!row) return errorResponse(rid, 404, 'NOT_FOUND', 'Submission not found');
    return successResponse(200, row, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
