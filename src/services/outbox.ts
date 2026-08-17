// MODULAR: Durable event outbox. The in-process EventBus is fire-and-forget —
// a process dying between "money moved" and "SSE client read it" would drop a
// receipt. Durable emits write the event to `outbox_events` AND broadcast
// immediately (so the live stream stays snappy); a drain replays unprocessed
// rows into the bus later (cron tick, SSE reconnect) so delivery is
// at-least-once. Re-broadcast is safe — SSE consumers re-fetch and dedupe.
//
// CLEAN: the outbox is a best-effort companion to the receipt stream, never
// the source of truth for money state (that stays in settlement/license
// tables). If an outbox write fails it logs and still broadcasts — a missed
// row risks only a replayed delay, never a wrong ledger.

import { randomUUID } from 'crypto';
import { and, asc, count, inArray, isNull, isNotNull, lte } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  outboxEvents,
  telemetryEvents,
  briefSearches,
  x402Proofs,
  arPlayEvents,
  listenEvents,
} from '../lib/schema';
import { emit, type EventName, type BusEvent } from '../lib/event-bus';
import { log } from '../lib/logger';

/** Persist an event payload for later replay. Fire-and-forget to the caller. */
export async function enqueue(topic: EventName, payload: BusEvent): Promise<void> {
  await db
    .insert(outboxEvents)
    .values({
      id: randomUUID(),
      topic,
      payload: payload as unknown as Record<string, unknown>,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}

/**
 * Write to the outbox AND broadcast now. Use for the canonical receipt
 * stream (settlement-event / economy-event / feed-update) so a receipt is
 * never lost while the live stream stays immediate.
 */
export async function emitDurable(topic: EventName, payload: BusEvent): Promise<void> {
  try {
    await enqueue(topic, payload);
  } catch (err) {
    log.warn('outbox enqueue failed; broadcasting without durable copy', {
      topic,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  emit(topic, payload);
}

// PERFORMANT: drainOutbox sits on the hot path (every SSE connect + cron
// tick). An in-process mutex + minimum interval makes overlapping calls
// no-ops instead of racing each other over the same unprocessed rows.
// The cron caller passes { throttle: false } so scheduled sweeps always run.
//
// IMPORTANT: the mutex is in-process — a hard constraint of the
// single-instance deployment (see docs/deploy.md). If the app ever scales to
// multiple instances, move this claim into the DB (e.g. a claimed_at column
// or pg_advisory_xact_lock) before removing the throttle.
const MIN_DRAIN_INTERVAL_MS = 10_000;
let draining = false;
let lastDrainAt = 0;

export interface DrainResult {
  replayed: number;
  unprocessed: number;
  /** True when the call was skipped by the in-process throttle. */
  skipped?: boolean;
}

/**
 * Replay unprocessed outbox events into the bus, marking each processed.
 * At-least-once: we emit before marking, so a crash between the two can
 * re-broadcast (harmless — SSE consumers re-fetch and dedupe). Ordering is by
 * createdAt so receipts replay in production order.
 */
export async function drainOutbox(
  limit = 200,
  opts: { throttle?: boolean } = {},
): Promise<DrainResult> {
  const now = Date.now();
  if (opts.throttle !== false) {
    if (draining) return { replayed: 0, unprocessed: -1, skipped: true };
    if (now - lastDrainAt < MIN_DRAIN_INTERVAL_MS) {
      return { replayed: 0, unprocessed: -1, skipped: true };
    }
  }
  draining = true;
  lastDrainAt = now;
  try {
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.processedAt))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit);
    if (rows.length === 0) {
      return { replayed: 0, unprocessed: 0 };
    }
    // Emit everything first, then mark in ONE batched UPDATE (was one
    // round-trip per row). Crash between emit and mark → replayed next
    // drain (at-least-once, consumers dedupe).
    for (const row of rows) {
      emit(row.topic as EventName, row.payload as unknown as BusEvent);
    }
    await db
      .update(outboxEvents)
      .set({ processedAt: new Date() })
      .where(inArray(outboxEvents.id, rows.map((r) => r.id)));
    const [totals] = await db
      .select({ n: count() })
      .from(outboxEvents)
      .where(isNull(outboxEvents.processedAt));
    return { replayed: rows.length, unprocessed: Number(totals?.n ?? 0) };
  } finally {
    draining = false;
  }
}

// ── Retention ──────────────────────────────────────────────────────────
// Enqueues outpace drains under load, so processed rows must be pruned or
// the tables grow forever. Only rows whose broadcast is long done are
// deleted; unprocessed outbox rows are NEVER touched. Money-audit tables
// (settlement_legs, licenses) are intentionally excluded — receipts must
// outlive their broadcast.

const RETENTION_DAYS = {
  outbox: Number(process.env.RETENTION_OUTBOX_DAYS ?? 14),
  telemetry: Number(process.env.RETENTION_TELEMETRY_DAYS ?? 30),
  searches: Number(process.env.RETENTION_SEARCHES_DAYS ?? 90),
  // Audit-grade: verified payment proofs and play/listen events.
  audit: Number(process.env.RETENTION_AUDIT_DAYS ?? 365),
};

const MIN_PRUNE_INTERVAL_MS = 30 * 60_000; // 30 min
let lastPruneAt = 0;

export interface RetentionReport {
  pruned: Record<string, number>;
  skipped: boolean;
  prunedAt: string | null;
}

let lastReport: RetentionReport = {
  pruned: {},
  skipped: false,
  prunedAt: null,
};

/**
 * Delete rows past their retention window. Throttled in-process to at most
 * once per 30 minutes; called from the cron sweep route. Each table is
 * independent — one failing delete never blocks the rest.
 */
export async function pruneRetention(): Promise<RetentionReport> {
  const now = Date.now();
  if (now - lastPruneAt < MIN_PRUNE_INTERVAL_MS) {
    return { ...lastReport, skipped: true };
  }
  lastPruneAt = now;
  const cutoff = (days: number) => new Date(now - days * 86_400_000);
  const jobs: Array<[string, Promise<unknown[]>]> = [
    [
      'outbox_events',
      db
        .delete(outboxEvents)
        .where(
          and(isNotNull(outboxEvents.processedAt), lte(outboxEvents.createdAt, cutoff(RETENTION_DAYS.outbox))),
        )
        .returning({ id: outboxEvents.id }),
    ],
    [
      'telemetry_events',
      db
        .delete(telemetryEvents)
        .where(lte(telemetryEvents.createdAt, cutoff(RETENTION_DAYS.telemetry)))
        .returning({ id: telemetryEvents.id }),
    ],
    [
      'brief_searches',
      db
        .delete(briefSearches)
        .where(lte(briefSearches.createdAt, cutoff(RETENTION_DAYS.searches)))
        .returning({ id: briefSearches.id }),
    ],
    [
      'x402_proofs',
      db
        .delete(x402Proofs)
        .where(lte(x402Proofs.createdAt, cutoff(RETENTION_DAYS.audit)))
        .returning({ id: x402Proofs.id }),
    ],
    [
      'ar_play_events',
      db
        .delete(arPlayEvents)
        .where(lte(arPlayEvents.playedAt, cutoff(RETENTION_DAYS.audit)))
        .returning({ id: arPlayEvents.id }),
    ],
    [
      'listen_events',
      db
        .delete(listenEvents)
        .where(lte(listenEvents.createdAt, cutoff(RETENTION_DAYS.audit)))
        .returning({ id: listenEvents.id }),
    ],
  ];
  const pruned: Record<string, number> = {};
  for (const [name, promise] of jobs) {
    try {
      pruned[name] = (await promise).length;
    } catch (err) {
      log.warn('retention prune failed', {
        table: name,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  lastReport = { pruned, skipped: false, prunedAt: new Date(now).toISOString() };
  if (Object.values(pruned).some((n) => n > 0)) {
    log.info('retention pruned old rows', pruned);
  }
  return lastReport;
}

/** Snapshot of the last prune report for admin vitals (no side effects). */
export function retentionStatus(): RetentionReport {
  return { ...lastReport };
}
