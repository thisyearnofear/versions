// MODULAR: Integration test — the authorized-version pilot gate end to end,
// service-level (no HTTP, per the integration convention):
//   program + approved submission → publish → catalog_source 'authorized'
//   → feed.getVersion surfaces the live program gate → revocation is
//   reflected at read time (this is what the license route's 409 checks).
// The money-path gate itself (route 409s) is a thin projection of this
// read; the demo-catalog gate follows the same test convention.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { services } = await import('../../src/lib/services');
const { clearCache } = await import('../../src/lib/cache');
const { eq } = await import('drizzle-orm');
const {
  versionPrograms,
  submissions,
  ratings,
  publishedVersions,
} = await import('../../src/lib/schema');
const { describe, it, expect, beforeAll, beforeEach } = await import('vitest');

const RIGHTS_HOLDER = '0x' + '1'.repeat(40);
const CREATOR = '0x' + '2'.repeat(40);
const CURATOR = '0x' + '3'.repeat(40);

const CONSENT_POLICY = {
  allowed_transformations: ['alt_vocals', 'remix', 'mood_flip'],
  prohibited: ['lyrics_rewrite'],
  territories: ['worldwide'],
  term_months: 24,
  revocable: true,
  model_training_allowed: false,
  notes: 'Pilot agreement §1-§4',
};

const SPLITS = [
  { wallet: RIGHTS_HOLDER, label: 'artist', share_bps: 5000 },
  { wallet: CREATOR, label: 'creator', share_bps: 4000 },
  { wallet: '0x' + '9'.repeat(40), label: 'platform', share_bps: 1000 },
];

async function seedProgram(id: string, status: 'active' | 'revoked' | 'completed' = 'active') {
  const db = _getTestDb();
  await db.insert(versionPrograms).values({
    id,
    rightsHolderWallet: RIGHTS_HOLDER,
    sourceTitle: 'Midnight Static',
    sourceArtist: 'Test Artist',
    consentPolicy: CONSENT_POLICY,
    splits: SPLITS,
    status,
  }).onConflictDoNothing();
}

async function seedProgramSubmission(id: string, programId: string | null, authorizationStatus: string | null) {
  const db = _getTestDb();
  await db.insert(submissions).values({
    id,
    artistWallet: CREATOR,
    audioPath: 'audio/' + id,
    audioSizeBytes: 1024,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    title: 'Midnight Static (alt vocals)',
    artistName: 'Creator',
    versionType: 'remix',
    status: 'in_curation',
    paymentTxHash: '0x' + 'a'.repeat(64),
    paymentVerifiedAt: new Date(),
    programId,
    authorizationStatus,
    authorizedAt: authorizationStatus ? new Date() : null,
    lineage: { creator_tools: ['manual_stem_swap'], source_version_ids: [] },
  }).onConflictDoNothing();
}

async function seedRating(submissionId: string, curator: string) {
  const db = _getTestDb();
  await db.insert(ratings).values({
    id: 'rating-' + submissionId + '-' + curator,
    submissionId,
    curatorWallet: curator,
    soloIntensity: 7,
    vocalQuality: 8,
    energyVsStudio: 'same',
    tempoFeel: 'locked',
    moodTags: ['tense', 'night'],
    notes: 'solid take',
  }).onConflictDoNothing();
}

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
  clearCache();
});

describe('integration: authorized-version pilot gate', () => {
  it('publishes an approved program version as catalog_source authorized', async () => {
    const svc = services();
    await seedProgram('prog-1');
    await seedProgramSubmission('sub-approved', 'prog-1', 'approved');
    await seedRating('sub-approved', CURATOR);

    await svc.curation.publish('sub-approved');

    const db = _getTestDb();
    const [pv] = await db
      .select()
      .from(publishedVersions)
      .where(eq(publishedVersions.submissionId, 'sub-approved'));
    expect(pv).toBeDefined();
    expect(pv.catalogSource).toBe('authorized');
  });

  it('keeps a pending_approval program version in the live catalog', async () => {
    const svc = services();
    await seedProgram('prog-1');
    await seedProgramSubmission('sub-pending', 'prog-1', 'pending_approval');
    await seedRating('sub-pending', CURATOR);

    await svc.curation.publish('sub-pending');

    const db = _getTestDb();
    const [pv] = await db
      .select()
      .from(publishedVersions)
      .where(eq(publishedVersions.submissionId, 'sub-pending'));
    expect(pv).toBeDefined();
    expect(pv.catalogSource).toBe('live');
  });

  it('surfaces the live program gate via feed.getVersion, including after revocation', async () => {
    const svc = services();
    const db = _getTestDb();
    await seedProgram('prog-2');
    await seedProgramSubmission('sub-gate', 'prog-2', 'approved');
    await seedRating('sub-gate', CURATOR);
    await svc.curation.publish('sub-gate');

    const gate = await svc.feed.getVersion('sub-gate');
    expect(gate).not.toBeNull();
    expect(gate!.version.catalogSource).toBe('authorized');
    expect(gate!.program).toEqual({
      program_id: 'prog-2',
      program_status: 'active',
      rights_holder_wallet: RIGHTS_HOLDER,
      authorization_status: 'approved',
    });

    // Revocation takes effect at read time — the license route's 409
    // (PROGRAM_NOT_ACTIVE) projects exactly this state.
    await db
      .update(versionPrograms)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(eq(versionPrograms.id, 'prog-2'));

    const revoked = await svc.feed.getVersion('sub-gate');
    expect(revoked!.program).toEqual({
      program_id: 'prog-2',
      program_status: 'revoked',
      rights_holder_wallet: RIGHTS_HOLDER,
      authorization_status: 'approved',
    });
  });

  it('returns a null program gate for non-program takes', async () => {
    const svc = services();
    const db = _getTestDb();
    await db.insert(submissions).values({
      id: 'sub-plain',
      artistWallet: CREATOR,
      audioPath: 'audio/sub-plain',
      audioSizeBytes: 1024,
      contentType: 'audio/mpeg',
      feeQuoteUsdc: '0.50',
      title: 'Plain Take',
      artistName: 'Creator',
      versionType: 'live',
      status: 'in_curation',
      paymentTxHash: '0x' + 'b'.repeat(64),
      paymentVerifiedAt: new Date(),
    }).onConflictDoNothing();
    await seedRating('sub-plain', CURATOR);
    await svc.curation.publish('sub-plain');

    const plain = await svc.feed.getVersion('sub-plain');
    expect(plain).not.toBeNull();
    expect(plain!.version.catalogSource).toBe('live');
    expect(plain!.program).toBeNull();
  });
});
