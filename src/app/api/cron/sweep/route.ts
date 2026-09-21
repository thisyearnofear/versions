import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';
import { runSweep } from '@/services/sweep';
import { env } from '@/lib/config';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// MODULAR: shared-secret guard for the sweep route. This endpoint drives
// settlement retries, the authoritative outbox drain, and retention DELETEs
// — it must not be freely callable. Fail-open (with a one-time warning)
// while CRON_SECRET is unset so existing deploys keep ticking; once set,
// any request without the matching `x-cron-secret` header is rejected 401.
//
// Pure + exported so the auth decision is unit-testable without booting the
// service registry. Constant-time compare (length-checked) so the header
// value isn't leaked via response timing.
export function isAuthorized(secret: string | undefined, provided: string | null): boolean {
  if (!secret) return true;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

let warnedOpen = false;
function guard(req: NextRequest): boolean {
  if (!env.CRON_SECRET && !warnedOpen) {
    warnedOpen = true;
    log.warn(
      'CRON_SECRET is unset — /api/cron/sweep is unauthenticated. Set CRON_SECRET in the server .env and add the x-cron-secret header to the cron job.',
    );
  }
  return isAuthorized(env.CRON_SECRET, req.headers.get('x-cron-secret'));
}

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

async function tickLoop(rid: string) {
  // MODULAR: same body the traffic-driven maybeSweep uses — stuck-leg
  // retry, the authoritative outbox drain, and retention. This route is
  // now the daily safety net for the no-visitor case (see sweep.ts).
  const report = await runSweep();
  return successResponse(200, { ...report }, rid);
}

export async function POST(req: NextRequest) {
  const rid = requestIdFor(req);
  if (!guard(req)) {
    return errorResponse(rid, 401, 'UNAUTHORIZED', 'Missing or invalid cron secret.');
  }
  return tickLoop(rid).catch((err) =>
    errorResponse(rid, 500, 'INTERNAL', (err as Error).message),
  );
}

export async function GET(req: NextRequest) {
  const rid = requestIdFor(req);
  if (!guard(req)) {
    return errorResponse(rid, 401, 'UNAUTHORIZED', 'Missing or invalid cron secret.');
  }
  return tickLoop(rid).catch((err) =>
    errorResponse(rid, 500, 'INTERNAL', (err as Error).message),
  );
}
