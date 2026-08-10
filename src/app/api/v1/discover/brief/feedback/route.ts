// MODULAR: Supervisor ground-truth feedback route. Supervisors label a
// shown (brief → take) match as a good fit or wrong fit; the service
// stores it keyed by (supervisor_wallet, brief_hash, submission_id). This
// is the labeled set that feeds the match benchmark (MRR / precision@k /
// nDCG) and later scorer tuning. Guests get an identity via the guest
// header (resolveSupervisorIdentity), so rating matches needs no wallet.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor } from '@/lib/services';
import { resolveSupervisorIdentity } from '@/lib/supervisor-identity';
import { MatchFeedbackSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const requestId = requestIdFor(req);
  const identity = await resolveSupervisorIdentity(req);
  if (!identity) {
    return errorResponse(requestId, 401, 'UNAUTHORIZED', 'Sign in to rate matches.');
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(requestId, 400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const parsed = MatchFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      400,
      'INVALID_FEEDBACK',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; '),
    );
  }

  const row = await services().supervisor.recordMatchFeedback({
    supervisorWallet: identity.wallet,
    briefHash: parsed.data.briefHash,
    briefText: parsed.data.briefText,
    submissionId: parsed.data.submissionId,
    fitScoreShown: parsed.data.fitScoreShown,
    rankShown: parsed.data.rankShown ?? undefined,
    verdict: parsed.data.verdict,
  });

  return successResponse(200, { row }, requestId);
}