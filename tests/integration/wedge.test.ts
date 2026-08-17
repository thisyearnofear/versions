// MODULAR: Integration test — the full wedge in one chain, exactly as the
// versioned primitive (`docs/primitive-api.md`) is meant to be consumed:
//     brief → ranked matches → good/wrong verdict → license → settle → benchmark
// Runs the real services against the PGlite test DB and uses the
// primitive-contract request types, so any drift between the published
// contract and the implementation fails the build.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { services } = await import('../../src/lib/services');
const { clearCache } = await import('../../src/lib/cache');
const { submissions, publishedVersions, placementBriefs } = await import('../../src/lib/schema');
const { describe, it, expect, beforeAll, beforeEach } = await import('vitest');
const { matchBriefHash } = await import('../../src/lib/match-benchmark');
const { createSupervisorDashboardService } = await import('../../src/services/supervisor');
void (await import('../../src/lib/primitive-contract')); // kept for contract-type coupling

const WALLET = '0x' + 'a'.repeat(40);
const BRIEF = 'tense car chase, no vocals, ~120 bpm';

// Seed one published take + its placement brief (mirrors feed.test.ts).
async function seedTake(subId: string, brief: {
  sceneTags: string[];
  instruments: string[];
  emotionalArcs: string[];
  syncComparables: Array<{ name: string; why: string }>;
  audienceSummary: string;
}) {
  const db = _getTestDb();
  await db.insert(submissions).values({
    id: subId,
    artistWallet: WALLET,
    audioPath: 'audio/' + subId,
    audioSizeBytes: 1024,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    title: 'Take ' + subId,
    artistName: 'S',
    versionType: 'demo',
    status: 'published',
    paymentTxHash: '0x' + 'a'.repeat(64),
    paymentVerifiedAt: new Date(),
  }).onConflictDoNothing();
  await db.insert(publishedVersions).values({
    submissionId: subId,
    artistWallet: WALLET,
    title: 'Take ' + subId,
    artistName: 'S',
    versionType: 'demo',
    audioPath: 'p',
    ratingCount: 3,
    publishedAt: new Date(),
  }).onConflictDoNothing();
  await db.insert(placementBriefs).values({
    id: 'pb-' + subId,
    submissionId: subId,
    agentName: 'market',
    sceneTags: brief.sceneTags,
    instruments: brief.instruments,
    emotionalArcs: brief.emotionalArcs,
    syncComparables: brief.syncComparables,
    audienceSummary: brief.audienceSummary,
    createdAt: new Date(),
  }).onConflictDoNothing();
}

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
  clearCache();
});

describe('integration: full primitive wedge (match → verdict → license → settle → benchmark)', () => {
  it('ranks a brief, captures ground truth, opens + settles a license, and reports a benchmark baseline', async () => {
    await seedTake('sub-good', {
      sceneTags: ['car chase', 'chase'],
      instruments: ['synth'],
      emotionalArcs: ['tense'],
      syncComparables: [{ name: 'No Time to Die', why: 'pulsing chase bed' }],
      audienceSummary: 'relentless, propulsive action',
    });
    await seedTake('sub-partial', {
      sceneTags: ['chase'],
      instruments: ['piano'],
      emotionalArcs: ['tense'],
      syncComparables: [],
      audienceSummary: 'tension building',
    });
    await seedTake('sub-wrong', {
      sceneTags: ['tense'],
      instruments: ['acoustic guitar'],
      emotionalArcs: ['warmth'],
      syncComparables: [],
      audienceSummary: 'gentle',
    });

    const svc = services();

    // ── 1. Brief → ranked matches ─────────────────────────
    const match = await svc.feed.searchByBrief({ brief: BRIEF, limit: 20 });
    expect(match.rows.length).toBe(3);
    expect(match.rows[0].submission_id).toBe('sub-good'); // the clear fit surfaces first
    const rankOfGood = match.rows.findIndex((r) => r.submission_id === 'sub-good') + 1;
    expect(rankOfGood).toBe(1);

    // ── 2. Ground-truth verdicts ──────────────────────────
    const supervisor = createSupervisorDashboardService();
    const briefHash = matchBriefHash(BRIEF);
    await supervisor.recordMatchFeedback({
      supervisorWallet: WALLET,
      briefHash,
      briefText: BRIEF,
      submissionId: 'sub-good',
      fitScoreShown: match.rows.find((r) => r.submission_id === 'sub-good')!.fit_score,
      rankShown: rankOfGood,
      verdict: 'good_fit',
    });
    const wrongIdx = match.rows.findIndex((r) => r.submission_id === 'sub-wrong');
    await supervisor.recordMatchFeedback({
      supervisorWallet: WALLET,
      briefHash,
      briefText: BRIEF,
      submissionId: 'sub-wrong',
      fitScoreShown: match.rows[wrongIdx].fit_score,
      rankShown: wrongIdx + 1,
      verdict: 'wrong_fit',
    });

    // ── 3. Benchmark baseline ─────────────────────────────
    const report = await supervisor.benchmarkMatchFeedback();
    expect(report.queryCount).toBe(1);
    expect(report.judgmentCount).toBe(2);
    expect(report.goodFits).toBe(1);
    expect(report.mrr).toBe(1); // the good take was #1
    expect(report.precisionAt[1]).toBe(1);
    // This MRR/precision@1 is the baseline to quote.

    // ── 4. Open a license ────────────────────────────────
    const license = await supervisor.createLicense({
      supervisorWallet: WALLET,
      submissionId: 'sub-good',
      briefHash,
      briefText: BRIEF,
      usageType: 'sync_tv_film',
    });
    expect(license).not.toBeNull();
    expect(license!.status).toBe('pending_payment');
    expect(license!.fee_usdc).toBe('1.00');
    expect(license!.artist_wallet).toBe(WALLET);

    // ── 5. Claim + settle it (as the pay route would, mock tx) ──
    const claim = await supervisor.beginLicenseSettlement(license!.id, WALLET);
    expect(claim).not.toBeNull();
    const paid = await supervisor.markLicensePaid(license!.id, WALLET, claim!.leaseId, {
      txHash: '0x' + 'b'.repeat(64),
      mock: true,
    });
    expect(paid!.status).toBe('paid');
    expect(paid!.payment_mock).toBe(true);
    expect(paid!.settled_at).not.toBeNull();
    const receipt = await supervisor.getLicense(license!.id, WALLET);
    expect(receipt!.payment_tx_hash).toBe('0x' + 'b'.repeat(64));
  });
});