// MODULAR: Opportunistic sweep. The sweep duties (retry stuck settlement
// legs, drain the durable outbox, prune retention) are recovery, not the
// happy path — nothing in them needs a wall-clock faster than the next
// visitor. So they ride real traffic: the SSE connect handler calls
// maybeSweep(), which runs the full sweep at most once per interval.
//
// Why the interval is generous and the external cron is daily-only: a
// scheduled poll faster than Neon's scale-to-sleep idle window (5 min)
// keeps the compute hot 24/7 — the exact configuration that exhausted the
// monthly CU-hr allowance on 2026-09-21 (docs/deploy.md). No traffic
// means nothing needed recovering anyway; a crash during a demo heals on
// the next dashboard connect, and the daily safety-net tick covers the
// no-visitor case.
//
// IMPORTANT: like drainOutbox's mutex, this throttle is in-process — valid
// only under the single-instance deployment constraint (docs/deploy.md).

import { services } from '../lib/services';
import { drainOutbox, pruneRetention, type DrainResult, type RetentionReport } from './outbox';
import { log } from '../lib/logger';

export const MIN_SWEEP_INTERVAL_MS = Number(
  process.env.SWEEP_MIN_INTERVAL_MS ?? 30 * 60_000,
);

let lastSweepStartedAt = 0;
let sweeping = false;

export interface SweepReport {
  outbox: DrainResult;
  retention: RetentionReport;
}

export interface SweepOutcome {
  ran: boolean;
  skipped?: 'in-flight' | 'throttled';
  report?: SweepReport;
}

/** The sweep body, no throttle — used by the daily cron route too. */
export async function runSweep(): Promise<SweepReport> {
  await services().sweeper.tick();
  const outbox = await drainOutbox(200, { throttle: false });
  const retention = await pruneRetention();
  return { outbox, retention };
}

/**
 * Run the sweep unless one ran recently or is in flight. Never throws —
 * failures log and count as an attempt, so a broken DB (e.g. exhausted
 * quota) degrades to one warning per interval instead of a retry storm
 * on every SSE connect.
 */
export async function maybeSweep(): Promise<SweepOutcome> {
  if (sweeping) return { ran: false, skipped: 'in-flight' };
  if (Date.now() - lastSweepStartedAt < MIN_SWEEP_INTERVAL_MS) {
    return { ran: false, skipped: 'throttled' };
  }
  sweeping = true;
  lastSweepStartedAt = Date.now();
  try {
    const report = await runSweep();
    return { ran: true, report };
  } catch (err) {
    log.warn('opportunistic sweep failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ran: false };
  } finally {
    sweeping = false;
  }
}
