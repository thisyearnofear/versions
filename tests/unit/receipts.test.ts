// MODULAR: listReceipts merges three money streams (publish split legs,
// x402 tips, per-play payouts) into one artist-facing feed. Seeds via the
// real service chain (submit → verify → review/publish → play) plus direct
// x402 proof inserts, then locks ordering, totals, filtering, pagination,
// and the untouched listEarnings contract (curator dashboard regression).

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi, describe, it, expect, beforeAll, beforeEach } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { randomUUID } = await import('crypto');
const { createArcAdapter } = await import('../../src/adapters/arc');
const { createSubmissionsService } = await import('../../src/services/submissions');
const { createSettlementService } = await import('../../src/services/settlement');
const { createLlmAdapter } = await import('../../src/adapters/llm');
const { createAgentService } = await import('../../src/services/agents');
const { createArService } = await import('../../src/services/ar');
const { x402Proofs } = await import('../../src/lib/schema');
const { signMessage, TEST_ADDRESSES } = await import('../helpers/sig');
const { clearCache } = await import('../../src/lib/cache');

const TEST_PLATFORM_WALLET = TEST_ADDRESSES.acc0;
// submissions.createSubmission normalizes artistWallet to lowercase via
// walletKey = artistWallet.toLowerCase() before DB storage. Settlement legs
// and play events inherit that lowercase value. Using the checksummed (EIP-55)
// form from TEST_ADDRESSES would cause eq() mismatches in listReceipts.
const ARTIST_WALLET = TEST_ADDRESSES.acc1.toLowerCase();
const AGENT_WALLETS = [TEST_ADDRESSES.acc2, TEST_ADDRESSES.acc3, '0x' + 'b'.repeat(40)];
const AR_WALLET = '0x' + 'c'.repeat(40);
const MOCK_HASH = '0x' + 'ab'.repeat(32);

let submissions: ReturnType<typeof createSubmissionsService>;
let settlement: ReturnType<typeof createSettlementService>;
let agents: ReturnType<typeof createAgentService>;
let ar: ReturnType<typeof createArService>;
let submissionId: string;

async function insertTip({
  amountMicroUsdc,
  status,
  when,
}: {
  amountMicroUsdc: string;
  status: 'verified' | 'settled';
  when: Date;
}) {
  await _getTestDb().insert(x402Proofs).values({
    id: randomUUID(),
    puid: randomUUID(),
    resourceUrl: '/api/x402/tip',
    scheme: 'exact',
    network: 'arc-testnet',
    asset: 'USDC',
    payTo: TEST_PLATFORM_WALLET,
    amountMicroUsdc,
    validUntil: new Date(when.getTime() + 300_000),
    tipperWallet: '0x00000000000000000000000000000000000001',
    artistWallet: ARTIST_WALLET,
    message: null,
    signature: '0x' + '00'.repeat(65),
    txHash: status === 'settled' ? MOCK_HASH : null,
    status,
    createdAt: when,
    settledAt: status === 'settled' ? when : null,
  });
}

beforeAll(async () => {
  await _initTestDb();
  const arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
  submissions = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  settlement = createSettlementService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  const llm = createLlmAdapter({});
  agents = createAgentService({ llm, settlement, agentWallets: AGENT_WALLETS });
  ar = createArService({ arc, arWallet: AR_WALLET });
});

beforeEach(async () => {
  await _resetTestDb();
  clearCache();
  const sig = await signMessage(1, 'VERSIONS_LEPTON_SUBMIT');
  const r = await submissions.createSubmission({
    audioPath: 'data/uploads/test-receipts.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    durationSeconds: 180,
    metadata: {
      title: 'Receipts Test',
      artistName: 'Receipt Artist',
      versionType: 'live',
      genre: 'rock',
      mood: 'energetic',
    },
    artistWallet: ARTIST_WALLET,
    signature: sig,
  });
  if (!r.ok) throw new Error('setup failed: ' + r.error);
  submissionId = r.submission.id;
  await submissions.verifyPayment(submissionId, '0x' + 'a'.repeat(64));
  const review = await agents.reviewSubmission(submissionId);
  if (!review.ok) throw new Error('review failed: ' + review.error);
});

async function seedPlaysAndTips() {
  await ar.generatePlaylists();
  const playlists = await ar.listPlaylists();
  const playlist = playlists[0];
  await ar.recordPlay({ playlistId: playlist.id, versionId: submissionId, listenerWallet: 'listener_001' });
  await ar.recordPlay({ playlistId: playlist.id, versionId: submissionId, listenerWallet: 'listener_002' });
  const now = Date.now();
  await insertTip({ amountMicroUsdc: '500', status: 'settled', when: new Date(now - 1000_000) });
  await insertTip({ amountMicroUsdc: '2000000', status: 'verified', when: new Date(now - 2000_000) });
}

