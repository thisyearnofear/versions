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
import { asc, count, eq, isNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { outboxEvents } from '../lib/schema';
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
 * never lost while the live SSE stream stays immediate.
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

/**
 * Replay unprocessed outbox events into the bus, marking each processed.
 * At-least-once: we emit before marking, so a crash between the two can
 * re-broadcast (harmless — SSE consumers re-fetch and dedupe). Ordering is by
 * createdAt so receipts replay in production order.
 */
export async function drainOutbox(
  limit = 200,
): Promise<{ replayed: number; unprocessed: number }> {
  const rows = await db
    .select()
    .from(outboxEvents)
    .where(isNull(outboxEvents.processedAt))
    .orderBy(asc(outboxEvents.createdAt))
    .limit(limit);
  for (const row of rows) {
    emit(row.topic as EventName, row.payload as unknown as BusEvent);
    await db
      .update(outboxEvents)
      .set({ processedAt: new Date() })
      .where(eq(outboxEvents.id, row.id));
  }
  const [totals] = await db
    .select({ n: count() })
    .from(outboxEvents)
    .where(isNull(outboxEvents.processedAt));
  return { replayed: rows.length, unprocessed: Number(totals?.n ?? 0) };
}