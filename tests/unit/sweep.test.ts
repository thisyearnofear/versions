// MODULAR: Traffic-driven sweep throttle tests. maybeSweep must run the full
// sweep body at most once per interval, never overlap, and swallow failures
// (a broken DB degrades to one warning per interval, not a retry storm on
// every SSE connect). runSweep itself is the shared body behind the daily
// cron safety net, so its composition (tick → drain → prune) is asserted too.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTick = vi.fn(async () => {});
const mockDrainOutbox = vi.fn(async () => ({ replayed: 0, unprocessed: 0 }));
const mockPruneRetention = vi.fn(async () => ({ pruned: {}, skipped: false, prunedAt: null }));

vi.mock('../../src/lib/services', () => ({
  services: () => ({ sweeper: { tick: mockTick } }),
}));
vi.mock('../../src/services/outbox', () => ({
  drainOutbox: (...args: unknown[]) => mockDrainOutbox(...(args as [])),
  pruneRetention: () => mockPruneRetention(),
}));

async function freshSweep() {
  vi.resetModules();
  return await import('../../src/services/sweep');
}

beforeEach(() => {
  mockTick.mockClear();
  mockDrainOutbox.mockClear();
  mockPruneRetention.mockClear();
});

describe('maybeSweep', () => {
  it('runs tick → drain → prune on a cold interval', async () => {
    const { maybeSweep } = await freshSweep();
    const outcome = await maybeSweep();
    expect(outcome.ran).toBe(true);
    expect(mockTick).toHaveBeenCalledTimes(1);
    // The sweep drain is authoritative — throttle must be bypassed.
    expect(mockDrainOutbox).toHaveBeenCalledWith(200, { throttle: false });
    expect(mockPruneRetention).toHaveBeenCalledTimes(1);
  });

  it('throttles a second call inside the interval', async () => {
    const { maybeSweep } = await freshSweep();
    await maybeSweep();
    const second = await maybeSweep();
    expect(second.ran).toBe(false);
    expect(second.skipped).toBe('throttled');
    expect(mockTick).toHaveBeenCalledTimes(1);
  });

  it('never overlaps a sweep that is still in flight', async () => {
    let releaseTick: () => void = () => {};
    mockTick.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseTick = resolve; }),
    );
    const { maybeSweep } = await freshSweep();
    const first = maybeSweep();
    const overlapping = await maybeSweep();
    expect(overlapping.skipped).toBe('in-flight');
    releaseTick();
    expect((await first).ran).toBe(true);
  });

  it('swallows failures and still counts the attempt', async () => {
    mockTick.mockRejectedValueOnce(new Error('quota exceeded'));
    const { maybeSweep } = await freshSweep();
    const failed = await maybeSweep();
    expect(failed.ran).toBe(false);
    expect(failed.report).toBeUndefined();
    // The failed attempt holds the interval — next call is throttled, not
    // an immediate retry against the same broken DB.
    const next = await maybeSweep();
    expect(next.skipped).toBe('throttled');
    expect(mockTick).toHaveBeenCalledTimes(1);
  });
});
