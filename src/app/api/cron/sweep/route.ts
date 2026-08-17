import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';
import { drainOutbox, pruneRetention } from '@/services/outbox';
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
  const result = await services().sweeper.tick();
  // MODULAR: also drain the durable outbox so any receipt queued but not yet
  // broadcast (process died mid-emit, SSE was down) replays on the cron
  // cadence. At-least-once delivery keeps the receipt stream lossless.
  // The cron tick is the authoritative drain — bypass the in-process
  // throttle that guards the hot-path SSE-connect caller.
  const outbox = await drainOutbox(200, { throttle: false });
  // Retention: prune old rows so append-only tables don't grow forever
  // (internally throttled to at most one prune per 30 min).
  const retention = await pruneRetention();
  return successResponse(200, { result, outbox, retention }, rid);
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
