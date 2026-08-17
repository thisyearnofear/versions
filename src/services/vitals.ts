// MODULAR: Admin vitals — the money-path vital signs in one read:
//   1. supervisor search latency (p50 / p95 / max, client-observed ms)
//   2. durable outbox depth (unprocessed receipts + oldest backlog age)
//   3. settlement sweeper health (last tick, settled/failed counts)
//   4. retention (last prune report)
//
// READ-ONLY: this service never writes. It is the operational complement
// to /api/v1/funnel (which measures conversion, this measures health).
//
// PERFORMANT: two aggregate queries total (one per table); both hit
// existing indexes (created_at on brief_searches, processed_at on
// outbox_events).

import { sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { retentionStatus, type RetentionReport } from './outbox';
import type { Sweeper, SweeperStats } from './settlement-sweeper';

export interface SearchLatencyStats {
  windowHours: number;
  /** Searches with a recorded duration in the window. */
  searches: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface OutboxDepth {
  unprocessed: number;
  processed: number;
  /** Age of the oldest unprocessed receipt, seconds (null if none). */
  oldestUnprocessedAgeSec: number | null;
}

export interface VitalsReport {
  generatedAt: string;
  search: SearchLatencyStats;
  outbox: OutboxDepth;
  sweeper: SweeperStats;
  retention: RetentionReport;
}

export function getVitals(sweeper: Sweeper, windowHours = 24): Promise<VitalsReport> {
  return Promise.all([searchLatency(windowHours), outboxDepth()]).then(
    ([search, outbox]) => ({
      generatedAt: new Date().toISOString(),
      search,
      outbox,
      sweeper: sweeper.stats(),
      retention: retentionStatus(),
    }),
  );
}

async function searchLatency(hours: number): Promise<SearchLatencyStats> {
  const result = await db.execute(sql`
    select
      count(*) filter (where duration_ms is not null)::int as searches,
      percentile_cont(0.50) within group (order by duration_ms)
        filter (where duration_ms is not null) as p50,
      percentile_cont(0.95) within group (order by duration_ms)
        filter (where duration_ms is not null) as p95,
      max(duration_ms) filter (where duration_ms is not null) as max_ms
    from brief_searches
    where created_at > now() - make_interval(hours => ${hours})
  `);
  const row = (result as { rows: Array<Record<string, unknown>> }).rows[0] ?? {};
  return {
    windowHours: hours,
    searches: Number(row.searches ?? 0),
    p50Ms: roundOrNull(row.p50),
    p95Ms: roundOrNull(row.p95),
    maxMs: roundOrNull(row.max_ms),
  };
}

async function outboxDepth(): Promise<OutboxDepth> {
  const result = await db.execute(sql`
    select
      count(*) filter (where processed_at is null)::int as unprocessed,
      count(*) filter (where processed_at is not null)::int as processed,
      max(EXTRACT(EPOCH FROM (now() - created_at)))
        filter (where processed_at is null)::int as oldest_unprocessed_age_sec
    from outbox_events
  `);
  const row = (result as { rows: Array<Record<string, unknown>> }).rows[0] ?? {};
  return {
    unprocessed: Number(row.unprocessed ?? 0),
    processed: Number(row.processed ?? 0),
    oldestUnprocessedAgeSec: roundOrNull(row.oldest_unprocessed_age_sec),
  };
}

function roundOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