describe('settlement.listReceipts', () => {
  it('merges splits + tips + plays, newest first', async () => {
    await seedPlaysAndTips();
    const report = await settlement.listReceipts(ARTIST_WALLET, {});
    expect(report.wallet).toBe(ARTIST_WALLET);

    const sources = new Set(report.rows.map((r) => r.source));
    expect(sources).toEqual(new Set(['split', 'tip', 'play']));

    const times = report.rows.map((r) => r.occurred_at?.getTime() ?? 0);
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });

  it('per-source totals and counts match the seeded chain', async () => {
    await seedPlaysAndTips();
    const report = await settlement.listReceipts(ARTIST_WALLET, {});

    const legs = await settlement.getLegsForSubmission(submissionId);
    const artistLegs = legs.filter((l) => l.recipientWallet === ARTIST_WALLET && l.status === 'settled');
    expect(artistLegs.length).toBeGreaterThan(0);
    const expectedSplits = artistLegs.reduce((sum, l) => sum + Number(l.amountUsdc), 0);

    expect(report.counts.splits).toBe(artistLegs.length);
    expect(report.counts.tips).toBe(2);
    expect(report.counts.plays).toBe(2);
    expect(report.totals.splits).toBeCloseTo(expectedSplits, 6);
    expect(report.totals.tips).toBeCloseTo(2.0005, 6); // 500 + 2000000 micro
    expect(report.totals.plays).toBeCloseTo(0.001, 6); // 2 plays × 0.0005
    expect(report.totals.all).toBeCloseTo(expectedSplits + 2.0005 + 0.001, 6);
    expect(report.total_rows).toBe(artistLegs.length + 4);
  });

  it('converts tip micro amounts to USDC strings', async () => {
    await seedPlaysAndTips();
    const report = await settlement.listReceipts(ARTIST_WALLET, { source: 'tip' });
    const amounts = report.rows.map((r) => r.amount_usdc).sort();
    expect(amounts).toContain('0.0005');
    expect(amounts).toContain('2');
  });

  it('source filter narrows rows and total_rows', async () => {
    await seedPlaysAndTips();
    const tips = await settlement.listReceipts(ARTIST_WALLET, { source: 'tip' });
    expect(tips.rows.every((r) => r.source === 'tip')).toBe(true);
    expect(tips.total_rows).toBe(2);

    const plays = await settlement.listReceipts(ARTIST_WALLET, { source: 'play' });
    expect(plays.rows.every((r) => r.source === 'play')).toBe(true);
    expect(plays.total_rows).toBe(2);
    expect(plays.rows[0].title).toBe('Receipts Test');
    expect(plays.rows[0].counterparty).toMatch(/^listener_/);
  });

  it('limit/offset paginate without overlap', async () => {
    await seedPlaysAndTips();
    const all = await settlement.listReceipts(ARTIST_WALLET, { limit: 100 });
    const page1 = await settlement.listReceipts(ARTIST_WALLET, { limit: 2, offset: 0 });
    const page2 = await settlement.listReceipts(ARTIST_WALLET, { limit: 2, offset: 2 });

    expect(page1.rows.length).toBe(2);
    expect(page1.total_rows).toBe(all.total_rows);
    const ids1 = new Set(page1.rows.map((r) => r.id));
    for (const row of page2.rows) expect(ids1.has(row.id)).toBe(false);
    expect([...ids1, ...page2.rows.map((r) => r.id)]).toEqual(
      all.rows.slice(0, 2 + page2.rows.length).map((r) => r.id),
    );
  });

  it('verified tips appear with no tx hash (still settling)', async () => {
    await seedPlaysAndTips();
    const tips = await settlement.listReceipts(ARTIST_WALLET, { source: 'tip' });
    const verified = tips.rows.find((r) => r.status === 'verified');
    expect(verified).toBeDefined();
    expect(verified!.tx_hash).toBeNull();
    const settled = tips.rows.find((r) => r.status === 'settled');
    expect(settled!.tx_hash).toBe(MOCK_HASH);
  });

  it('returns empty report for a wallet with no receipts', async () => {
    const report = await settlement.listReceipts('0x' + 'f'.repeat(40), {});
    expect(report.rows).toEqual([]);
    expect(report.total_rows).toBe(0);
    expect(report.totals.all).toBe(0);
  });

  it('listEarnings output is unchanged by listReceipts (curator regression lock)', async () => {
    await seedPlaysAndTips();
    const before = await settlement.listEarnings(ARTIST_WALLET, {});
    await settlement.listReceipts(ARTIST_WALLET, {});
    const after = await settlement.listEarnings(ARTIST_WALLET, {});

    expect(after).toEqual(before);
    expect(after.wallet).toBe(ARTIST_WALLET);
    expect(typeof after.total).toBe('number');
    expect(Array.isArray(after.by_role)).toBe(true);
    expect(Array.isArray(after.recent)).toBe(true);
    // Earnings stays legs-only: no tip or play rows leak in.
    expect(after.total).toBeCloseTo(
      after.recent.reduce((s: number, l: { amount: string }) => s + Number(l.amount), 0),
      6,
    );
  });
});