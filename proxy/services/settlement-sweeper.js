// MODULAR: Settlement reconciliation sweeper. Picks up legs that
// were inserted as 'pending' but never flipped to 'settled' (the
// process died between publish and settleLegsAsync, the Arc RPC
// was unreachable, etc.) and retries them.
//
// DRY: reuses the settlement service's settleLegsAsync method —
// the sweeper doesn't reimplement settlement, it just drives it.
//
// ORGANIZED: lives in services/ alongside settlement.js. The
// proxy wires start({ db, arc, intervalMs }) on boot and stop()
// on SIGTERM.

'use strict';

const log = require('../runtime/logger').log;

const STUCK_THRESHOLD_MS = 30 * 1000;   // 30s: long enough that an in-flight
                                       // settlement is still being awaited;
                                       // short enough that a crash is
                                       // recovered within one interval.

function findStuckLegs(db, now) {
  return db.prepare(`
    SELECT id, submission_id, recipient_role, recipient_wallet, amount_usdc,
           (julianday('now') - julianday(created_at)) * 86400000 AS age_ms
    FROM settlement_legs
    WHERE status = 'pending'
      AND created_at < datetime('now', '-30 seconds')
    ORDER BY created_at ASC
    LIMIT 50
  `).all();
}

function createSweeper({ db, settlement }) {
  let timer = null;
  let running = false;
  let lastRunAt = null;
  let lastRunStats = null;

  async function tick() {
    if (running) return;
    running = true;
    const startMs = Date.now();
    try {
      const stuck = findStuckLegs(db, startMs);
      if (stuck.length === 0) {
        lastRunStats = { retried: 0, settled: 0, failed: 0, durationMs: Date.now() - startMs };
        return;
      }
      const ids = stuck.map((l) => l.id);
      const results = await settlement.settleLegsAsync(ids);
      const settled = results.filter((r) => r.status === 'settled').length;
      const failed  = results.filter((r) => r.status === 'failed').length;
      lastRunStats = { retried: ids.length, settled, failed, durationMs: Date.now() - startMs };
      lastRunAt = new Date(startMs).toISOString();
      if (settled > 0) {
        log.info('sweeper settled stuck legs', { count: settled, total: ids.length });
      }
      if (failed > 0) {
        log.warn('sweeper failed to settle', { count: failed, total: ids.length });
      }
    } catch (err) {
      log.error('sweeper tick failed', { err: err.message });
      lastRunStats = { error: err.message, durationMs: Date.now() - startMs };
    } finally {
      running = false;
    }
  }

  return {
    // CLEAN: start() returns immediately. The first tick is
    // scheduled after `intervalMs`, not at t=0 (the publish path
    // already drives settleLegsAsync inline; the sweeper is for
    // recovery, not the happy path).
    start({ intervalMs = 60_000 } = {}) {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
      // MODULAR: unref() so the timer doesn't keep the process alive
      // during graceful shutdown.
      if (timer.unref) timer.unref();
      log.info('settlement sweeper started', { intervalMs, thresholdMs: STUCK_THRESHOLD_MS });
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      log.info('settlement sweeper stopped');
    },
    // MODULAR: a manual tick is exposed for tests + the health
    // endpoint (and for the next-tick hot path if the operator
    // wants to force a recovery pass).
    tick,
    stats() {
      return {
        last_run_at: lastRunAt,
        last_run_stats: lastRunStats,
        running
      };
    }
  };
}

module.exports = { createSweeper, findStuckLegs, STUCK_THRESHOLD_MS };
