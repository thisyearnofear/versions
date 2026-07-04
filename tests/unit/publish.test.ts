// MODULAR: publish-gate race tests. Proves the uq_legs_submission_wallet_role
// unique index in src/lib/schema.ts catches a double-publish race and that
// insertLegsAtomic's onConflictDoNothing + re-query pattern makes the
// publish gate idempotent for a given submission.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { clearCache } = await import('../../src/lib/cache');
const { createArcAdapter } = await import('../../src/adapters/arc');
const { createSettlementService } = await import('../../src/services/settlement');
const { createCurationService } = await import('../../src/services/curation');
const { randomUUID } = await import('crypto');
const { eq, sql } = await import('drizzle-orm');
const { submissions, ratings, settlementLegs } = await import('../../src/lib/schema');

const TEST_PLATFORM_WALLET = '0x' + 'a'.repeat(40);
const TEST_ARTIST_WALLET = '0x' + 'b'.repeat(40);
const CURATOR_WALLETS = ['0x' + 'c'.repeat(40), '0x' + 'd'.repeat(40), '0x' + 'e'.repeat(40)];

let settlement: ReturnType<typeof createSettlementService>;
let curation: ReturnType<typeof createCurationService>;

/**
 * Insert a submission directly in 'in_curation' status and seed exactly
 * 3 ratings (one per curator wallet). This satisfies the publish gate
 * (PUBLISH_THRESHOLD = 3) WITHOUT triggering the agent auto-publish
 * pipeline, so callers control when publishSubmission fires.
 */
async function seedReadySubmission() {
  const submissionId = 'sub-' + randomUUID();
  await _getTestDb().insert(submissions).values({
    id: submissionId,
    artistWallet: TEST_ARTIST_WALLET,
    audioPath: 'data/uploads/test-publish.mp3',
    audioSizeBytes: 1024,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    title: 'Publish Race',
    artistName: 'Race Artist',
    versionType: 'demo',
    genre: 'rock',
    status: 'in_curation',
    ratingCount: 3,
    paymentTxHash: '0x' + 'a'.repeat(64),
    paymentVerifiedAt: new Date(),
  });
  await _getTestDb().insert(ratings).values(
    CURATOR_WALLETS.map((wallet, idx) => ({
      id: 'rating-' + idx,
      submissionId,
      curatorWallet: wallet,
      soloIntensity: 7,
      vocalQuality: 8,
      energyVsStudio: 'higher',
      tempoFeel: 'rushing',
      moodTags: ['energetic'],
      notes: 'test',
    })),
  );
  return submissionId;
}

beforeAll(async () => {
  await _initTestDb();
  const arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
  settlement = createSettlementService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  curation = createCurationService({ settlement });
});

beforeEach(async () => {
  await _resetTestDb();
  clearCache();
});

