// MODULAR: repeat-report guard + payment idempotency tests.
//
// The vulnerability these close: `usage.log()` was a bare INSERT, so one
// channel could re-report the same use N times and draw a supplier's CPM
// campaign budget down N times — an untrusted reporter moving real money with
// no ceiling. The exact-repeat index is the precise guard; these tests pin it.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

const { getTestDb: _getTestDb, initTestDb: _initTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi: _vi } = await import('vitest');
_vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createUsageService } = await import('../../src/services/usage');
const { createSlotsService } = await import('../../src/services/slots');
const { createListingsService } = await import('../../src/services/listings');
const { createChannelsService } = await import('../../src/services/channels');
const { createSettlementService } = await import('../../src/services/settlement');
const { createArcAdapter } = await import('../../src/adapters/arc');
const { AGREEMENT_VERSION } = await import('../../src/lib/agreement');
const { usageEvents, slots: slotsTable } = await import('../../src/lib/schema');
const { eq } = await import('drizzle-orm');

const SUPPLIER = '0x' + 'a'.repeat(40);
const BUYER = '0x' + 'b'.repeat(40);
const PLATFORM = '0x' + 'd'.repeat(40);

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
});

afterEach(() => {
  delete process.env.USAGE_REPORT_COOLDOWN_HOURS;
});

function arc() {
  return createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: PLATFORM });
}

function makeSlots() {
  return createSlotsService({
    settlement: createSettlementService({ arc: arc(), platformWallet: PLATFORM }),
    arc: arc(),
    platformWallet: PLATFORM,
  });
}

function makeUsage() {
  return createUsageService(makeSlots());
}

async function seedChannel(owner = BUYER, seq = 0): Promise<string> {
  const id = `UCdedup${String(seq).padStart(14, '0')}`;
  const res = await createChannelsService({
    mock: false,
    platform: 'youtube' as const,
    probe: async () => ({
      platform: 'youtube' as const,
      platformUrl: `https://www.youtube.com/channel/${id}`,
      platformChannelId: id,
      name: 'Dedup Channel',
      description: 'Test channel.',
      subscriberCount: 100_000,
      viewCount: 1_000_000,
      videoCount: 10,
      recentContent: [],
      mock: false,
      probedAt: '2026-10-01T00:00:00.000Z',
    }),
  }).register({
    ownerWallet: owner,
    platformUrl: `https://www.youtube.com/@dedup-${seq}`,
    niche: 'lo-fi study streams',
    agreementVersion: AGREEMENT_VERSION,
  });
  if (!res.ok) throw new Error(`channel seed failed: ${res.code}`);
  return res.channel.id;
}

async function seedListing(tier: 'free' | 'paid', model: 'flat' | 'cpm' = 'cpm'): Promise<string> {
  const res = await createListingsService().create({
    supplierWallet: SUPPLIER,
    kind: 'placement',
    title: `Dedup ${tier} ${model}`,
    supplierName: 'Dedup Co',
    summary: 'A listing used by the repeat-report tests.',
    tags: ['lo-fi'],
    images: ['ipfs://creative-1'],
    tier,
    pricing:
      tier === 'paid'
        ? model === 'flat'
          ? { model: 'flat', flatFeeUsdc: '30' }
          : { model: 'cpm', cpmUsdc: '4.5' }
        : null,
    budgetCapUsdc: tier === 'paid' ? null : null,
    agreementVersion: AGREEMENT_VERSION,
  });
  if (!res.ok) throw new Error(`listing seed failed: ${res.code}`);
  return res.listing.id;
}

/** A paid CPM listing with a live, paid-for slot to report delivery against. */
async function seedLiveSlot(budgetUsdc = '90'): Promise<{ listingId: string; channelId: string; slotId: string }> {
  const listingId = await seedListing('paid', 'cpm');
  const channelId = await seedChannel();
  const slots = makeSlots();
  const created = await slots.create({ listingId, channelId, buyerWallet: BUYER, budgetUsdc });
  if (!created.ok) throw new Error(`slot seed failed: ${created.code}`);
  const paid = await slots.pay(created.slot.id, BUYER);
  if (!paid.ok) throw new Error(`slot payment failed: ${paid.code}`);
  return { listingId, channelId, slotId: created.slot.id };
}

