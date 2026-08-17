// MODULAR: Admin vitals tests. Verifies the aggregate SQL (percentile
// latency + outbox depth) against the PGlite fixture: empty state reports
// zeros/nulls, and logged search durations produce correct p50/p95.

const { initTestDb, getTestDb, resetTestDb } = await import('../helpers/db');
const { vi, describe, it, expect, beforeAll, beforeEach } = await import('vitest');
import type { Sweeper } from '../../src/services/settlement-sweeper';
vi.mock('@/lib/db', () => {
  return { get db() { return getTestDb(); } };
});

const { getVitals } = await import('../../src/services/vitals');
const { briefSearches, outboxEvents, supervisorProfiles, users } = await import(
  '../../src/lib/schema'
);

const stubSweeper: Sweeper = {
  start() {},
  stop() {},
  tick: async () => {},
  stats: () => ({ last_run_at: null, last_run_stats: null, running: false }),
};

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe('admin vitals', () => {
  it('reports zeros and nulls on an empty database', async () => {
    const v = await getVitals(stubSweeper, 24);
    expect(v.search.searches).toBe(0);
    expect(v.search.p50Ms).toBeNull();
    expect(v.search.p95Ms).toBeNull();
    expect(v.search.maxMs).toBeNull();
    expect(v.outbox.unprocessed).toBe(0);
    expect(v.outbox.processed).toBe(0);
    expect(v.outbox.oldestUnprocessedAgeSec).toBeNull();
    expect(v.sweeper.running).toBe(false);
  });

  it('computes latency percentiles from logged search durations', async () => {
    const db = getTestDb();
    const wallet = '0x' + '1'.padStart(40, '1');
    await db.insert(users).values({ id: 'u1', walletAddress: wallet });
    await db.insert(supervisorProfiles).values({ wallet });
    // Durations 100, 200, 300 → p50 = 200, p95 ≈ 295, max = 300.
    // One row without duration (legacy) must be excluded from aggregates.
    await db.insert(briefSearches).values([
      { id: 's1', supervisorWallet: wallet, briefText: 'a', resultsCount: 5, durationMs: 100 },
      { id: 's2', supervisorWallet: wallet, briefText: 'b', resultsCount: 7, durationMs: 200 },
      { id: 's3', supervisorWallet: wallet, briefText: 'c', resultsCount: 3, durationMs: 300 },
      { id: 's4', supervisorWallet: wallet, briefText: 'd', resultsCount: 0, durationMs: null },
    ]);

    const v = await getVitals(stubSweeper, 24);
    expect(v.search.searches).toBe(3);
    expect(v.search.p50Ms).toBe(200);
    expect(v.search.p95Ms).toBeGreaterThanOrEqual(290);
    expect(v.search.p95Ms).toBeLessThanOrEqual(300);
    expect(v.search.maxMs).toBe(300);
  });

  it('reports outbox depth and oldest backlog age', async () => {
    const db = getTestDb();
    await db.insert(outboxEvents).values([
      { id: 'o1', topic: 'settlement-event', payload: { type: 'settled' }, createdAt: new Date(Date.now() - 60_000) },
      { id: 'o2', topic: 'economy-event', payload: { type: 'agent_reviewed' } },
      {
        id: 'o3',
        topic: 'feed-update',
        payload: { type: 'published' },
        processedAt: new Date(),
      },
    ]);

    const v = await getVitals(stubSweeper, 24);
    expect(v.outbox.unprocessed).toBe(2);
    expect(v.outbox.processed).toBe(1);
    expect(v.outbox.oldestUnprocessedAgeSec).toBeGreaterThanOrEqual(50);
    expect(v.outbox.oldestUnprocessedAgeSec).toBeLessThan(120);
  });
});
