// MODULAR: curation service integration tests. EVM signatures, full flow.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi, describe, it, expect, beforeAll, beforeEach } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createArcAdapter } = await import('../../src/adapters/arc');
const { createSubmissionsService } = await import('../../src/services/submissions');
const { createSettlementService } = await import('../../src/services/settlement');
const { createCurationService, verifyWalletSignature } = await import('../../src/services/curation');
const { signMessage, TEST_ADDRESSES } = await import('../helpers/sig');

const TEST_PLATFORM_WALLET = TEST_ADDRESSES.acc0;
let arc: ReturnType<typeof createArcAdapter>;
let submissions: ReturnType<typeof createSubmissionsService>;
let settlement: ReturnType<typeof createSettlementService>;
let curation: ReturnType<typeof createCurationService>;
let submissionId: string;

beforeAll(async () => {
  await _initTestDb();
  arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
  submissions = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  settlement = createSettlementService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  curation = createCurationService({ settlement });
});

beforeEach(async () => {
  await _resetTestDb();
  // Create + verify a fresh submission
  const sig = await signMessage(1, 'VERSIONS_LEPTON_SUBMIT');
  const r = await submissions.createSubmission({
    audioPath: 'data/uploads/test.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    metadata: { title: 'Curation Test', artistName: 'Test Artist', versionType: 'demo', genre: 'rock', mood: 'crisp' },
    artistWallet: TEST_ADDRESSES.acc1,
    signature: sig,
  });
  if (!r.ok) throw new Error('setup failed: ' + r.error);
  submissionId = r.submission.id;
  await submissions.verifyPayment(submissionId, '0x' + 'a'.repeat(64));
});

async function rateAs(curatorIndex: 1 | 2 | 3, rating: unknown) {
  // claim first
  const claimSig = await signMessage(curatorIndex, 'VERSIONS_LEPTON_CLAIM');
  const c = await curation.claimSubmission({
    submissionId,
    curatorWallet: TEST_ADDRESSES[`acc${curatorIndex}` as keyof typeof TEST_ADDRESSES] as `0x${string}`,
    signature: claimSig,
  });
  if (!c.ok) throw new Error('claim failed: ' + c.error);
  const rateSig = await signMessage(curatorIndex, 'VERSIONS_LEPTON_RATE');
  return curation.submitRating({
    submissionId,
    curatorWallet: TEST_ADDRESSES[`acc${curatorIndex}` as keyof typeof TEST_ADDRESSES] as `0x${string}`,
    signature: rateSig,
    rating,
  });
}

describe('curation: verifyWalletSignature', () => {
  it('accepts a valid signature', async () => {
    const sig = await signMessage(1, 'VERSIONS_LEPTON_CLAIM');
    const r = verifyWalletSignature({ message: 'VERSIONS_LEPTON_CLAIM', wallet: TEST_ADDRESSES.acc1, signature: sig });
    expect(r.ok).toBe(true);
  });

  it('rejects invalid wallet', () => {
    const r = verifyWalletSignature({ message: 'X', wallet: 'not-a-wallet', signature: '0x' + 'a'.repeat(130) });
    expect(r.ok).toBe(false);
  });

  it('rejects bad signature shape', () => {
    const r = verifyWalletSignature({ message: 'X', wallet: TEST_ADDRESSES.acc1, signature: '0xshort' });
    expect(r.ok).toBe(false);
  });
});

