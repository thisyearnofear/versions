import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';
import { assertMoodTagsShape } from '@/lib/format';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { id: submissionId } = await ctx.params;
    const body = (await req.json().catch(() => null)) || {};
    const { curatorWallet, signature, rating } = body;
    if (!curatorWallet || !signature || !rating) {
      return errorResponse(rid, 400, 'MISSING_FIELD', 'curatorWallet, signature, and rating are required');
    }
    // MODULAR: belt-and-suspenders writer-side guard at the HTTP
    // boundary. The curation service also asserts the shape on
    // insert; calling it here too means a third-party client that
    // sends `rating.mood_tags` as a JSON-string fails the route
    // with a clear post-mortem (the error message names `mood_tags`)
    // before the service is even invoked. Throws TypeError; the
    // try/catch below returns 500 INTERNAL.
    assertMoodTagsShape(rating.mood_tags, 'mood_tags');
    const r = await services().curation.submitRating({ submissionId, curatorWallet, signature, rating });
    if (!r.ok) {
      const status = r.error === 'Submission not found' ? 404 : 400;
      return errorResponse(rid, status, 'RATE_REJECTED', r.error);
    }
    return successResponse(
      201,
      { rating_id: r.rating_id, rating_count: r.rating_count, published: r.published },
      rid,
    );
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
