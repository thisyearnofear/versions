import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  reservePlacement,
  payPlacement,
  reportPlacementUsage,
  MarketplaceError,
} from '../../src/lib/marketplace-client';

function stubFetch(impl: (input: unknown, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reservePlacement', () => {
  it('POSTs the reservation and never pays', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    stubFetch(async (input, init) => {
      calls.push({ url: String(input), init });
      return ok({ slot: { id: 'slot-1', status: 'pending_payment' }, alreadyExisted: false }, 201);
    });
    const res = await reservePlacement('listing-1', 'channel-1', '50');
    expect(res.slot.id).toBe('slot-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/v1/slots');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({ listingId: 'listing-1', channelId: 'channel-1', budgetUsdc: '50' });
  });

  it('returns an existing active slot for re-use (no second reserve)', async () => {
    stubFetch(async () => ok({ slot: { id: 'slot-9', status: 'active' }, alreadyExisted: true }));
    const res = await reservePlacement('l', 'c', null);
    expect(res.alreadyExisted).toBe(true);
    expect(res.slot.status).toBe('active');
  });
});

describe('payPlacement', () => {
  it('pays the same slot id, keeping mock + legs verbatim', async () => {
    stubFetch(async (input) => {
      expect(String(input)).toBe('/api/v1/slots/slot-1/pay');
      return ok({ slot: { id: 'slot-1', status: 'active' }, charged_usdc: '25', tx_hash: '0xh', mock: false, legs: [] });
    });
    const res = await payPlacement('slot-1');
    expect(res.charged_usdc).toBe('25');
    expect(res.mock).toBe(false);
  });

  it('propagates the server error code on failure', async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({ success: false, error: { code: 'PAYMENT_FAILED', message: 'Held for reconciliation.' } }),
        { status: 502 },
      ),
    );
    const err = await payPlacement('slot-1').catch((e) => e);
    expect(err).toBeInstanceOf(MarketplaceError);
    expect(err.code).toBe('PAYMENT_FAILED');
  });
});

describe('reportPlacementUsage', () => {
  it('sends the exact payload — no spend, no reportedBy', async () => {
    let sent: Record<string, unknown> | null = null;
    stubFetch(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return ok({ usage: { id: 'u1', spend_usdc: '0', reported_by: 'channel' } }, 201);
    });
    await reportPlacementUsage({
      listingId: 'l1',
      channelId: 'c1',
      slotId: 's1',
      videoUrl: 'https://youtube.com/watch?v=x',
      impressions: 100,
      clicks: 2,
    });
    expect(sent).toEqual({
      listingId: 'l1',
      channelId: 'c1',
      slotId: 's1',
      videoUrl: 'https://youtube.com/watch?v=x',
      impressions: 100,
      clicks: 2,
    });
    expect('spendUsdc' in sent!).toBe(false);
    expect('reportedBy' in sent!).toBe(false);
  });
});
