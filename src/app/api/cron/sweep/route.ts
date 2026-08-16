import type { NextRequest } from 'next/server';
import { services, successResponse, errorResponse, corsPreflight, requestIdFor } from '@/lib/services';
import { drainOutbox } from '@/services/outbox';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

async function tickLoop(rid: string) {
  const result = await services().sweeper.tick();
  // MODULAR: also drain the durable outbox so any receipt queued but not yet
  // broadcast (process died mid-emit, SSE was down) replays on the cron
  // cadence. At-least-once delivery keeps the receipt stream lossless.
  const outbox = await drainOutbox();
  return successResponse(200, { result, outbox }, rid);
}

export async function POST(req: NextRequest) {
  return tickLoop(requestIdFor(req)).catch((err) =>
    errorResponse(requestIdFor(req), 500, 'INTERNAL', (err as Error).message),
  );
}

export async function GET(req: NextRequest) {
  return tickLoop(requestIdFor(req)).catch((err) =>
    errorResponse(requestIdFor(req), 500, 'INTERNAL', (err as Error).message),
  );
}
