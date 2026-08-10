// MODULAR: Match benchmark report. Aggregates every labeled
// (brief → take) judgment into MRR / precision@k / nDCG + a fit-score
// discrimination check. This is the "is the match getting better" number
// that the ground-truth moat is built on (see src/lib/match-benchmark.ts).
// Read-only, internal; the same report is available on the CLI via
// `npm run benchmark`.

import { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, requestIdFor } from '@/lib/services';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const requestId = requestIdFor(req);
  try {
    const report = await services().supervisor.benchmarkMatchFeedback();
    return successResponse(200, { report }, requestId);
  } catch (err) {
    return errorResponse(requestId, 500, 'INTERNAL', (err as Error).message);
  }
}