// MODULAR: Settlement reconciliation sweeper. Picks up legs that
// were inserted as 'pending' but never flipped to 'settled' (the
// process died between publish and settleLegsAsync, the Arc RPC
// was unreachable, etc.) and retries them.
//
// DRY: reuses the settlement service's settleLegsAsync method.
//
// ORGANIZED: lives in services/ alongside settlement.ts. A Next.js
// route handler (e.g. /api/cron/sweep) invokes start() at boot or
// on a cron trigger. The sweeper is opt-in — nothing starts
// automatically on import.

import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { settlementLegs as legsTable } from '../lib/schema';
import { log } from '../lib/logger';
import type { SettlementService } from './settlement';
// MODULAR: server-side submit config (Next.js enforces server-only
// bundling via the .server.ts suffix). The sweeper's default
// polling cadence reads the same env-overridable knob as the
// client's receipt-wait timeout — operators on Arc mainnet (or
// future chains with longer block times) tune SUBMIT_RECEIPT_TIMEOUT_MS
// without redeploying. Aliased on import so the sweeper-side
// semantic (`SWEEPER_DEFAULT_INTERVAL_MS`) is explicit at the
// call site — the env var name is incidental to the polling role.
import { SUBMIT_RECEIPT_TIMEOUT_MS as SWEEPER_DEFAULT_INTERVAL_MS } from '../lib/submit-config.server';

export const STUCK_THRESHOLD_MS = 30 * 1000; // 30s

export interface SweeperStats {
  last_run_at: string | null;
  last_run_stats: null | {
    retried?: number;
    settled?: number;
    failed?: number;
    durationMs: number;
    error?: string;
  };
  running: boolean;
}

export interface Sweeper {
  start: (opts?: { intervalMs?: number }) => void;
  stop: () => void;
  tick: () => Promise<void>;
  stats: () => SweeperStats;
}

export async function findStuckLegs(): Promise<
  Array<{ id: string; submission_id: string; recipient_role: string; recipient_wallet: string; amount_usdc: string; age_ms: number }>
> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const rows = await db
    .select({
      id: legsTable.id,
      submission_id: legsTable.submissionId,
      recipient_role: legsTable.recipientRole,
      recipient_wallet: legsTable.recipientWallet,
      amount_usdc: legsTable.amountUsdc,
      age_ms: sql<number>`(EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM ${legsTable.createdAt})) * 1000`,
    })
    .from(legsTable)
    .where(and(eq(legsTable.status, 'pending'), lt(legsTable.createdAt, cutoff)))
    .orderBy(legsTable.createdAt)
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    submission_id: r.submission_id,
    recipient_role: r.recipient_role,
    recipient_wallet: r.recipient_wallet,
    amount_usdc: r.amount_usdc,
    age_ms: Number(r.age_ms ?? 0),
  }));
}

export function createSweeper({ settlement }: { settlement: SettlementService }): Sweeper {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let lastRunAt: string | null = null;
  let lastRunStats: SweeperStats['last_run_stats'] = null;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    const startMs = Date.now();
    try {
      const stuck = await findStuckLegs();
      if (stuck.length === 0) {
        lastRunStats = { retried: 0, settled: 0, failed: 0, durationMs: Date.now() - startMs };
        return;
      }
      const ids = stuck.map((l) => l.id);
      const results = await settlement.settleLegsAsync(ids);
      const settled = results.filter((r) => r.status === 'settled').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      lastRunStats = { retried: ids.length, settled, failed, durationMs: Date.now() - startMs };
      lastRunAt = new Date(startMs).toISOString();
      if (settled > 0) {
        log.info('sweeper settled stuck legs', { count: settled, total: ids.length });
      }
      if (failed > 0) {
        log.warn('sweeper failed to settle', { count: failed, total: ids.length });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('sweeper tick failed', { err: msg });
      lastRunStats = { error: msg, durationMs: Date.now() - startMs };
    } finally {
      running = false;
    }
  }

  return {
    // CLEAN: start() returns immediately. The first tick is
    // scheduled after `intervalMs`, not at t=0 (the publish path
    // already drives settleLegsAsync inline; the sweeper is for
    // recovery, not the happy path).
    //
    // MODULAR: intervalMs default reads the server-side submit
    // config (parsed once at boot from SUBMIT_RECEIPT_TIMEOUT_MS).
    // Numeric default is unchanged (60_000 ms = 1 min) — operators
    // who don't set the env get identical behavior to before. Only
    // ops who set SUBMIT_RECEIPT_TIMEOUT_MS see a different cadence,
    // which is the documented contract.
    start({
      intervalMs = SWEEPER_DEFAULT_INTERVAL_MS,
    }: { intervalMs?: number } = {}) {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
      log.info('settlement sweeper started', { intervalMs, thresholdMs: STUCK_THRESHOLD_MS });
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      log.info('settlement sweeper stopped');
    },
    tick,
    stats() {
      return {
        last_run_at: lastRunAt,
        last_run_stats: lastRunStats,
        running,
      };
    },
  };
}
