// MODULAR: Slot tests — the paid tier and its budget caps.
//
// The invariants worth locking here are the ones that make the ad side
// trustworthy: a channel whose reach was never verified against the platform
// cannot buy; a paid slot mints exactly one tracking code and carries its
// disclosure; the flat three-way split always produces three legs that sum to
// the gross; and no sequence of delivery events can push spend past either the
// slot's budget or the supplier's campaign cap.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const { getTestDb: _getTestDb, initTestDb: _initTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi: _vi } = await import('vitest');
_vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createSlotsService } = await import('../../src/services/slots');
const { createListingsService } = await import('../../src/services/listings');
const { createChannelsService } = await import('../../src/services/channels');
const { createSettlementService } = await import('../../src/services/settlement');
const { createArcAdapter } = await import('../../src/adapters/arc');
const { AGREEMENT_VERSION } = await import('../../src/lib/agreement');
const { slots: slotsTable, listings: listingsTable } = await import('../../src/lib/schema');
const { eq } = await import('drizzle-orm');

const SUPPLIER = '0x' + 'a'.repeat(40);
const BUYER = '0x' + 'b'.repeat(40);
const BUYER_2 = '0x' + 'e'.repeat(40);
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

/** A probe standing in for the platform API: real numbers, real verification. */
function platformProbe(seq = 0) {
  return {
    mock: false,
    platform: 'youtube' as const,
    probe: async () => probeResult(false, seq),
  };
}

/** The offline probe: invented numbers, verification held at 'pending'. */
function mockProbe(seq = 0) {
  return {
    mock: true,
    platform: 'youtube' as const,
    probe: async () => probeResult(true, seq),
  };
}

function probeResult(mock: boolean, seq = 0) {
  // Distinct platform ids: uq_channels_platform_channel is on
  // (platform, platform_channel_id), so two channels need two surfaces.
  const id = `UCdemo${String(seq).padStart(19, '0')}`;
  return {
    platform: 'youtube' as const,
    platformUrl: `https://www.youtube.com/channel/${id}`,
    platformChannelId: id,
    name: 'Lo-Fi Automation',
    description: 'Twenty-four hour lo-fi study streams.',
    subscriberCount: 120_000,
    viewCount: 9_000_000,
    videoCount: 340,
    recentContent: ['lofi beat to study to — 3 hour mix'],
    mock,
    probedAt: '2026-09-14T00:00:00.000Z',
  };
}

/** Register a channel through the real service so the gate is genuinely tested. */
async function seedChannel(opts: { mock?: boolean; owner?: string; seq?: number } = {}): Promise<string> {
  const { mock = false, owner = BUYER, seq = 0 } = opts;
  const res = await createChannelsService(mock ? mockProbe(seq) : platformProbe(seq)).register({
    ownerWallet: owner,
    platformUrl: `https://www.youtube.com/@demolo-fi-${seq}`,
    niche: 'lo-fi study streams',
    agreementVersion: AGREEMENT_VERSION,
  });
  if (!res.ok) throw new Error(`channel seed failed: ${res.code}`);
  return res.channel.id;
}

async function seedListing(input: {
  tier?: 'free' | 'paid';
  model?: 'flat' | 'cpm';
  flatFeeUsdc?: string;
  cpmUsdc?: string;
  budgetCapUsdc?: string | null;
}): Promise<string> {
  const tier = input.tier ?? 'paid';
  const model = input.model ?? 'flat';
  const res = await createListingsService().create({
    supplierWallet: SUPPLIER,
    kind: 'placement',
    title: 'Cold Brew Kit',
    supplierName: 'Cold Brew Co',
    summary: 'A pour-over kit for late-night sessions.',
    tags: ['lo-fi', 'coffee', 'focus'],
    images: ['ipfs://creative-1'],
    tier,
    pricing:
      tier === 'paid'
        ? model === 'flat'
          ? { model: 'flat', flatFeeUsdc: input.flatFeeUsdc ?? '30' }
          : { model: 'cpm', cpmUsdc: input.cpmUsdc ?? '4.5' }
        : null,
    budgetCapUsdc: tier === 'paid' ? (input.budgetCapUsdc ?? null) : null,
    agreementVersion: AGREEMENT_VERSION,
  });
  if (!res.ok) throw new Error(`listing seed failed: ${res.code}`);
  return res.listing.id;
}

