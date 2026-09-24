// MODULAR: Integration test — the browse CONTRACT that makes /discover read
// like a marketplace (docs/interface.md §4.2–4.3):
//   • facet `counts` describe the match slice, so choosing a facet never
//     collapses the other groups ("18 music · 14 products" stays true while
//     "free only" is on);
//   • `sort` is applied server-side BEFORE paging, so page 2 of a price sort
//     is the next two cheapest — a client-side sort over a page would lie;
//   • `total` is the post-facet count the pager pages over.
// PGlite has no pgvector, so this exercises the tag/recent ranking path —
// exactly the fallback the UI degrades to when embeddings are unavailable.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } =
  await import('../helpers/db');
const { vi } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() {
    return _getTestDb();
  },
}));

const { services } = await import('../../src/lib/services');
const { clearCache } = await import('../../src/lib/cache');
const { listings } = await import('../../src/lib/schema');
const { describe, it, expect, beforeAll, beforeEach } = await import('vitest');
const { eq } = await import('drizzle-orm');

const WALLET = '0x' + 'c'.repeat(40);

interface Seed {
  id: string;
  kind: 'music' | 'placement';
  tier: 'free' | 'paid';
  title: string;
  tags: string[];
  flatFeeUsdc?: string;
  createdAt: Date;
}

async function seedListing(input: Seed) {
  const db = _getTestDb();
  const paid = input.tier === 'paid';
  await db.insert(listings).values({
    id: input.id,
    kind: input.kind,
    supplierWallet: WALLET,
    submissionId: null,
    title: input.title,
    supplierName: paid ? 'Fable Audio' : 'Luna Rivera',
    summary: `${input.title} — one-line pitch.`,
    tags: input.tags,
    images: [],
    coverSvg: null,
    audioPath: null,
    tier: input.tier,
    pricing: paid ? { model: 'flat', flatFeeUsdc: input.flatFeeUsdc } : null,
    budgetCapUsdc: null,
    budgetSpentUsdc: '0',
    disclosure: paid
      ? { kind: 'sponsored', label: '#ad', statement: 'Sponsored placement arranged through VERSIONS.' }
      : null,
    attributionText: `Music: ${input.title} — via VERSIONS`,
    attributionUrl: `https://versions.persidian.com/listings/${input.id}`,
    attributionSlug: input.id,
    agreementVersion: 'marketplace-1.0.0',
    agreementAcceptedAt: input.createdAt,
    status: 'active',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

// 2 music / 2 placement, 2 free / 2 paid — so every facet has a group to lose.
const T = [
  new Date('2026-09-01T00:00:00Z'),
  new Date('2026-09-02T00:00:00Z'),
  new Date('2026-09-03T00:00:00Z'),
  new Date('2026-09-04T00:00:00Z'),
];

const SEEDS: Seed[] = [
  { id: 'm-free', kind: 'music', tier: 'free', title: 'Midnight Study', tags: ['lo-fi', 'study'], createdAt: T[0] },
  { id: 'm-paid-cheap', kind: 'music', tier: 'paid', title: 'Tape Warmth', tags: ['lo-fi', 'focus'], flatFeeUsdc: '3.00', createdAt: T[1] },
  { id: 'p-free', kind: 'placement', tier: 'free', title: 'Coldbrew Kit', tags: ['lo-fi', 'coffee'], createdAt: T[2] },
  { id: 'p-paid-pricey', kind: 'placement', tier: 'paid', title: 'Walnut Stand', tags: ['lo-fi', 'desk'], flatFeeUsdc: '25.00', createdAt: T[3] },
];

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
  clearCache();
  for (const seed of SEEDS) await seedListing(seed);
});

describe('integration: browse facets, counts and sort', () => {
  it('reports the whole slice in counts and the facet-free total', async () => {
    const res = await services().marketplace.search({});
    expect(res.total).toBe(4);
    expect(res.counts).toEqual({ total: 4, music: 2, placement: 2, free: 2, paid: 2 });
    expect(res.sort).toBe('fit');
  });

  it('keeps counts describing the slice while a facet is applied', async () => {
    const res = await services().marketplace.search({ tier: 'free' });
    expect(res.total).toBe(2);
    expect(res.rows.every((r) => r.tier === 'free')).toBe(true);
    // The property that makes a marketplace header usable: the paid group
    // count survives its own filter being off-screen.
    expect(res.counts).toEqual({ total: 4, music: 2, placement: 2, free: 2, paid: 2 });

    const music = await services().marketplace.search({ kind: 'music' });
    expect(music.total).toBe(2);
    expect(music.counts?.total).toBe(4);
    expect(music.counts?.placement).toBe(2);
  });

  it('applies sort before paging — page 2 is the next cheapest, not a re-sort of page 1', async () => {
    const page1 = await services().marketplace.search({ sort: 'price_asc', limit: 2, offset: 0 });
    const page2 = await services().marketplace.search({ sort: 'price_asc', limit: 2, offset: 2 });
    expect(page1.rows.map((r) => r.id)).toEqual(['p-free', 'm-free']);
    expect(page2.rows.map((r) => r.id)).toEqual(['m-paid-cheap', 'p-paid-pricey']);
    expect(page1.total).toBe(4);
    expect(page1.sort).toBe('price_asc');
  });

  it('orders price_asc free-first and price_desc dearest-first', async () => {
    const asc = await services().marketplace.search({ sort: 'price_asc' });
    expect(asc.rows.map((r) => r.id)).toEqual(['p-free', 'm-free', 'm-paid-cheap', 'p-paid-pricey']);
    const desc = await services().marketplace.search({ sort: 'price_desc' });
    expect(desc.rows.map((r) => r.id)).toEqual(['p-paid-pricey', 'm-paid-cheap', 'p-free', 'm-free']);
  });

  it('sort=newest is newest-first and matches the no-query default order', async () => {
    const newest = await services().marketplace.search({ sort: 'newest' });
    expect(newest.rows.map((r) => r.id)).toEqual(['p-paid-pricey', 'p-free', 'm-paid-cheap', 'm-free']);
    const defaultOrder = await services().marketplace.search({});
    expect(defaultOrder.rows.map((r) => r.id)).toEqual(newest.rows.map((r) => r.id));
  });

  it('ranking still drives the default fit order when a query is present', async () => {
    const res = await services().marketplace.search({ query: 'lo-fi study' });
    expect(res.mode).toBe('tag');
    expect(res.rows[0].id).toBe('m-free'); // the only row with both tokens
    expect(res.counts?.total).toBe(4);
    expect(res.sort).toBe('fit');
  });

  it('never sorts on data the caller cannot see: only active supply is counted', async () => {
    const db = _getTestDb();
    await db.update(listings).set({ status: 'paused' }).where(eq(listings.id, 'p-paid-pricey'));
    const res = await services().marketplace.search({});
    expect(res.total).toBe(3);
    expect(res.counts).toEqual({ total: 3, music: 2, placement: 1, free: 2, paid: 1 });
  });
});
