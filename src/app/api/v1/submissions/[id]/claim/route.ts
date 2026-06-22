import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

async function readJson(req: NextRequest, rid: string) {
  try {
    return (await req.json()) ?? {};
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { id: submissionId } = await ctx.params;
    const body = await readJson(req, rid);
    const { curatorWallet, signature } = body ?? {};
    if (!curatorWallet || !signature) {
      return errorResponse(rid, 400, 'MISSING_FIELD', 'curatorWallet and signature are required');
    }
    const r = await services().curation.claimSubmission({ submissionId, curatorWallet, signature });
    if (!r.ok) {
      const status = r.error === 'Submission not found' ? 404 : 400;
      return errorResponse(rid, status, 'CLAIM_REJECTED', r.error);
    }
    return successResponse(201, { ...r.claim, claim_message: 'VERSIONS_LEPTON_CLAIM' }, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rid = requestIdFor(req);
  try {
    const { id: submissionId } = await ctx.params;
    const body = await readJson(req, rid);
    const curatorWallet = (body && body.curatorWallet) || '';
    if (!curatorWallet) {
      return errorResponse(rid, 400, 'MISSING_FIELD', 'curatorWallet is required');
    }
    const r = await services().curation.releaseClaim({ submissionId, curatorWallet });
    return successResponse(200, { released: r.released }, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