async function seedSlot(opts: {
  tier?: 'free' | 'paid';
  model?: 'flat' | 'cpm';
  flatFeeUsdc?: string;
  cpmUsdc?: string;
  budgetUsdc?: string | null;
  budgetCapUsdc?: string | null;
  mockChannel?: boolean;
}) {
  const listingId = await seedListing(opts);
  const channelId = await seedChannel({ mock: opts.mockChannel });
  const created = await makeSlots().create({
    listingId,
    channelId,
    buyerWallet: BUYER,
    budgetUsdc: opts.budgetUsdc,
  });
  return { listingId, channelId, created };
}

async function slotRows() {
  return _getTestDb().select().from(slotsTable);
}

describe('the verification gate', () => {
  it('refuses a slot to a channel whose reach was never verified', async () => {
    const { created } = await seedSlot({ mockChannel: true });
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe('CHANNEL_UNVERIFIED');
      expect(created.message).toMatch(/Self-reported reach is not accepted/);
    }
    // The refusal happens before any write: nothing to clean up, nothing to
    // accidentally serve.
    expect(await slotRows()).toHaveLength(0);
  });

  it('lets a platform-verified channel buy the same listing', async () => {
    const { created } = await seedSlot({});
    expect(created.ok).toBe(true);
  });

  it('reports someone else’s channel as missing rather than forbidden', async () => {
    const listingId = await seedListing({});
    const channelId = await seedChannel();
    const res = await makeSlots().create({ listingId, channelId, buyerWallet: STRANGER });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('CHANNEL_NOT_FOUND');
    expect(await slotRows()).toHaveLength(0);
  });
});

describe('what may be bought', () => {
  it('refuses a free listing — free supply is used, not bought', async () => {
    const { created } = await seedSlot({ tier: 'free' });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe('LISTING_NOT_PAID');
  });

  it('refuses an unknown listing', async () => {
    const channelId = await seedChannel();
    const res = await makeSlots().create({ listingId: 'nope', channelId, buyerWallet: BUYER });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LISTING_NOT_FOUND');
  });

  it('refuses a paused listing', async () => {
    const listingId = await seedListing({});
    await createListingsService().setStatus(listingId, SUPPLIER, 'paused');
    const channelId = await seedChannel();
    const res = await makeSlots().create({ listingId, channelId, buyerWallet: BUYER });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('LISTING_NOT_SERVABLE');
  });

  it('requires a budget for a CPM placement — the escrow is the price', async () => {
    const { created } = await seedSlot({ model: 'cpm' });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe('BUDGET_REQUIRED');
    expect(await slotRows()).toHaveLength(0);
  });

  it('refuses a flat-fee budget below the fee', async () => {
    const { created } = await seedSlot({ flatFeeUsdc: '30', budgetUsdc: '10' });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe('BUDGET_BELOW_FEE');
  });
});

