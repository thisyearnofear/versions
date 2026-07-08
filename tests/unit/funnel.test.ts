// MODULAR: tests for the funnel analysis service. Seeds
// telemetry_events rows directly into the test DB, then calls
// getFunnelBreakdown and asserts the per-step counts, drop-off,
// and conversion rates are correct.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, getTestPg, initTestDb, resetTestDb, closeTestDb } from '../helpers/db';
import { telemetryEvents } from '../../src/lib/schema';
import { getFunnelBreakdown, FUNNEL_STEPS } from '../../src/services/telemetry';

// Inline import so we don't need a separate vi.mock — the service
// imports `db` from @/lib/db, which is mocked in the setup below.
vi.mock('@/lib/db', () => ({
  get db() {
    return getTestDb();
  },
}));

// Suppress logger output during tests
vi.mock('@/lib/logger', () => ({
  log: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
}));

describe('funnel breakdown', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  it('returns zeroed steps when no events exist', async () => {
    const breakdown = await getFunnelBreakdown(168);

    expect(breakdown.totalSessions).toBe(0);
    expect(breakdown.steps).toHaveLength(FUNNEL_STEPS.length);
    for (const step of breakdown.steps) {
      expect(step.sessions).toBe(0);
    }
  });

  it('counts a full-funnel session correctly', async () => {
    const db = getTestDb();
    const session = 'sess-full-1';

    // One session that fires all 5 funnel events
    await db.insert(telemetryEvents).values([
      { id: 'e1', session, event: 'page_view', props: {}, clientTs: new Date() },
      { id: 'e2', session, event: 'nav_click', props: {}, clientTs: new Date() },
      { id: 'e3', session, event: 'form_start', props: {}, clientTs: new Date() },
      { id: 'e4', session, event: 'submit_attempt', props: {}, clientTs: new Date() },
      { id: 'e5', session, event: 'submit_success', props: {}, clientTs: new Date() },
    ]);

    const breakdown = await getFunnelBreakdown(168);

    expect(breakdown.totalSessions).toBe(1);
    for (const step of breakdown.steps) {
      expect(step.sessions).toBe(1);
    }
    // No drop-off in a full funnel
    expect(breakdown.steps[0].dropOff).toBe(0);
    expect(breakdown.steps[1].dropOff).toBe(0);
    expect(breakdown.steps[4].dropOff).toBe(0);
    // 100% conversion all the way through
    expect(breakdown.steps[4].conversionPct).toBe(100);
  });

  it('counts drop-off when sessions bail at different steps', async () => {
    const db = getTestDb();

    // Session A: lands + navigates but doesn't start the form
    await db.insert(telemetryEvents).values([
      { id: 'a1', session: 'sess-a', event: 'page_view', props: {}, clientTs: new Date() },
      { id: 'a2', session: 'sess-a', event: 'nav_click', props: {}, clientTs: new Date() },
    ]);

    // Session B: lands only (bounces immediately)
    await db.insert(telemetryEvents).values([
      { id: 'b1', session: 'sess-b', event: 'page_view', props: {}, clientTs: new Date() },
    ]);

    // Session C: full funnel
    await db.insert(telemetryEvents).values([
      { id: 'c1', session: 'sess-c', event: 'page_view', props: {}, clientTs: new Date() },
      { id: 'c2', session: 'sess-c', event: 'nav_click', props: {}, clientTs: new Date() },
      { id: 'c3', session: 'sess-c', event: 'form_start', props: {}, clientTs: new Date() },
      { id: 'c4', session: 'sess-c', event: 'submit_attempt', props: {}, clientTs: new Date() },
      { id: 'c5', session: 'sess-c', event: 'submit_success', props: {}, clientTs: new Date() },
    ]);

    const breakdown = await getFunnelBreakdown(168);

    expect(breakdown.totalSessions).toBe(3);
    // page_view: 3 sessions
    expect(breakdown.steps[0].sessions).toBe(3);
    // nav_click: 2 sessions (A + C, not B)
    expect(breakdown.steps[1].sessions).toBe(2);
    expect(breakdown.steps[1].dropOff).toBe(1); // B dropped off
    expect(breakdown.steps[1].dropOffPct).toBe(33.3); // 1/3 = 33.3%
    // form_start: 1 session (C only)
    expect(breakdown.steps[2].sessions).toBe(1);
    expect(breakdown.steps[2].dropOff).toBe(1); // A dropped off
    expect(breakdown.steps[2].dropOffPct).toBe(50); // 1/2 = 50%
    // submit_attempt: 1 session
    expect(breakdown.steps[3].sessions).toBe(1);
    // submit_success: 1 session
    expect(breakdown.steps[4].sessions).toBe(1);
    // Overall conversion: 1/3 = 33.3%
    expect(breakdown.steps[4].conversionPct).toBe(33.3);
  });

  it('counts each session once even if it fires the same event multiple times', async () => {
    const db = getTestDb();
    const session = 'sess-multi';

    // One session fires page_view 3 times (navigated between pages)
    // and nav_click 2 times
    await db.insert(telemetryEvents).values([
      { id: 'm1', session, event: 'page_view', props: {}, clientTs: new Date() },
      { id: 'm2', session, event: 'page_view', props: {}, clientTs: new Date() },
      { id: 'm3', session, event: 'page_view', props: {}, clientTs: new Date() },
      { id: 'm4', session, event: 'nav_click', props: {}, clientTs: new Date() },
      { id: 'm5', session, event: 'nav_click', props: {}, clientTs: new Date() },
    ]);

    const breakdown = await getFunnelBreakdown(168);

    expect(breakdown.totalSessions).toBe(1);
    expect(breakdown.steps[0].sessions).toBe(1); // page_view counted once
    expect(breakdown.steps[1].sessions).toBe(1); // nav_click counted once
  });

  it('respects the time window', async () => {
    const db = getTestDb();
    const pg = getTestPg();

    // Insert an old event (10 days ago) and a recent one (now)
    await db.insert(telemetryEvents).values([
      { id: 'old1', session: 'sess-old', event: 'page_view', props: {}, clientTs: new Date() },
    ]);

    // Manually backdate the old event
    await pg.exec(
      `UPDATE telemetry_events SET created_at = NOW() - INTERVAL '10 days' WHERE id = 'old1';`,
    );

    await db.insert(telemetryEvents).values([
      { id: 'new1', session: 'sess-new', event: 'page_view', props: {}, clientTs: new Date() },
    ]);

    // 168h window (7 days) — should only see the recent session
    const breakdown = await getFunnelBreakdown(168);
    expect(breakdown.totalSessions).toBe(1);

    // 720h window (30 days) — should see both
    const breakdownWide = await getFunnelBreakdown(720);
    expect(breakdownWide.totalSessions).toBe(2);
  });

  it('includes the windowHours and generatedAt metadata', async () => {
    const breakdown = await getFunnelBreakdown(48);
    expect(breakdown.windowHours).toBe(48);
    expect(breakdown.generatedAt).toBeTruthy();
    // generatedAt should be a valid ISO date
    expect(new Date(breakdown.generatedAt).getTime()).not.toBeNaN();
  });
});