describe('curation: claim flow', () => {
  it('artist cannot claim their own submission', async () => {
    const sig = await signMessage(1, 'VERSIONS_LEPTON_CLAIM');
    const r = await curation.claimSubmission({
      submissionId,
      curatorWallet: TEST_ADDRESSES.acc1,
      signature: sig,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/artist/i);
  });

  it('valid curator can claim', async () => {
    const sig = await signMessage(2, 'VERSIONS_LEPTON_CLAIM');
    const r = await curation.claimSubmission({
      submissionId,
      curatorWallet: TEST_ADDRESSES.acc2,
      signature: sig,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claim.id).toBeTruthy();
  });

  it('same curator cannot double-claim while active', async () => {
    const sig = await signMessage(2, 'VERSIONS_LEPTON_CLAIM');
    await curation.claimSubmission({ submissionId, curatorWallet: TEST_ADDRESSES.acc2, signature: sig });
    const sig2 = await signMessage(2, 'VERSIONS_LEPTON_CLAIM');
    const r2 = await curation.claimSubmission({ submissionId, curatorWallet: TEST_ADDRESSES.acc2, signature: sig2 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/active claim/i);
  });

  it('rejected for unknown submission', async () => {
    const sig = await signMessage(2, 'VERSIONS_LEPTON_CLAIM');
    const r = await curation.claimSubmission({
      submissionId: 'nope',
      curatorWallet: TEST_ADDRESSES.acc2,
      signature: sig,
    });
    expect(r.ok).toBe(false);
  });
});

describe('curation: rate flow', () => {
  it('rejected when there is no claim', async () => {
    const sig = await signMessage(2, 'VERSIONS_LEPTON_RATE');
    const r = await curation.submitRating({
      submissionId,
      curatorWallet: TEST_ADDRESSES.acc2,
      signature: sig,
      rating: { solo_intensity: 5, vocal_quality: 5, energy_vs_studio: 'same', tempo_feel: 'locked', mood_tags: ['Bluesy'] },
    });
    expect(r.ok).toBe(false);
  });

  it('invalid rating values are rejected', async () => {
    const r = await rateAs(2, { solo_intensity: 11, vocal_quality: 5, energy_vs_studio: 'same', tempo_feel: 'locked', mood_tags: [] });
    expect(r.ok).toBe(false);
  });

  it('valid rating is recorded, no publish yet', async () => {
    const r = await rateAs(2, { solo_intensity: 7, vocal_quality: 8, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: ['Bluesy', 'Raw'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rating_count).toBe(1);
      expect(r.published).toBeNull();
    }
  });

  it('same curator cannot rate twice', async () => {
    await rateAs(2, { solo_intensity: 7, vocal_quality: 8, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: [] });
    // Second call: submit rating directly (claim already exists from first rateAs)
    const rateSig = await signMessage(2, 'VERSIONS_LEPTON_RATE');
    const r = await curation.submitRating({
      submissionId,
      curatorWallet: TEST_ADDRESSES.acc2,
      signature: rateSig,
      rating: { solo_intensity: 6, vocal_quality: 6, energy_vs_studio: 'same', tempo_feel: 'locked', mood_tags: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already rated/i);
  });

  it('3rd curator triggers publish', async () => {
    await rateAs(2, { solo_intensity: 7, vocal_quality: 8, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: ['Bluesy', 'Raw'] });
    await rateAs(3, { solo_intensity: 9, vocal_quality: 6, energy_vs_studio: 'higher', tempo_feel: 'locked', mood_tags: ['Euphoric'] });
    const r3 = await rateAs(0, { solo_intensity: 5, vocal_quality: 7, energy_vs_studio: 'same', tempo_feel: 'rushing', mood_tags: ['Raw'] });
    expect(r3.ok).toBe(true);
    if (r3.ok) {
      expect(r3.rating_count).toBe(3);
      expect(r3.published).not.toBeNull();
      expect(r3.published!.alreadyPublished).toBe(false);
      expect(r3.published!.settlement_legs?.length).toBe(5);
      const total = r3.published!.settlement_legs!.reduce(
        (a: number, l: { amountUsdc: string }) => a + Number.parseFloat(l.amountUsdc),
        0,
      );
      expect(Math.abs(total - 0.5)).toBeLessThan(1e-9);
    }
  });
});

describe('curation: profiles', () => {
  it('curator profile reports count', async () => {
    await rateAs(2, { solo_intensity: 7, vocal_quality: 8, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: [] });
    const profile = await curation.getCuratorProfile(TEST_ADDRESSES.acc2);
    expect(profile.ratings_count).toBe(1);
    expect(profile.recent_ratings[0].soloIntensity).toBe(7);
  });
});