describe('tracking and disclosure', () => {
  it('mints a tracking code, a tracking url and an attribution code', async () => {
    const { created } = await seedSlot({});
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.slot.tracking_code).toMatch(/^vs_/);
    expect(created.slot.tracking_url).toContain(created.slot.tracking_code);
    expect(created.slot.attribution_code.endsWith(`:${created.slot.tracking_code}`)).toBe(true);
    expect(created.slot.attribution_code.split(':')[0]).toMatch(/cold-brew-kit-/);
  });

  it('copies the disclosure onto the slot so an edited listing cannot drop it', async () => {
    const { listingId } = await seedSlot({});
    const [slotRow] = await slotRows();
    expect(slotRow.disclosure.label).toBe('#ad');
    expect(slotRow.attributionText).toContain('#ad');
    // The supplier pausing or archiving the listing afterwards cannot strip
    // the disclosure from a placement already bought.
    await createListingsService().setStatus(listingId, SUPPLIER, 'archived');
    const [after] = await slotRows();
    expect(after.disclosure.label).toBe('#ad');
  });

  it('returns the existing slot instead of minting a second tracking code', async () => {
    const listingId = await seedListing({});
    const channelId = await seedChannel();
    const svc = makeSlots();
    const first = await svc.create({ listingId, channelId, buyerWallet: BUYER });
    const second = await svc.create({ listingId, channelId, buyerWallet: BUYER });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.slot.id).toBe(first.slot.id);
    expect(second.slot.tracking_code).toBe(first.slot.tracking_code);
    expect(await slotRows()).toHaveLength(1);
  });
});

