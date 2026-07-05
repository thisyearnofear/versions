import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';
import { validateMoodTagsShapeOrBadRequest } from '@/lib/api-validation';

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
    // MODULAR: third line of defense. validateMoodTagsShapeOrBadRequest
    // converts a malformed body into a structured 400 INVALID_MOOD_TAGS
    // response (vs. 500 INTERNAL from the outer try/catch). The
    // curation service also asserts the shape on insert; the helper
    // narrows `rating.mood_tags` so the spread below propagates the
    // validated value. Any future route that accepts a mood-tag-shaped
    // body field should use the same helper for symmetric behavior.
    const validation = validateMoodTagsShapeOrBadRequest(rating.mood_tags, 'mood_tags', rid);
    if ('response' in validation) return validation.response;
    const r = await services().curation.submitRating({
      submissionId,
      curatorWallet,
      signature,
      rating: { ...rating, mood_tags: validation.value },
    });
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
