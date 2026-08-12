// MODULAR: Release Case integration tests — the artist-owned slice. Covers
// idempotent open linked to the real submission, and plan state re-derived
// from the authoritative submission status (the case can't claim a state the
// submission hasn't reached).

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createReleaseCasesService } = await import('../../src/services/release-cases');
const { users, submissions } = await import('../../src/lib/schema');
const { describe, it, expect, beforeAll, beforeEach } = await import('vitest');

const ARTIST = '0x' + 'a'.repeat(40);
const OTHER_ARTIST = '0x' + 'b'.repeat(40);

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
});

async function seedArtist(wallet: string) {
  await _getTestDb().insert(users).values({
    id: wallet + '-user',
    walletAddress: wallet,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();
}

async function seedSubmission(id: string, status: string, artist = ARTIST) {
  await _getTestDb().insert(submissions).values({
    id,
    artistWallet: artist,
    audioPath: 'audio/' + id,
    audioSizeBytes: 1024,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    title: 'Gravity — 3am take',
    artistName: 'A',
    versionType: 'acoustic',
    status,
  }).onConflictDoNothing();
}

describe('release case (artist slice)', () => {
  it('ensureForSubmission opens a release case linked to the submission, idempotently', async () => {
    await seedArtist(ARTIST);
    await seedSubmission('sub-r1', 'pending_payment');
    const svc = createReleaseCasesService();

    const first = await svc.ensureForSubmission({ artistWallet: ARTIST, submissionId: 'sub-r1' });
    const second = await svc.ensureForSubmission({ artistWallet: ARTIST, submissionId: 'sub-r1' });

    expect(first.submission_id).toBe('sub-r1');
    expect(second.id).toBe(first.id); // one release case per submission
    expect(first.artist_wallet).toBe(ARTIST.toLowerCase());
    // Only one row for the submission despite the double-open.
    const rows = await _getTestDb().select().from(submissions);
    expect(rows).toHaveLength(1);
  });

  it('pending_payment maps to the payment step being current', async () => {
    await seedArtist(ARTIST);
    await seedSubmission('sub-r2', 'pending_payment');
    const c = await createReleaseCasesService().ensureForSubmission({ artistWallet: ARTIST, submissionId: 'sub-r2' });

    expect(c.submission_status).toBe('pending_payment');
    const payment = c.agent_plan.find((s) => s.key === 'payment');
    const record = c.agent_plan.find((s) => s.key === 'record');
    expect(record?.done).toBe(true);
    expect(payment?.current).toBe(true);
    expect(payment?.done).toBe(false);
  });

  it('getCasesForArtist re-derives the plan from the live submission status', async () => {
    await seedArtist(ARTIST);
    await seedSubmission('sub-r3', 'pending_payment');
    const svc = createReleaseCasesService();
    await svc.ensureForSubmission({ artistWallet: ARTIST, submissionId: 'sub-r3' });

    // Submission gets published through the real pipeline; the case must follow.
    await _getTestDb().update(submissions).set({ status: 'published' });
    const [c] = await svc.getCasesForArtist(ARTIST);

    expect(c.submission_status).toBe('published');
    const outcome = c.agent_plan.find((s) => s.key === 'outcome');
    const payment = c.agent_plan.find((s) => s.key === 'payment');
    expect(outcome?.done).toBe(true);
    expect(outcome?.current).toBe(true);
    expect(payment?.done).toBe(true);
  });

  it('cases are scoped to the owning artist wallet', async () => {
    await seedArtist(ARTIST);
    await seedArtist(OTHER_ARTIST);
    await seedSubmission('sub-r4', 'pending_payment', ARTIST);
    await seedSubmission('sub-r5', 'published', OTHER_ARTIST);
    const svc = createReleaseCasesService();
    await svc.ensureForSubmission({ artistWallet: ARTIST, submissionId: 'sub-r4' });
    await svc.ensureForSubmission({ artistWallet: OTHER_ARTIST, submissionId: 'sub-r5' });

    const mine = await svc.getCasesForArtist(ARTIST);
    const theirs = await svc.getCasesForArtist(OTHER_ARTIST);
    expect(mine.map((c) => c.submission_id)).toEqual(['sub-r4']);
    expect(theirs.map((c) => c.submission_id)).toEqual(['sub-r5']);
  });
});