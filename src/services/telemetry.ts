// MODULAR: Funnel analysis service. Queries the telemetry_events
// table and returns a per-session drop-off breakdown for two funnels:
//   1. Artist funnel: landing → nav_click → form_start → submit_attempt → submit_success
//   2. Supervisor funnel: page_view → brief_search → (result click)
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

// The canonical artist funnel steps in order. Each step is "did this
// session fire at least one event of this type?"
export const FUNNEL_STEPS = [
  'page_view',
  'nav_click',
  'form_start',
  'submit_attempt',
  'submit_success',
] as const;

// MODULAR: supervisor inverse-search funnel. Tracks how supervisors
// use the brief search: do they view the discover page, paste a
// brief, and get results? The brief_search event is fired client-side
// in DiscoverView.tsx MatchSearch.onSearch.
export const SUPERVISOR_FUNNEL_STEPS = [
  'page_view',
  'brief_search',
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
  supervisorFunnel: FunnelStepResult[];
  windowHours: number;
  generatedAt: string;
}

/**
 * Get the funnel breakdown for the last `windowHours` hours.
 * Returns per-step session counts, drop-off, and conversion rates
 * for both the artist funnel and the supervisor inverse-search funnel.
 */
export async function getFunnelBreakdown(windowHours = 168): Promise<FunnelBreakdown> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Build the select object dynamically from both funnel step arrays.
  // Each column counts DISTINCT sessions that fired that event type.
  // The `::int` cast ensures PGlite returns numbers (it may return
  // bigints as strings without the cast).
  const allSteps = [...FUNNEL_STEPS, ...SUPERVISOR_FUNNEL_STEPS];
  const selectColumns = Object.fromEntries(
    allSteps.map((step) => [
      step,
      sql<number>`count(distinct case when ${telemetryEvents.event} = ${step} then ${telemetryEvents.session} end)::int`,
    ]),
  );

  const result = await db
    .select(selectColumns)
    .from(telemetryEvents)
    .where(gte(telemetryEvents.createdAt, cutoff));

  const row = result[0];

  function computeSteps(steps: readonly string[], row: Record<string, unknown> | null): FunnelStepResult[] {
    const counts = steps.map((step) => {
      if (!row) return 0;
      const val = row[step as keyof typeof row];
      return typeof val === 'number' ? val : Number.parseInt(String(val || '0'), 10);
    });
    const total = counts[0] || 0;
    return steps.map((step, i) => {
      const sessions = counts[i];
      const prevSessions = i === 0 ? sessions : counts[i - 1];
      const dropOff = i === 0 ? 0 : Math.max(0, counts[i - 1] - sessions);
      const dropOffPct =
        i === 0 ? null : prevSessions > 0 ? Math.round((dropOff / prevSessions) * 1000) / 10 : null;
      const conversionPct =
        i === 0 ? null : total > 0 ? Math.round((sessions / total) * 1000) / 10 : null;
      return { step: step as FunnelStep, sessions, dropOff, dropOffPct, conversionPct };
    });
  }

  const steps = computeSteps(FUNNEL_STEPS, row || null);
  const supervisorFunnel = computeSteps(SUPERVISOR_FUNNEL_STEPS, row || null);
  const totalSessions = steps[0]?.sessions || 0;

  log.info('funnel breakdown generated', { windowHours, totalSessions });

  return {
    totalSessions,
    steps,
    supervisorFunnel,
    windowHours,
    generatedAt: new Date().toISOString(),
  };
}
