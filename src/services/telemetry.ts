// MODULAR: Funnel analysis service. Queries the telemetry_events
// table and returns a per-session drop-off breakdown for the core
// funnel: landing → nav_click → form_start → submit_attempt →
// submit_success.
//
// Uses the Drizzle query builder with sql<number> expressions for
// COUNT(DISTINCT CASE WHEN ...) per step. This works correctly with
// both the Neon HTTP adapter (production) and the PGlite adapter
// (tests), returning properly typed numbers.
//
// LIMITATION: this is an event-based funnel, not a sequence-based
// one. A session that fires submit_success without first firing
// submit_attempt would still be counted. In practice the client
// fires events in order, so this can't happen — but the query
// doesn't enforce ordering. A sequence-based funnel would require
// window functions (LAG/LEAD over session partitions) which is
// heavier and unnecessary for v1.

import { db } from '../lib/db';
import { telemetryEvents } from '../lib/schema';
import { sql, gte } from 'drizzle-orm';
import { log } from '../lib/logger';

// The canonical funnel steps in order. Each step is "did this
// session fire at least one event of this type?"
export const FUNNEL_STEPS = [
  'page_view',
  'nav_click',
  'form_start',
  'submit_attempt',
  'submit_success',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelStepResult {
  step: FunnelStep;
  sessions: number;
  dropOff: number; // sessions lost from the previous step
  dropOffPct: number | null; // drop-off as % of previous step (null for step 0)
  conversionPct: number | null; // sessions at this step as % of step 0 (null for step 0)
}

export interface FunnelBreakdown {
  totalSessions: number;
  steps: FunnelStepResult[];
  windowHours: number;
  generatedAt: string;
}

/**
 * Get the funnel breakdown for the last `windowHours` hours.
 * Returns per-step session counts, drop-off, and conversion rates.
 */
export async function getFunnelBreakdown(windowHours = 168): Promise<FunnelBreakdown> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Build the select object dynamically from FUNNEL_STEPS so the
  // array remains the single source of truth. Each column counts
  // DISTINCT sessions that fired that event type. The `::int` cast
  // ensures PGlite returns numbers (it may return bigints as
  // strings without the cast).
  const selectColumns = Object.fromEntries(
    FUNNEL_STEPS.map((step) => [
      step,
      sql<number>`count(distinct case when ${telemetryEvents.event} = ${step} then ${telemetryEvents.session} end)::int`,
    ]),
  );

  const result = await db
    .select(selectColumns)
    .from(telemetryEvents)
    .where(gte(telemetryEvents.createdAt, cutoff));

  const row = result[0];

  if (!row) {
    return {
      totalSessions: 0,
      steps: FUNNEL_STEPS.map((step, i) => ({
        step,
        sessions: 0,
        dropOff: 0,
        dropOffPct: i === 0 ? null : 0,
        conversionPct: i === 0 ? null : 0,
      })),
      windowHours,
      generatedAt: new Date().toISOString(),
    };
  }

  const counts = FUNNEL_STEPS.map((step) => {
    const val = row[step as keyof typeof row];
    return typeof val === 'number' ? val : Number.parseInt(String(val || '0'), 10);
  });

  const totalSessions = counts[0] || 0;
  const steps: FunnelStepResult[] = FUNNEL_STEPS.map((step, i) => {
    const sessions = counts[i];
    const prevSessions = i === 0 ? sessions : counts[i - 1];
    const dropOff = i === 0 ? 0 : Math.max(0, counts[i - 1] - sessions);
    const dropOffPct =
      i === 0 ? null : prevSessions > 0 ? Math.round((dropOff / prevSessions) * 1000) / 10 : null;
    const conversionPct =
      i === 0 ? null : totalSessions > 0 ? Math.round((sessions / totalSessions) * 1000) / 10 : null;
    return { step, sessions, dropOff, dropOffPct, conversionPct };
  });

  log.info('funnel breakdown generated', { windowHours, totalSessions });

  return {
    totalSessions,
    steps,
    windowHours,
    generatedAt: new Date().toISOString(),
  };
}
