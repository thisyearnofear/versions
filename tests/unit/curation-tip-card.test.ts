// MODULAR: getArtistTipCard service tests. Drives the same
// 4-query Promise.all bundle that powers the TipButton hover-card
// end-to-end through the seeded PGlite fixture.
//
// Test isolation note: helpers/db.ts's resetTestDb clears every
// table including x402_proofs (added in this PR). Without that,
// prior tests' x402_proofs would leak into the count assertions
// of later tests (#3 reported 9 tips instead of 3; #5 reported 10
// instead of 1 — both fixed).

const {
  initTestDb: _initTestDb,
  getTestDb: _getTestDb,
  resetTestDb: _resetTestDb,
} = await import('../helpers/db');
const { vi } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() {
    return _getTestDb();
  },
}));

const { describe, it, expect, beforeAll, beforeEach } = await import('vitest');
const { eq } = await import('drizzle-orm');
const { createCurationService } = await import('../../src/services/curation');
const { createSettlementService } = await import('../../src/services/settlement');
const { publishedVersions, x402Proofs, submissions } = await import('../../src/lib/schema');

const ARTIST_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ARTIST_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function seedSubmission(subId: string, wallet: string, title: string) {
  const db = _getTestDb();
  await db.insert(submissions).values({
    id: subId,
    artistWallet: wallet,
    audioPath: 'audio/' + subId,
    audioSizeBytes: 1024,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    title,
    artistName: 'Seed Artist',
    versionType: 'demo',
    status: 'published',
  });
  await db.insert(publishedVersions).values({
    submissionId: subId,
    artistWallet: wallet,
    title,
    artistName: 'Seed Artist',
    versionType: 'demo',
    audioPath: 'audio/' + subId,
    ratingCount: 3,
    avgSoloIntensity: 6.5,
    avgVocalQuality: 7.0,
    energyConsensus: 'higher',
    tempoConsensus: 'locked',
    aggregatedMoodTags: ['warm', 'dynamic'],
    publishedAt: new Date(),
  });
}

// MODULAR: createdAt is optional. Drizzle defaults created_at to
// NOW() if omitted. Tests that need deterministic COALESCE
// ordering must pass an explicit createdAt for verified tips
// (whose settled_at is NULL and falls back to created_at in the
// ORDER BY). Without an explicit created_at the verified rows
// coloclate to the same wall-clock instant and Postgres tie-breaks
// arbitrarily — the previous tip-4 / tip-5 pair landed inconsistently
// because both had created_at = NOW() at insert.
async function seedTip(
  puid: string,
  artistWallet: string,
  tipperWallet: string,
  amountMicroUsdc: string,
  status: string,
  settledAt: Date | null,
  createdAt: Date = new Date(),
) {
  const db = _getTestDb();
  await db.insert(x402Proofs).values({
    id: 'proof-' + puid,
    puid,
    resourceUrl: '/api/x402/tip',
    scheme: 'exact',
    network: 'arc-testnet',
    asset: 'USDC',
    payTo: artistWallet,
    amountMicroUsdc,
    validUntil: new Date(Date.now() + 600_000),
    tipperWallet,
    artistWallet,
    message: null,
    signature: '0x' + 'c'.repeat(130),
    status,
    settledAt,
    createdAt,
  });
}

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
});

