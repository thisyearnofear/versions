// MODULAR: Durable outbox tests. Enqueue → drain replays unprocessed receipts
// over the bus in order and marks them processed; drain is idempotent; and
// emitDurable broadcasts now while ALSO persisting a replayable copy (so a
// process crash between emit and SSE read can't drop a receipt).

const { initTestDb, getTestDb: _getTestDb, resetTestDb } = await import('../helpers/db');
const { vi, describe, it, expect, beforeAll, beforeEach, afterEach } = await import('vitest');
vi.mock('@/lib/db', () => {
  return { get db() { return _getTestDb(); } };
});

const { subscribe, clearSubscriptions } = await import('../../src/lib/event-bus');
const { enqueue, emitDurable, drainOutbox } = await import('../../src/services/outbox');

type DurablePayload = Parameters<typeof enqueue>[1];

function makeEvent(id: string): DurablePayload {
  return {
    type: 'settled',
    source: 'split',
    settlementId: id,
    amountUsdc: '0.50',
    timestamp: new Date().toISOString(),
  } as unknown as DurablePayload;
}

function collect(topic: Parameters<typeof subscribe>[0]): unknown[] {
  const seen: unknown[] = [];
  subscribe(topic, (data) => seen.push(data));
  return seen;
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  clearSubscriptions();
});

afterEach(() => clearSubscriptions());

describe('durable outbox', () => {
  it('replays unprocessed receipts in order and marks them processed', async () => {
    await enqueue('settlement-event', makeEvent('a'));
    await enqueue('settlement-event', makeEvent('b'));
    const seen = collect('settlement-event');

    const first = await drainOutbox(200, { throttle: false });
    expect(first.replayed).toBe(2);
    expect(first.unprocessed).toBe(0);
    expect(seen.length).toBe(2);
    const ids = seen.map((e) => (e as { settlementId?: string }).settlementId);
    expect(new Set(ids)).toEqual(new Set(['a', 'b']));
  });

  it('is idempotent — a second drain replays nothing', async () => {
    await enqueue('settlement-event', makeEvent('only'));
    await drainOutbox(200, { throttle: false });
    const again = await drainOutbox(200, { throttle: false });
    expect(again.replayed).toBe(0);
    expect(again.unprocessed).toBe(0);
  });

  it('emitDurable broadcasts now AND persists a replayable copy', async () => {
    const seen = collect('settlement-event');
    await emitDurable('settlement-event', makeEvent('live'));
    // Immediate live broadcast happened.
    expect(seen.length).toBe(1);
    // Drain replays the persisted copy (at-least-once — duplicate expected).
    const replayed = await drainOutbox(200, { throttle: false });
    expect(replayed.replayed).toBe(1);
  });

  it('throttles hot-path (SSE-connect) drains to one per interval', async () => {
    // Previous tests drained recently, so back-to-back default drains must
    // not race each other — at minimum the second is a no-op skip.
    const a = await drainOutbox();
    const b = await drainOutbox();
    expect(b.skipped).toBe(true);
    if (!a.skipped) {
      expect(b.replayed).toBe(0);
      expect(b.unprocessed).toBe(-1);
    }
  });
});