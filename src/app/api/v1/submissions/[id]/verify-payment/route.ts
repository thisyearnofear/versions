import type { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  rateLimitedResponse,
  requestIdFor,
  clientIpFor,
  headerBag,
} from '@/lib/services';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rid = requestIdFor(req);
  const svc = services();
  if (!svc.audioLimiter.allow({ headers: headerBag(req) }, clientIpFor(req))) {
    return rateLimitedResponse(rid);
  }
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) || {};
    const txHash = body?.txHash;
    if (typeof txHash !== 'string' || !txHash.startsWith('0x') || txHash.length !== 66) {
      return errorResponse(rid, 400, 'INVALID_TX_HASH', 'txHash must be a 0x-prefixed 32-byte hex string');
    }
    const r = await svc.submissions.verifyPayment(id, txHash);
    if (!r.ok) {
      const status = r.error === 'Submission not found' ? 404 : 400;
      return errorResponse(rid, status, 'VERIFY_PAYMENT_FAILED', r.error);
    }
    if (r.submission && r.submission.status === 'awaiting_curation') {
      svc.agents.reviewSubmission(id).catch((err) => {
        log.error('auto-review failed', { request_id: rid, submission_id: id, err: (err as Error).message });
      });
    }
    return successResponse(200, r.submission, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
