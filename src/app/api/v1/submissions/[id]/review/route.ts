import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { id: submissionId } = await ctx.params;
    const result = await services().agents.reviewSubmission(submissionId);
    if (!result.ok) {
      const status = result.error === 'Submission not found' ? 404 : 400;
      return errorResponse(rid, status, 'REVIEW_FAILED', result.error);
    }
    return successResponse(
      200,
      {
        reviews: result.reviews,
        brief: result.brief,
        rating_count: result.rating_count,
        published: result.published,
      },
      rid,
    );
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