describe('flat-fee settlement', () => {
  it('collects the fee, splits it three ways and settles every leg', async () => {
    const { created } = await seedSlot({ flatFeeUsdc: '30' });
    if (!created.ok) throw new Error('seed failed');
    const paid = await makeSlots().pay(created.slot.id, BUYER);
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;

    expect(paid.charged_usdc).toBe('30');
    expect(paid.slot.status).toBe('active');
    expect(paid.slot.spent_usdc).toBe('30');
    expect(paid.legs).toHaveLength(3);
    expect(paid.legs.map((l) => l.recipient_role).sort()).toEqual(['channel', 'platform', 'supplier']);
    expect(paid.legs.every((l) => l.status === 'settled')).toBe(true);
  });

  it('splits 60/30/10 and the legs sum exactly to the gross', async () => {
    const { created } = await seedSlot({ flatFeeUsdc: '10' });
    if (!created.ok) throw new Error('seed failed');
    const paid = await makeSlots().pay(created.slot.id, BUYER);
    if (!paid.ok) throw new Error('pay failed');
    const byRole = Object.fromEntries(paid.legs.map((l) => [l.recipient_role, l.amount_usdc]));
    expect(byRole.supplier).toBe('6');
    expect(byRole.channel).toBe('3');
    expect(byRole.platform).toBe('1');
    const total = paid.legs.reduce((sum, l) => sum + Number(l.amount_usdc), 0);
    expect(total).toBeCloseTo(10, 6);
  });

  it('gives the rounding residue to the platform leg so nothing is lost', async () => {
    // 33.33 → supplier 19.998, channel 9.999, platform takes the remainder.
    const { created } = await seedSlot({ flatFeeUsdc: '33.33' });
    if (!created.ok) throw new Error('seed failed');
    const paid = await makeSlots().pay(created.slot.id, BUYER);
    if (!paid.ok) throw new Error('pay failed');
    const micro = (s: string) => BigInt(Math.round(Number(s) * 1e6));
    const total = paid.legs.reduce((sum, l) => sum + micro(l.amount_usdc), 0n);
    expect(total).toBe(micro('33.33'));
    const platform = paid.legs.find((l) => l.recipient_role === 'platform');
    expect(micro(platform!.amount_usdc)).toBeGreaterThan(0n);
  });

  it('refuses to pay the same slot twice', async () => {
    const { created } = await seedSlot({});
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    const first = await svc.pay(created.slot.id, BUYER);
    const second = await svc.pay(created.slot.id, BUYER);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('SLOT_NOT_PAYABLE');
    // Exactly one set of legs exists — the second call never reached money.
    expect(await svc.legs(created.slot.id)).toHaveLength(3);
  });

  it('reports a stranger’s slot as missing', async () => {
    const { created } = await seedSlot({});
    if (!created.ok) throw new Error('seed failed');
    const res = await makeSlots().pay(created.slot.id, STRANGER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('SLOT_NOT_FOUND');
    const [row] = await slotRows();
    expect(row.status).toBe('pending_payment');
    expect(row.settlementLeaseId).toBeNull();
  });

  it('moves impressions but not spend once a flat fee is pre-paid', async () => {
    const { created } = await seedSlot({ flatFeeUsdc: '30' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    const accrued = await svc.accrue({ slotId: created.slot.id, impressions: 5000 });
    expect(accrued.ok).toBe(true);
    if (!accrued.ok) return;
    expect(accrued.slot.impressions_delivered).toBe(5000);
    expect(accrued.slot.spent_usdc).toBe('30');
    expect(accrued.delta_usdc).toBe('0');
  });
});

describe('CPM delivery and the budget cap', () => {
  it('escrows the budget without settling any leg', async () => {
    const { created } = await seedSlot({ model: 'cpm', cpmUsdc: '4.5', budgetUsdc: '90' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    const paid = await svc.pay(created.slot.id, BUYER);
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.charged_usdc).toBe('90');
    expect(paid.slot.spent_usdc).toBe('0');
    expect(paid.slot.budget_remaining_usdc).toBe('90');
    expect(paid.legs).toHaveLength(0);
    expect(await svc.legs(created.slot.id)).toHaveLength(0);
  });

  it('accrues per thousand impressions', async () => {
    const { created } = await seedSlot({ model: 'cpm', cpmUsdc: '4.5', budgetUsdc: '90' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    const one = await svc.accrue({ slotId: created.slot.id, impressions: 1000 });
    expect(one.ok && one.delta_usdc).toBe('4.5');
    if (!one.ok) return;
    expect(one.slot.spent_usdc).toBe('4.5');
    // A partial thousand accrues proportionally rather than rounding up to a
    // full impression cost.
    const part = await svc.accrue({ slotId: created.slot.id, impressions: 100 });
    expect(part.ok && part.delta_usdc).toBe('0.45');
    if (!part.ok) return;
    expect(part.slot.spent_usdc).toBe('4.95');
  });

  it('stops serving at the cap and never spends past it', async () => {
    const { created } = await seedSlot({ model: 'cpm', cpmUsdc: '4.5', budgetUsdc: '9' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);

    // 9 USDC at 4.5 CPM is exactly 2000 impressions.
    const first = await svc.accrue({ slotId: created.slot.id, impressions: 1000 });
    expect(first.ok).toBe(true);
    const second = await svc.accrue({ slotId: created.slot.id, impressions: 1000 });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.exhausted).toBe(true);

    const over = await svc.accrue({ slotId: created.slot.id, impressions: 1 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('BUDGET_EXHAUSTED');

    const [row] = await slotRows();
    expect(row.status).toBe('exhausted');
    expect(Number(row.spentUsdc)).toBe(9);
    expect(row.impressionsDelivered).toBe(2000);
  });

  it('refuses the event that would cross the cap rather than partially serving it', async () => {
    const { created } = await seedSlot({ model: 'cpm', cpmUsdc: '4.5', budgetUsdc: '9' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    const tooMuch = await svc.accrue({ slotId: created.slot.id, impressions: 5000 });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.code).toBe('BUDGET_EXHAUSTED');
    const [row] = await slotRows();
    expect(row.spentUsdc).toBe('0');
    expect(row.impressionsDelivered).toBe(0);
    expect(row.status).toBe('active');
  });

  it('holds the cap under a burst of delivery events', async () => {
    const { created } = await seedSlot({ model: 'cpm', cpmUsdc: '4.5', budgetUsdc: '9' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    // Twenty 1000-impression events would cost 90 against a 9 USDC cap. Only
    // the first two may land; the rest must be refused by the guarded UPDATE.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => svc.accrue({ slotId: created.slot.id, impressions: 1000 })),
    );
    const accepted = results.filter((r) => r.ok);
    expect(accepted).toHaveLength(2);
    const [row] = await slotRows();
    expect(Number(row.spentUsdc)).toBeLessThanOrEqual(9);
    expect(row.impressionsDelivered).toBe(2000);
  });

  it('cannot resume a slot that hit its cap', async () => {
    const { created } = await seedSlot({ model: 'cpm', cpmUsdc: '4.5', budgetUsdc: '4.5' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    await svc.accrue({ slotId: created.slot.id, impressions: 1000 });
    const resumed = await svc.resume(created.slot.id, BUYER);
    expect(resumed.ok).toBe(false);
    const [row] = await slotRows();
    expect(row.status).toBe('exhausted');
  });

  it('does not count delivery against a paused slot', async () => {
    const { created } = await seedSlot({ model: 'cpm', cpmUsdc: '4.5', budgetUsdc: '90' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    await svc.pause(created.slot.id, BUYER);
    const accrued = await svc.accrue({ slotId: created.slot.id, impressions: 1000 });
    expect(accrued.ok).toBe(false);
    if (!accrued.ok) expect(accrued.code).toBe('SLOT_NOT_ACTIVE');
    const [row] = await slotRows();
    expect(row.spentUsdc).toBe('0');
  });

  it('settles what it served and refunds the rest on completion', async () => {
    const { created } = await seedSlot({ model: 'cpm', cpmUsdc: '4.5', budgetUsdc: '90' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    await svc.accrue({ slotId: created.slot.id, impressions: 1000 }); // 4.5 spent
    const done = await svc.complete(created.slot.id, BUYER);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.charged_usdc).toBe('4.5');
    expect(done.slot.status).toBe('completed');
    expect(done.legs).toHaveLength(3);
    const total = done.legs.reduce((sum, l) => sum + Number(l.amount_usdc), 0);
    expect(total).toBeCloseTo(4.5, 6);
  });

  it('is idempotent when completed twice', async () => {
    const { created } = await seedSlot({ model: 'cpm', cpmUsdc: '4.5', budgetUsdc: '90' });
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    await svc.accrue({ slotId: created.slot.id, impressions: 1000 });
    const first = await svc.complete(created.slot.id, BUYER);
    const second = await svc.complete(created.slot.id, BUYER);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.charged_usdc).toBe(first.charged_usdc);
    expect(await svc.legs(created.slot.id)).toHaveLength(3);
  });
});

describe('the supplier’s campaign cap', () => {
  it('clamps a slot budget to the campaign’s remaining headroom', async () => {
    const { created } = await seedSlot({
      model: 'cpm',
      cpmUsdc: '4.5',
      budgetUsdc: '500',
      budgetCapUsdc: '100',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.slot.budget_usdc).toBe('100');
  });

  it('refuses a reservation that would cross the campaign cap', async () => {
    const listingId = await seedListing({ model: 'cpm', cpmUsdc: '4.5', budgetCapUsdc: '10' });
    const channelId = await seedChannel();
    const svc = makeSlots();
    const slot = await svc.create({ listingId, channelId, buyerWallet: BUYER, budgetUsdc: '10' });
    if (!slot.ok) throw new Error('create failed');
    const paid = await svc.pay(slot.slot.id, BUYER);
    expect(paid.ok).toBe(true);

    // Complete releases the escrow the campaign never used, so the second buy
    // is testing the cap and not the first slot's reservation.
    const [listing] = await _getTestDb()
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, listingId));
    expect(listing.budgetSpentUsdc).toBe('10');
    expect(listing.status).toBe('exhausted');

    // A further placement against a spent campaign is refused at creation.
    const again = await svc.create({ listingId, channelId, buyerWallet: BUYER, budgetUsdc: '10' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('CAMPAIGN_EXHAUSTED');
  });

  it('releases unspent escrow back to the campaign on completion', async () => {
    const listingId = await seedListing({ model: 'cpm', cpmUsdc: '4.5', budgetCapUsdc: '100' });
    const channelId = await seedChannel();
    const svc = makeSlots();
    const slot = await svc.create({ listingId, channelId, buyerWallet: BUYER, budgetUsdc: '90' });
    if (!slot.ok) throw new Error('create failed');
    await svc.pay(slot.slot.id, BUYER);
    const [before] = await _getTestDb()
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, listingId));
    expect(before.budgetSpentUsdc).toBe('90');

    await svc.accrue({ slotId: slot.slot.id, impressions: 1000 }); // 4.5 served
    await svc.complete(slot.slot.id, BUYER);

    const [after] = await _getTestDb()
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, listingId));
    expect(Number(after.budgetSpentUsdc)).toBeCloseTo(4.5, 6);
    expect(after.status).toBe('active');
  });

  it('bounds total commitment across two independent buyers', async () => {
    const listingId = await seedListing({ flatFeeUsdc: '30', budgetCapUsdc: '50' });
    const svc = makeSlots();

    const firstChannel = await seedChannel({ seq: 0 });
    const first = await svc.create({ listingId, channelId: firstChannel, buyerWallet: BUYER });
    if (!first.ok) throw new Error('create failed');
    expect((await svc.pay(first.slot.id, BUYER)).ok).toBe(true);

    const [mid] = await _getTestDb()
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, listingId));
    expect(mid.budgetSpentUsdc).toBe('30');
    // 30 of 50 committed — there is room to display, not to buy again.
    expect(mid.status).toBe('active');

    // A different channel owned by a different wallet: the one-live-slot index
    // is per (listing, channel), so this is a genuinely second buyer.
    const secondChannel = await seedChannel({ seq: 1, owner: BUYER_2 });
    const second = await svc.create({ listingId, channelId: secondChannel, buyerWallet: BUYER_2 });
    // 30 already committed + a 30 fee would cross the 50 cap, so this is
    // refused before a slot exists — not left as a row that fails at checkout.
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('CAMPAIGN_EXHAUSTED');

    const [after] = await _getTestDb()
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, listingId));
    expect(after.budgetSpentUsdc).toBe('30');
    expect(await svc.listForListing(listingId)).toHaveLength(1);
  });
});

describe('who may operate a slot', () => {
  it('lets the supplier pause a placement of their own listing', async () => {
    const { created } = await seedSlot({});
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    const paused = await svc.pause(created.slot.id, SUPPLIER);
    expect(paused.ok).toBe(true);
    if (paused.ok) expect(paused.slot.status).toBe('paused');
  });

  it('refuses a stranger and leaves the slot live', async () => {
    const { created } = await seedSlot({});
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    await svc.pay(created.slot.id, BUYER);
    const res = await svc.pause(created.slot.id, STRANGER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('SLOT_NOT_FOUND');
    const [row] = await slotRows();
    expect(row.status).toBe('active');
  });
});

describe('reads', () => {
  it('looks a slot up by tracking code without a wallet', async () => {
    const { created } = await seedSlot({});
    if (!created.ok) throw new Error('seed failed');
    const found = await makeSlots().getByTrackingCode(created.slot.tracking_code);
    expect(found?.id).toBe(created.slot.id);
  });

  it('returns null for an unknown tracking code', async () => {
    expect(await makeSlots().getByTrackingCode('vs_nope')).toBeNull();
  });

  it('scopes listings by channel and by listing', async () => {
    const { created, listingId, channelId } = await seedSlot({});
    if (!created.ok) throw new Error('seed failed');
    const svc = makeSlots();
    expect(await svc.listForChannel(channelId)).toHaveLength(1);
    expect(await svc.listForListing(listingId)).toHaveLength(1);
    expect(await svc.listForBuyer(BUYER)).toHaveLength(1);
    expect(await svc.listForBuyer(STRANGER)).toHaveLength(0);
  });
});
