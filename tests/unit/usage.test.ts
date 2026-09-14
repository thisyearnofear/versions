// MODULAR: Usage instrumentation tests.
//
// The point of this file is the trust boundary, not the happy path. Usage
// rows are the free tier's attribution record and the paid tier's delivery
// proof, so the invariants that matter are: spend is never taken from the
// reporter, provenance is never asserted by the reporter, free supply cannot
// be reported against a paid campaign, and paid supply cannot be used without
// a slot.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

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
const { UsageReportSchema } = await import('../../src/lib/validation');
const { AGREEMENT_VERSION } = await import('../../src/lib/agreement');
const { usageEvents, slots: slotsTable, listings: listingsTable } = await import('../../src/lib/schema');
const { eq } = await import('drizzle-orm');

const SUPPLIER = '0x' + 'a'.repeat(40);
const BUYER = '0x' + 'b'.repeat(40);
const STRANGER = '0x' + 'c'.repeat(40);
const PLATFORM = '0x' + 'd'.repeat(40);

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
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

function platformProbe(seq = 0) {
  const id = `UCdemo${String(seq).padStart(19, '0')}`;
  return {
    mock: false,
    platform: 'youtube' as const,
    probe: async () => ({
      platform: 'youtube' as const,
      platformUrl: `https://www.youtube.com/channel/${id}`,
      platformChannelId: id,
      name: 'Lo-Fi Automation',
      description: 'Twenty-four hour lo-fi study streams.',
      subscriberCount: 120_000,
      viewCount: 9_000_000,
      videoCount: 340,
      recentContent: ['lofi beat to study to — 3 hour mix'],
      mock: false,
      probedAt: '2026-09-14T00:00:00.000Z',
    }),
  };
}

async function seedChannel(owner = BUYER, seq = 0): Promise<string> {
  const res = await createChannelsService(platformProbe(seq)).register({
    ownerWallet: owner,
    platformUrl: `https://www.youtube.com/@demolo-fi-${seq}`,
    niche: 'lo-fi study streams',
    agreementVersion: AGREEMENT_VERSION,
  });
  if (!res.ok) throw new Error(`channel seed failed: ${res.code}`);
  return res.channel.id;
}

async function seedListing(tier: 'free' | 'paid', opts: { model?: 'flat' | 'cpm'; budgetCapUsdc?: string } = {}): Promise<string> {
  const model = opts.model ?? 'flat';
  const res = await createListingsService().create({
    supplierWallet: SUPPLIER,
    kind: 'placement',
    title: 'Cold Brew Kit',
    supplierName: 'Cold Brew Co',
    summary: 'A pour-over kit for late-night sessions.',
    tags: ['lo-fi', 'coffee'],
    images: ['ipfs://creative-1'],
    tier,
    pricing:
      tier === 'paid'
        ? model === 'flat'
          ? { model: 'flat', flatFeeUsdc: '30' }
          : { model: 'cpm', cpmUsdc: '4.5' }
        : null,
    budgetCapUsdc: tier === 'paid' ? (opts.budgetCapUsdc ?? null) : null,
    agreementVersion: AGREEMENT_VERSION,
  });
  if (!res.ok) throw new Error(`listing seed failed: ${res.code}`);
  return res.listing.id;
}

/** A paid listing with a live, paid-for CPM slot ready to report against. */
async function seedLiveSlot(budgetUsdc = '90'): Promise<{ listingId: string; channelId: string; slotId: string; slug: string }> {
  const listingId = await seedListing('paid', { model: 'cpm' });
  const channelId = await seedChannel();
  const slots = makeSlots();
  const created = await slots.create({ listingId, channelId, buyerWallet: BUYER, budgetUsdc });
  if (!created.ok) throw new Error(`slot seed failed: ${created.code}`);
  const paid = await slots.pay(created.slot.id, BUYER);
  if (!paid.ok) throw new Error(`slot payment failed: ${paid.code}`);
  const [listing] = await _getTestDb()
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.id, listingId));
  return { listingId, channelId, slotId: created.slot.id, slug: listing.attributionSlug };
}

async function usageRows() {
  return _getTestDb().select().from(usageEvents);
}

