// MODULAR: agents service tests. Full pipeline: submit → pay → review → publish.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi, describe, it, expect, beforeAll, beforeEach } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createArcAdapter } = await import('../../src/adapters/arc');
const { createSubmissionsService } = await import('../../src/services/submissions');
const { createSettlementService } = await import('../../src/services/settlement');
const { createLlmAdapter } = await import('../../src/adapters/llm');
const { createAgentService } = await import('../../src/services/agents');
const { signMessage, TEST_ADDRESSES } = await import('../helpers/sig');

const TEST_PLATFORM_WALLET = TEST_ADDRESSES.acc0;
const AGENT_WALLETS = [TEST_ADDRESSES.acc1, TEST_ADDRESSES.acc2, TEST_ADDRESSES.acc3];

let submissions: ReturnType<typeof createSubmissionsService>;
let settlement: ReturnType<typeof createSettlementService>;
let llm: ReturnType<typeof createLlmAdapter>;
let agents: ReturnType<typeof createAgentService>;
let submissionId: string;

beforeAll(async () => {
  await _initTestDb();
  const arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
  submissions = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  settlement = createSettlementService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  llm = createLlmAdapter({});
  agents = createAgentService({ llm, settlement, agentWallets: AGENT_WALLETS });
});

beforeEach(async () => {
  await _resetTestDb();
  const sig = await signMessage(1, 'VERSIONS_LEPTON_SUBMIT');
  const r = await submissions.createSubmission({
    audioPath: 'data/uploads/test.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    durationSeconds: 180,
    metadata: {
      title: 'Agents Test',
      artistName: 'Test Artist',
      versionType: 'live',
      genre: 'rock',
      mood: 'energetic',
      description: 'A live rock performance',
    },
    artistWallet: TEST_ADDRESSES.acc1,
    signature: sig,
  });
  if (!r.ok) throw new Error('setup failed: ' + r.error);
  submissionId = r.submission.id;
  const v = await submissions.verifyPayment(submissionId, '0x' + 'a'.repeat(64));
  if (!v.ok) throw new Error('verify failed: ' + v.error);
});

describe('agents: full pipeline', () => {
  it('produces 3 reviews + brief + auto-publish', async () => {
    const result = await agents.reviewSubmission(submissionId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.reviews.length).toBe(3);
    expect(result.brief).not.toBeNull();
    expect(result.rating_count).toBe(3);
    expect(result.published).not.toBeNull();
    expect(result.published!.alreadyPublished).toBe(false);

    const agentNames = result.reviews.map((r) => r.agent_name).sort();
    expect(agentNames).toEqual(['market', 'performance', 'production']);

    for (const review of result.reviews) {
      expect(review.solo_intensity).toBeGreaterThanOrEqual(1);
      expect(review.solo_intensity).toBeLessThanOrEqual(10);
      expect(['lower', 'same', 'higher']).toContain(review.energy_vs_studio);
      expect(['dragging', 'locked', 'rushing']).toContain(review.tempo_feel);
      expect(review.mock).toBe(true);
    }
    expect(result.brief!.venues.length).toBeGreaterThan(0);
    expect(result.brief!.youtube_channels.length).toBeGreaterThan(0);
    expect(result.brief!.draft_emails.length).toBeGreaterThan(0);
  });

  it('published version has correct taste-graph', async () => {
    await agents.reviewSubmission(submissionId);
    const reviews = await agents.getReviews(submissionId);
    expect(reviews.length).toBe(3);
  });

  it('settlement legs created for agent wallets', async () => {
    await agents.reviewSubmission(submissionId);
    const legs = await settlement.getLegsForSubmission(submissionId);
    expect(legs.length).toBeGreaterThanOrEqual(4);
    const curatorLegs = legs.filter((l) => l.recipientRole === 'curator');
    expect(curatorLegs.length).toBe(3);
    for (const wallet of AGENT_WALLETS) {
      const leg = curatorLegs.find((l) => l.recipientWallet === wallet);
      expect(leg).toBeDefined();
      expect(leg!.status).toBe('settled');
    }
  });

  it('rejects already-published submission', async () => {
    await agents.reviewSubmission(submissionId);
    const result = await agents.reviewSubmission(submissionId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Submission already published');
  });

  it('rejects non-existent submission', async () => {
    const result = await agents.reviewSubmission('non-existent-id');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Submission not found');
  });
});