describe('publish: unique constraint defense', () => {
  it('uq_legs_submission_wallet_role rejects duplicate (submission, wallet, role) inserts', async () => {
    const submissionId = await seedReadySubmission();
    await _getTestDb().insert(settlementLegs).values({
      id: 'leg-curator-1',
      submissionId,
      recipientWallet: CURATOR_WALLETS[0],
      recipientRole: 'curator',
      amountUsdc: '0.35',
      status: 'pending',
    });
    await expect(
      _getTestDb().insert(settlementLegs).values({
        id: 'leg-curator-2',
        submissionId,
        recipientWallet: CURATOR_WALLETS[0],
        recipientRole: 'curator',
        amountUsdc: '0.35',
        status: 'pending',
      }),
    ).rejects.toThrow();
  });

  it('same wallet in two different roles is allowed (platform + musicbrainz fallback)', async () => {
    const submissionId = await seedReadySubmission();
    await _getTestDb().insert(settlementLegs).values({
      id: 'leg-platform',
      submissionId,
      recipientWallet: TEST_PLATFORM_WALLET,
      recipientRole: 'platform',
      amountUsdc: '0.10',
      status: 'pending',
    });
    await _getTestDb().insert(settlementLegs).values({
      id: 'leg-mb',
      submissionId,
      recipientWallet: TEST_PLATFORM_WALLET,
      recipientRole: 'musicbrainz',
      amountUsdc: '0.05',
      status: 'pending',
    });
    const rows = await _getTestDb()
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(settlementLegs)
      .where(eq(settlementLegs.submissionId, submissionId));
    expect(Number(rows[0]?.n ?? 0)).toBe(2);
  });

  it('publish gate inserts legs cleanly when no orphans exist', async () => {
    const submissionId = await seedReadySubmission();
    const r = await curation.publish(submissionId);
    expect(r.alreadyPublished).toBe(false);
    if (!r.alreadyPublished) {
      // 3 curator legs + 1 platform + 1 musicbrainz = 5 legs.
      expect(r.legIds.length).toBe(5);
    }
  });

  it('publish gate is idempotent when orphan legs from a prior failed publish exist', async () => {
    const submissionId = await seedReadySubmission();
    await _getTestDb().insert(settlementLegs).values([
      {
        id: 'orphan-curator',
        submissionId,
        recipientWallet: CURATOR_WALLETS[0],
        recipientRole: 'curator',
        amountUsdc: '0.30',
        status: 'pending',
      },
      {
        id: 'orphan-platform',
        submissionId,
        recipientWallet: TEST_PLATFORM_WALLET,
        recipientRole: 'platform',
        amountUsdc: '0.10',
        status: 'pending',
      },
      {
        id: 'orphan-mb',
        submissionId,
        recipientWallet: TEST_ARTIST_WALLET,
        recipientRole: 'musicbrainz',
        amountUsdc: '0.05',
        status: 'pending',
      },
    ]);
    const r = await curation.publish(submissionId);
    expect(r.alreadyPublished).toBe(false);
    if (!r.alreadyPublished) {
      expect(r.legIds.length).toBe(5);
    }
    const rows = await _getTestDb()
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(settlementLegs)
      .where(eq(settlementLegs.submissionId, submissionId));
    expect(Number(rows[0]?.n ?? 0)).toBe(5);
  });

  it('publish-twice: second call is a no-op via the published_versions unique key', async () => {
    const submissionId = await seedReadySubmission();
    const r1 = await curation.publish(submissionId);
    expect(r1.alreadyPublished).toBe(false);
    if (!r1.alreadyPublished) expect(r1.legIds.length).toBe(5);
    const r2 = await curation.publish(submissionId);
    expect(r2.alreadyPublished).toBe(true);
    expect(r2.legIds.length).toBe(0);
    const rows = await _getTestDb()
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(settlementLegs)
      .where(eq(settlementLegs.submissionId, submissionId));
    expect(Number(rows[0]?.n ?? 0)).toBe(5);
  });
});