describe('curation: getArtistTipCard', () => {
  it('returns zeros + empty arrays for an unknown artist', async () => {
    const settlement = createSettlementService();
    const curation = createCurationService({ settlement });
    const card = await curation.getArtistTipCard('0x' + 'f'.repeat(40));
    expect(card.artist_wallet).toBe('0x' + 'f'.repeat(40));
    expect(card.total_tips).toBe(0);
    // MODULAR: empty-wallet footers render as "0" (not "0.000000")
    // because fromMicroUsdc("0") short-circuits in curation.ts.
    expect(card.total_tips_usdc).toBe('0');
    expect(card.recent_published).toEqual([]);
    expect(card.recent_tips).toEqual([]);
  });

  it('returns ≤ 3 most-recent published versions, ordered by published_at DESC', async () => {
    const db = _getTestDb();
    const base = Date.now();
    // MODULAR: deterministic ordering. Two sequential
    // seedSubmission calls can land on the same PGlite microsecond
    // boundary, making Postgres ORDER BY published_at DESC
    // non-deterministic for tied rows. Pin every published_at to an
    // explicit offset from `base` so the test passes across both
    // PGlite (the CI runner) and a real Postgres (production).
    await seedSubmission('sub-old', ARTIST_A, 'Old Cut');
    await db.update(publishedVersions)
      .set({ publishedAt: new Date(base - 4 * 60_000) })
      .where(eq(publishedVersions.submissionId, 'sub-old'));
    await seedSubmission('sub-mid', ARTIST_A, 'Mid Cut');
    await db.update(publishedVersions)
      .set({ publishedAt: new Date(base - 2 * 60_000) })
      .where(eq(publishedVersions.submissionId, 'sub-mid'));
    await seedSubmission('sub-new', ARTIST_A, 'New Cut');
    await db.update(publishedVersions)
      .set({ publishedAt: new Date(base - 30_000) })
      .where(eq(publishedVersions.submissionId, 'sub-new'));
    await seedSubmission('sub-newest', ARTIST_A, 'Newest Cut');
    await db.update(publishedVersions)
      .set({ publishedAt: new Date(base - 5_000) })
      .where(eq(publishedVersions.submissionId, 'sub-newest'));

    const settlement = createSettlementService();
    const curation = createCurationService({ settlement });
    const card = await curation.getArtistTipCard(ARTIST_A);

    // MODULAR: list bounded to 3 entries; sort is verified by
    // checking the newest land first.
    expect(card.recent_published.length).toBe(3);
    expect(card.recent_published[0].title).toBe('Newest Cut');
    expect(card.recent_published[1].title).toBe('New Cut');
    expect(card.recent_published[2].title).toBe('Mid Cut');
  });

  it('orders recent tips by COALESCE(settled_at, created_at) DESC — settled AND verified tips both rank correctly', async () => {
    // MODULAR: design choice. To make the COALESCE sort deterministic
    // across PGlite + Postgres + Vitest, every test row gets an
    // explicit createdAt. The settled tips use settled_at for ranking;
    // the verified tip falls back to created_at via COALESCE.
    const base = Date.now();
    // tip-old-settled — settled 90 min ago, oldest of all
    await seedTip('tip-old-settled', ARTIST_A, '0x' + '1'.repeat(40), '1000', 'settled', new Date(base - 90 * 60_000), new Date(base - 90 * 60_000));
    // tip-mid-settled — settled 30 min ago, middle
    await seedTip('tip-mid-settled', ARTIST_A, '0x' + '2'.repeat(40), '2000', 'settled', new Date(base - 30 * 60_000), new Date(base - 30 * 60_000));
    // tip-new-verified — no settled_at (status='verified'), created
    // 10 min ago, COALESCE falls back to created_at. Ranks 2nd.
    await seedTip('tip-new-verified', ARTIST_A, '0x' + '3'.repeat(40), '3000', 'verified', null, new Date(base - 10 * 60_000));
    // tip-freshest-settled — settled 2 min ago, ranks 1st
    await seedTip('tip-freshest-settled', ARTIST_A, '0x' + '4'.repeat(40), '4000', 'settled', new Date(base - 2 * 60_000), new Date(base - 2 * 60_000));

    const settlement = createSettlementService();
    const curation = createCurationService({ settlement });
    const card = await curation.getArtistTipCard(ARTIST_A);

    expect(card.recent_tips.length).toBe(4);
    // Ordering is COALESCE DESC: freshest-settled (2 min) → new-verified (10 min via created_at) → mid-settled (30 min) → old-settled (90 min).
    expect(card.recent_tips.map((t) => t.puid)).toEqual([
      'tip-freshest-settled',
      'tip-new-verified',
      'tip-mid-settled',
      'tip-old-settled',
    ]);
  });

  it('totals reflect count + settled-only sum, not verified-but-unsettled', async () => {
    // 3 tips total: 2 settled (1M + 2M = 3M = 3 USDC) + 1 verified
    // (5M but NOT counted in total_tips_usdc). total_tips counts all.
    await seedTip('tip-s1', ARTIST_A, ARTIST_B, '1000000', 'settled', new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    await seedTip('tip-s2', ARTIST_A, ARTIST_B, '2000000', 'settled', new Date(Date.now() - 30_000), new Date(Date.now() - 30_000));
    await seedTip('tip-v1', ARTIST_A, ARTIST_B, '5000000', 'verified', null, new Date());

    const settlement = createSettlementService();
    const curation = createCurationService({ settlement });
    const card = await curation.getArtistTipCard(ARTIST_A);

    expect(card.total_tips).toBe(3);
    // fromMicroUsdc(3_000_000n) = "3"; verified-only 5M excluded.
    expect(card.total_tips_usdc).toBe('3');
  });

  it('isolates by artist — wallet B tips do not leak into wallet A totals', async () => {
    await seedTip('tip-a', ARTIST_A, ARTIST_B, '1000000', 'settled', new Date(Date.now() - 1_000), new Date(Date.now() - 1_000));
    await seedTip('tip-b', ARTIST_B, ARTIST_A, '9999000', 'settled', new Date(Date.now() - 500), new Date(Date.now() - 500));

    const settlement = createSettlementService();
    const curation = createCurationService({ settlement });
    const cardA = await curation.getArtistTipCard(ARTIST_A);
    const cardB = await curation.getArtistTipCard(ARTIST_B);

    expect(cardA.total_tips).toBe(1);
    expect(cardA.total_tips_usdc).toBe('1');
    expect(cardA.recent_tips[0].puid).toBe('tip-a');
    expect(cardB.total_tips).toBe(1);
    // fromMicroUsdc(9_999_000n) = "9.999"
    expect(cardB.total_tips_usdc).toBe('9.999');
    expect(cardB.recent_tips[0].puid).toBe('tip-b');
  });
});