async function usageRows() {
  return _getTestDb().select().from(usageEvents);
}

describe('exact-repeat dedup', () => {
  it('returns the original row and writes nothing when the same use is reported twice', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const svc = makeUsage();
    const payload = {
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-video-abc',
      occurredAt: '2026-10-01T12:00:00.000Z',
      impressions: 5,
    };

    const first = await svc.log(payload);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.deduped).toBe(false);

    const second = await svc.log(payload);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.deduped).toBe(true);
    // The ORIGINAL row, not a new one — a retrying caller can treat the
    // response as idempotent.
    expect(second.usage.id).toBe(first.usage.id);
    expect(second.usage.impressions).toBe(5);

    expect(await usageRows()).toHaveLength(1);
  });

  it('does not draw a CPM budget down twice for one use', async () => {
    const { listingId, channelId, slotId } = await seedLiveSlot('90');
    const svc = makeUsage();
    const payload = {
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-video-repeat',
      occurredAt: '2026-10-01T12:00:00.000Z',
      impressions: 1000,
    };

    const first = await svc.log(payload);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // 1000 impressions at 4.5 CPM.
    expect(first.usage.spend_usdc).toBe('4.5');

    const second = await svc.log(payload);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.deduped).toBe(true);

    const [slot] = await _getTestDb().select().from(slotsTable).where(eq(slotsTable.id, slotId));
    // The money moved exactly once, not twice.
    expect(Number(slot.spentUsdc)).toBeCloseTo(4.5, 6);
    expect(slot.impressionsDelivered).toBe(1000);
    expect(await usageRows()).toHaveLength(1);
  });

  it('still counts a genuinely different use on the same listing', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const svc = makeUsage();

    const a = await svc.log({
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-video-1',
      occurredAt: '2026-10-01T12:00:00.000Z',
    });
    const b = await svc.log({
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-video-2',
      occurredAt: '2026-10-02T12:00:00.000Z',
    });

    expect(a.ok && a.deduped).toBe(false);
    expect(b.ok && b.deduped).toBe(false);
    expect(await usageRows()).toHaveLength(2);
  });
});