describe('publish: PublishLegIncompleteError', () => {
  it('exposes submissionId, expected, actual, actualLegIds, code, and is instanceof Error', async () => {
    const { PublishLegIncompleteError } = await import('../../src/services/publish');
    const err = new PublishLegIncompleteError({
      submissionId: 'sub-1',
      expected: 5,
      actual: 3,
      actualLegIds: ['leg-a', 'leg-b', 'leg-c'],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PublishLegIncompleteError);
    expect(err.name).toBe('PublishLegIncompleteError');
    expect(err.code).toBe('publish_legs_incomplete');
    expect(err.submissionId).toBe('sub-1');
    expect(err.expected).toBe(5);
    expect(err.actual).toBe(3);
    expect(err.actualLegIds).toEqual(['leg-a', 'leg-b', 'leg-c']);
    expect(err.message).toContain('sub-1');
    expect(err.message).toContain('expected 5');
    expect(err.message).toContain('got 3');
  });

  it('over-count case: invalid orphan leg succeeds with 6 rows total (publish does not throw)', async () => {
    const submissionId = await seedReadySubmission();
    await _getTestDb().insert(settlementLegs).values({
      id: 'orphan-invalid',
      submissionId,
      recipientWallet: TEST_ARTIST_WALLET,
      recipientRole: 'curator',
      amountUsdc: '0.99',
      status: 'pending',
    });
    const r = await curation.publish(submissionId);
    expect(r.alreadyPublished).toBe(false);
    if (!r.alreadyPublished) {
      expect(r.legIds.length).toBe(6);
      // Verify the orphan is present AND the build's intended (wallet,
      // role) pairs are all present. The build produces 3 curator legs
      // (one per curator wallet), 1 platform leg, 1 musicbrainz leg.
      // The orphan adds 1 extra curator leg (artist, curator).
      const legRows = await _getTestDb()
        .select({
          recipientWallet: settlementLegs.recipientWallet,
          recipientRole: settlementLegs.recipientRole,
        })
        .from(settlementLegs)
        .where(eq(settlementLegs.submissionId, submissionId));
      const presentKeys = new Set(
        legRows.map((row) => `${row.recipientWallet}:${row.recipientRole}`),
      );
      // The orphan must be present.
      expect(presentKeys.has(`${TEST_ARTIST_WALLET}:curator`)).toBe(true);
      // All 3 curator legs from the build must be present.
      for (const wallet of CURATOR_WALLETS) {
        expect(presentKeys.has(`${wallet}:curator`)).toBe(true);
      }
      // Platform and musicbrainz legs must be present.
      expect(presentKeys.has(`${TEST_PLATFORM_WALLET}:platform`)).toBe(true);
      expect(presentKeys.has(`${TEST_ARTIST_WALLET}:musicbrainz`)).toBe(true);
      // Total: 3 curator + 1 orphan (artist, curator) + 1 platform + 1 musicbrainz = 6.
      expect(presentKeys.size).toBe(6);
    }
    const rows = await _getTestDb()
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(settlementLegs)
      .where(eq(settlementLegs.submissionId, submissionId));
    expect(Number(rows[0]?.n ?? 0)).toBe(6);
  });

  it('under-count case: publishSubmission throws PublishLegIncompleteError when insertLegsAtomic returns fewer legs', async () => {
    const { PublishLegIncompleteError } = await import('../../src/services/publish');
    const localSettlement = {
      ...settlement,
      insertLegsAtomic: async () => [
        {
          id: 'fake-1',
          submission_id: 'x',
          recipient_wallet: '0xa',
          recipient_role: 'platform' as const,
          amount_usdc: '0.10',
          status: 'pending' as const,
          created_at: new Date().toISOString(),
        },
      ],
    };
    const localCuration = createCurationService({ settlement: localSettlement });
    const submissionId = await seedReadySubmission();
    let caught: unknown = null;
    try {
      await localCuration.publish(submissionId);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PublishLegIncompleteError);
    const err = caught as PublishLegIncompleteError;
    expect(err.submissionId).toBe(submissionId);
    expect(err.expected).toBe(5);
    expect(err.actual).toBe(1);
    expect(err.actualLegIds).toEqual(['fake-1']);
    expect(err.code).toBe('publish_legs_incomplete');
    expect(err.message).toContain(submissionId);
    expect(err.message).toContain('expected 5');
    expect(err.message).toContain('got 1');
  });

  it('upstream: agents.reviewSubmission catches PublishLegIncompleteError and returns a clean error', async () => {
    const { createLlmAdapter } = await import('../../src/adapters/llm');
    const { createAgentService } = await import('../../src/services/agents');
    const { createSubmissionsService } = await import('../../src/services/submissions');
    const { signMessage, TEST_ADDRESSES } = await import('../helpers/sig');

    const arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
    const localSettlement = createSettlementService({ arc, platformWallet: TEST_PLATFORM_WALLET });
    localSettlement.insertLegsAtomic = (async () => [
      {
        id: 'fake-1',
        submission_id: 'x',
        recipient_wallet: '0xa',
        recipient_role: 'platform' as const,
        amount_usdc: '0.10',
        status: 'pending' as const,
        created_at: new Date().toISOString(),
      },
    ]) as typeof localSettlement.insertLegsAtomic;
    const submissionsSvc = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
    const llm = createLlmAdapter({});
    const agentsSvc = createAgentService({
      llm,
      settlement: localSettlement,
      agentWallets: ['0x' + 'f'.repeat(40), '0x' + 'e'.repeat(40), '0x' + 'd'.repeat(40)],
    });

    const sig = await signMessage(1, 'VERSIONS_LEPTON_SUBMIT');
    const r = await submissionsSvc.createSubmission({
      audioPath: 'data/uploads/test-publish-err.mp3',
      contentType: 'audio/mpeg',
      sizeBytes: 1024,
      durationSeconds: 180,
      metadata: {
        title: 'Publish Err',
        artistName: 'Err Artist',
        versionType: 'demo',
        genre: 'rock',
      },
      artistWallet: TEST_ADDRESSES.acc1,
      signature: sig,
    });
    if (!r.ok) throw new Error('setup failed: ' + r.error);
    await submissionsSvc.verifyPayment(r.submission.id, '0x' + 'a'.repeat(64));
    const review = await agentsSvc.reviewSubmission(r.submission.id);
    expect(review.ok).toBe(false);
    if (!review.ok) {
      expect(review.error).toContain('missing settlement legs');
      expect((review as { code?: string }).code).toBe('publish_legs_incomplete');
    }
  });
});
