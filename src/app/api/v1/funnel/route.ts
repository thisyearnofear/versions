// MODULAR: Funnel analysis admin endpoint. Returns a per-session
// drop-off breakdown for the core funnel:
//   landing → nav_click → form_start → submit_attempt → submit_success
//
// GET /api/v1/funnel?hours=168 (default 168 = 7 days)
//
// No auth gate — the data is anonymous (session IDs, no wallet
// addresses, no PII). If you want to restrict access, add an
// admin token check here. For now the endpoint is open so the
// team can curl it from the terminal.

import { getFunnelBreakdown } from '@/services/telemetry';
import { successResponse, errorResponse, corsPreflight, requestIdFor, parsePositiveIntParam } from '@/lib/services';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const rid = requestIdFor(req);

  try {
    const hours = parsePositiveIntParam(
      req.nextUrl.searchParams.get('hours'),
      168, // default: 7 days
      720, // max: 30 days
    );

    const breakdown = await getFunnelBreakdown(hours);

    return successResponse(200, breakdown, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}

export async function OPTIONS(req: NextRequest): Promise<Response> {
  return corsPreflight(requestIdFor(req));
}