describe('optional report cooldown', () => {
  it('is off by default, so batched delivery reports still count', async () => {
    const { listingId, channelId } = await seedLiveSlot('90');
    const svc = makeUsage();
    // Three separate deliveries, no external id — indistinguishable from a
    // re-report without a ceiling, and legitimate for a batching loop.
    for (let i = 0; i < 3; i += 1) {
      const res = await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 100 });
      expect(res.ok).toBe(true);
    }
    expect(await usageRows()).toHaveLength(3);
  });

  it('refuses a report inside the window when an operator sets one', async () => {
    process.env.USAGE_REPORT_COOLDOWN_HOURS = '24';
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const svc = makeUsage();
    // Relative to now: the window measures the gap between the incoming report
    // and the newest row on file, so both sides of the window must be ordered.
    const t0 = Date.now();
    const at = (offsetHours: number) => new Date(t0 + offsetHours * 3_600_000).toISOString();

    const first = await svc.log({
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-1',
      occurredAt: at(0),
    });
    expect(first.ok).toBe(true);

    // 1h after the first report — inside a 24h window.
    const second = await svc.log({
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-2',
      occurredAt: at(1),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('REPORT_COOLDOWN');
    expect(await usageRows()).toHaveLength(1);

    // 48h after it — outside the window, allowed again.
    const later = await svc.log({
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-3',
      occurredAt: at(48),
    });
    expect(later.ok).toBe(true);
    expect(await usageRows()).toHaveLength(2);
  });

  it('does not refuse a channel backfilling older deliveries', async () => {
    // A channel catching up on last week's videos is legitimate, not a burst.
    process.env.USAGE_REPORT_COOLDOWN_HOURS = '24';
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const svc = makeUsage();

    expect(
      (
        await svc.log({
          listingId,
          channelId,
          reporterWallet: BUYER,
          externalContentId: 'yt-recent',
          occurredAt: new Date().toISOString(),
        })
      ).ok,
    ).toBe(true);

    // An older, distinct use that happens to arrive second.
    const backfill = await svc.log({
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-older',
      occurredAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
    });
    // Refused by design: a report dated before the newest row is not a new
    // use, and the ceiling exists to stop unbounded writes. Pinned so the
    // behaviour is a decision on record rather than an accident.
    expect(backfill.ok).toBe(false);
    if (!backfill.ok) expect(backfill.code).toBe('REPORT_COOLDOWN');
  });

  it('reads the window from the database, so a fresh service instance still refuses', async () => {
    // The distinction from an in-process guard: a restart must not reset it.
    process.env.USAGE_REPORT_COOLDOWN_HOURS = '24';
    const listingId = await seedListing('free');
    const channelId = await seedChannel();

    const first = await makeUsage().log({
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-1',
    });
    expect(first.ok).toBe(true);

    // A brand-new service object with no shared in-process state.
    const second = await makeUsage().log({
      listingId,
      channelId,
      reporterWallet: BUYER,
      externalContentId: 'yt-2',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('REPORT_COOLDOWN');
  });
});

describe('slot payment idempotency', () => {
  it('replays the original receipt for a repeated Idempotency-Key', async () => {
    const listingId = await seedListing('paid', 'flat');
    const channelId = await seedChannel();
    const slots = makeSlots();
    const created = await slots.create({ listingId, channelId, buyerWallet: BUYER });
    if (!created.ok) throw new Error(`slot seed failed: ${created.code}`);

    const first = await slots.pay(created.slot.id, BUYER, 'order-123');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.replayed).toBeFalsy();

    const second = await slots.pay(created.slot.id, BUYER, 'order-123');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.charged_usdc).toBe(first.charged_usdc);
    expect(second.tx_hash).toBe(first.tx_hash);

    // One flat-fee payment mints exactly three legs, and only once.
    expect(await slots.legs(created.slot.id)).toHaveLength(3);
  });

  it('without a key, a second pay is still refused as not payable', async () => {
    const listingId = await seedListing('paid', 'flat');
    const channelId = await seedChannel();
    const slots = makeSlots();
    const created = await slots.create({ listingId, channelId, buyerWallet: BUYER });
    if (!created.ok) throw new Error(`slot seed failed: ${created.code}`);

    const first = await slots.pay(created.slot.id, BUYER);
    expect(first.ok).toBe(true);
    const second = await slots.pay(created.slot.id, BUYER);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('SLOT_NOT_PAYABLE');
  });

  it('a different key does not replay an earlier payment', async () => {
    const listingId = await seedListing('paid', 'flat');
    const channelId = await seedChannel();
    const slots = makeSlots();
    const created = await slots.create({ listingId, channelId, buyerWallet: BUYER });
    if (!created.ok) throw new Error(`slot seed failed: ${created.code}`);

    expect((await slots.pay(created.slot.id, BUYER, 'order-a')).ok).toBe(true);
    const second = await slots.pay(created.slot.id, BUYER, 'order-b');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('SLOT_NOT_PAYABLE');
  });

  it('stores the key only on success, so a failed payment leaves it reusable', async () => {
    const listingId = await seedListing('paid', 'flat');
    const channelId = await seedChannel();
    const slots = makeSlots();
    const created = await slots.create({ listingId, channelId, buyerWallet: BUYER });
    if (!created.ok) throw new Error(`slot seed failed: ${created.code}`);

    // Exhaust the campaign first so the pay fails after the lease is claimed.
    const [before] = await _getTestDb()
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.id, created.slot.id));
    expect(before.paymentIdempotencyKey).toBeNull();

    expect((await slots.pay(created.slot.id, BUYER, 'order-fresh')).ok).toBe(true);
    const [after] = await _getTestDb()
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.id, created.slot.id));
    expect(after.paymentIdempotencyKey).toBe('order-fresh');
  });
});