describe('organic (free tier) reporting', () => {
  it('logs a free use with the listing’s attribution slug and zero spend', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const res = await makeUsage().log({
      listingId,
      channelId,
      reporterWallet: BUYER,
      videoUrl: 'https://www.youtube.com/watch?v=abc123',
      impressions: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.usage.kind).toBe('organic');
    expect(res.usage.spend_usdc).toBe('0');
    expect(res.usage.slot_id).toBeNull();
    expect(res.usage.reported_by).toBe('channel');
    expect(res.usage.attribution_code).toMatch(/cold-brew-kit-/);
  });

  it('defaults reportedBy to channel — never to platform_api', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    await makeUsage().log({ listingId, channelId, reporterWallet: BUYER });
    const [row] = await usageRows();
    // The honest default for a self-serve report. Nothing in the request can
    // promote it to a platform-verified row.
    expect(row.reportedBy).toBe('channel');
  });

  it('refuses a report against another wallet’s channel', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const res = await makeUsage().log({ listingId, channelId, reporterWallet: STRANGER });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('CHANNEL_NOT_FOUND');
    expect(await usageRows()).toHaveLength(0);
  });

  it('refuses an unknown listing', async () => {
    const channelId = await seedChannel();
    const res = await makeUsage().log({ listingId: 'nope', channelId, reporterWallet: BUYER });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LISTING_NOT_FOUND');
  });

  it('refuses to report free supply against a paid slot', async () => {
    const { channelId, slotId } = await seedLiveSlot();
    const freeListingId = await seedListing('free');
    const res = await makeUsage().log({
      listingId: freeListingId,
      channelId,
      reporterWallet: BUYER,
      slotId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('SLOT_NOT_FOR_LISTING');
    expect(await usageRows()).toHaveLength(0);
  });

  it('refuses an event reporting no delivery at all', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const res = await makeUsage().log({ listingId, channelId, reporterWallet: BUYER, impressions: 0, clicks: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_IMPRESSIONS');
  });

  it('refuses a negative impression count', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const res = await makeUsage().log({ listingId, channelId, reporterWallet: BUYER, impressions: -5 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_IMPRESSIONS');
  });
});

describe('sponsored (paid tier) reporting', () => {
  it('requires a slot — paid supply cannot be used for free', async () => {
    const listingId = await seedListing('paid', { model: 'cpm' });
    const channelId = await seedChannel();
    const res = await makeUsage().log({ listingId, channelId, reporterWallet: BUYER });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('PAID_LISTING_NEEDS_SLOT');
    expect(await usageRows()).toHaveLength(0);
  });

  it('resolves the channel’s live slot and records the spend the cap allowed', async () => {
    const { listingId, channelId } = await seedLiveSlot();
    const res = await makeUsage().log({ listingId, channelId, reporterWallet: BUYER, impressions: 1000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.usage.kind).toBe('sponsored');
    expect(res.usage.slot_id).toBeTruthy();
    // 1000 impressions at 4.5 CPM. Written by the slots service, not by the
    // request: there is no spend field a reporter could have supplied.
    expect(res.usage.spend_usdc).toBe('4.5');
    expect(res.usage.reported_by).toBe('channel');
  });

  it('stops logging delivery once the slot budget is exhausted', async () => {
    const { listingId, channelId } = await seedLiveSlot('9');
    const svc = makeUsage();
    expect((await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 1000 })).ok).toBe(true);
    expect((await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 1000 })).ok).toBe(true);
    const third = await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 1000 });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe('BUDGET_EXHAUSTED');
    // Only the two the cap allowed were logged, and the total is exactly 9.
    const rows = await usageRows();
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, r) => sum + Number(r.spendUsdc), 0)).toBeCloseTo(9, 6);
  });

  it('cannot accrue spend against another channel’s slot', async () => {
    const { listingId, slotId } = await seedLiveSlot();
    const otherChannel = await seedChannel(BUYER, 1);
    // The reporting channel owns `otherChannel`, but the slot belongs to the
    // first one. Validated before accrual, so no money moves.
    const res = await makeUsage().log({
      listingId,
      channelId: otherChannel,
      reporterWallet: BUYER,
      slotId,
      impressions: 1000,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('SLOT_NOT_FOUND');
    expect(await usageRows()).toHaveLength(0);
    const [slot] = await _getTestDb().select().from(slotsTable);
    expect(slot.spentUsdc).toBe('0');
  });

  it('refuses a slot bought for a different listing', async () => {
    const { channelId, slotId } = await seedLiveSlot();
    const otherListing = await seedListing('paid', { model: 'cpm' });
    const res = await makeUsage().log({
      listingId: otherListing,
      channelId,
      reporterWallet: BUYER,
      slotId,
      impressions: 1000,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('SLOT_NOT_FOR_LISTING');
    expect(await usageRows()).toHaveLength(0);
  });
});

describe('the reporting contract', () => {
  it('rejects a body that tries to assert its own provenance', () => {
    const parsed = UsageReportSchema.safeParse({
      listingId: 'l1',
      channelId: 'c1',
      reportedBy: 'platform_api',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a body that tries to declare its own spend', () => {
    const parsed = UsageReportSchema.safeParse({
      listingId: 'l1',
      channelId: 'c1',
      spendUsdc: '500',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a plain delivery report', () => {
    const parsed = UsageReportSchema.safeParse({
      listingId: 'l1',
      channelId: 'c1',
      impressions: 1000,
      videoUrl: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('rollups', () => {
  it('reports the catalog summary split by who told us', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const svc = makeUsage();
    await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 10 });
    await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 5, reportedBy: 'manual' });

    const summary = await svc.summary();
    expect(summary.total_events).toBe(2);
    expect(summary.total_impressions).toBe(15);
    expect(summary.organic_events).toBe(2);
    expect(summary.sponsored_events).toBe(0);
    // The split is the point: an aggregate quoted without it is a
    // self-reported number.
    expect(summary.by_reporter.channel).toBe(1);
    expect(summary.by_reporter.manual).toBe(1);
    expect(summary.by_reporter.platform_api).toBe(0);
    expect(summary.distinct_channels).toBe(1);
  });

  it('sums only the spend the caps allowed', async () => {
    const { listingId, channelId } = await seedLiveSlot('9');
    const svc = makeUsage();
    await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 1000 });
    await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 1000 });
    await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 1000 });
    const summary = await svc.summary();
    expect(summary.sponsored_events).toBe(2);
    expect(Number(summary.spend_usdc)).toBeCloseTo(9, 6);
  });

  it('reports attribution compliance per listing', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const svc = makeUsage();
    await svc.log({ listingId, channelId, reporterWallet: BUYER });
    await svc.log({ listingId, channelId, reporterWallet: BUYER, reportedBy: 'platform_api' });

    const compliance = await svc.attributionCompliance(listingId);
    expect(compliance.logged).toBe(2);
    expect(compliance.channel_reported).toBe(1);
    expect(compliance.platform_verified).toBe(1);
    expect(compliance.manual).toBe(0);
  });

  it('scopes the summary to a time window', async () => {
    const listingId = await seedListing('free');
    const channelId = await seedChannel();
    const svc = makeUsage();
    await svc.log({ listingId, channelId, reporterWallet: BUYER, occurredAt: '2026-01-01T00:00:00.000Z' });
    await svc.log({ listingId, channelId, reporterWallet: BUYER, occurredAt: '2026-09-01T00:00:00.000Z' });

    expect((await svc.summary()).total_events).toBe(2);
    const since = await svc.summary({ sinceIso: '2026-06-01T00:00:00.000Z' });
    expect(since.total_events).toBe(1);
  });

  it('lists usage per listing, per channel and per slot', async () => {
    const { listingId, channelId, slotId } = await seedLiveSlot();
    const svc = makeUsage();
    await svc.log({ listingId, channelId, reporterWallet: BUYER, impressions: 100 });
    expect(await svc.listForListing(listingId)).toHaveLength(1);
    expect(await svc.listForChannel(channelId)).toHaveLength(1);
    expect(await svc.listForSlot(slotId)).toHaveLength(1);
    expect(await svc.listForChannel('nope')).toHaveLength(0);
  });
});
