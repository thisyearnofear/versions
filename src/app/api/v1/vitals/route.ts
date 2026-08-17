// MODULAR: Admin vitals endpoint — money-path health in one read:
// search latency percentiles, durable outbox depth, sweeper health,
// and the last retention prune.
//
// GET /api/v1/vitals?hours=24 (default 24, max 720)
//
// No auth gate — mirrors /api/v1/funnel. The payload contains NO
// wallet addresses, brief text, or PII (aggregate counts only).

import type { NextRequest } from 'next/server';
import { getVitals } from '@/services/vitals';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor, parsePositiveIntParam } from '@/lib/services';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const rid = requestIdFor(req);
  try {
    const hours = parsePositiveIntParam(
      req.nextUrl.searchParams.get('hours'),
      24,
      720,
    );
    const vitals = await getVitals(services().sweeper, hours);
    return successResponse(200, vitals, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}

export function OPTIONS(req: NextRequest): Response {
  return corsPreflight(requestIdFor(req));
}
