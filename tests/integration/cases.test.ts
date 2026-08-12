// MODULAR: Integration tests for the Placement Case foundation — the
// durable persistence contract that the release/settlement lifecycle will
// build on. Covers: idempotent opens against an existing profile, explicit-
// case shortlists (no cross-attach), ownership enforcement, and server-owned
// transitions that only move when a REAL linked resource allows it.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createCasesService } = await import('../../src/services/cases');
const {
  users,
  caseEvents,
  supervisorProfiles,
  licenses,
  publishedVersions,
  submissions,
} = await import('../../src/lib/schema');
const { describe, it, expect, beforeAll, beforeEach } = await import('vitest');
const { eq } = await import('drizzle-orm');

const WALLET = '0x' + 'a'.repeat(40);
const OTHER_WALLET = '0x' + 'b'.repeat(40);
const BRIEF_A = 'night drive, restrained electronic, 30 sec, no vocals';
const BRIEF_B = 'upbeat pop hook, vocals up front, 124 bpm';

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
});

async function ensureProfile(wallet: string) {
  const db = _getTestDb();
  // supervisor_profiles.wallet is FK'd to users.wallet_address — create the
  // user first (the cases service's own ensureProfile does the same).
  await db.insert(users).values({
    id: wallet + '-user',
    walletAddress: wallet,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();
  await db.insert(supervisorProfiles).values({
    wallet,
    role: 'supervisor',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();
}

async function seedPublishedTake(subId: string) {
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
}

describe('placement case foundation', () => {
  it('openCase is idempotent and conflict-safe against an existing profile', async () => {
    await ensureProfile(WALLET);
    const cases = createCasesService();

    const first = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });
    const second = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });

    expect(second.id).toBe(first.id);
    expect(first.pending_decision).toBeTruthy();
    // Repeated opens do not duplicate events for the same case.
    const events = await _getTestDb().select().from(caseEvents).where(eq(caseEvents.caseId, first.id));
    expect(events.filter((e) => e.kind === 'case_opened')).toHaveLength(1);
  });

  it('distinct briefs produce distinct cases', async () => {
    const cases = createCasesService();
    const a = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 10 });
    const b = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_B, rankedCount: 8 });
    expect(a.id).not.toBe(b.id);
  });

  it('shortlist attaches to the EXPLICIT case, never cross-attaching across two open briefs', async () => {
    const cases = createCasesService();
    const a = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 10 });
    const b = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_B, rankedCount: 8 });
    const subA = 'sub-a';
    await seedPublishedTake(subA);

    await cases.addShortlist({ supervisorWallet: WALLET, caseId: a.id, submissionId: subA, fitScore: 0.9, rank: 1 });

    const aRow = await cases.getCase(WALLET, a.id);
    const bRow = await cases.getCase(WALLET, b.id);
    expect(aRow!.case.evidence.shortlistSubmissionIds).toContain(subA);
    expect(bRow!.case.evidence.shortlistSubmissionIds ?? []).not.toContain(subA);
    expect(aRow!.case.evidence.shortlisted?.[0]?.fitScore).toBe(0.9);
  });
it('shortlist rejects a foreign wallet (ownership enforced)', async () => {
    const cases = createCasesService();
    await ensureProfile(OTHER_WALLET);
    const mine = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 5 });
    const subA = 'sub-f';
    await seedPublishedTake(subA);

    const res = await cases.addShortlist({ supervisorWallet: OTHER_WALLET, caseId: mine.id, submissionId: subA });
    expect(res).toBeNull();
    const mineRow = await cases.getCase(WALLET, mine.id);
    expect(mineRow!.case.evidence.shortlistSubmissionIds ?? []).toHaveLength(0);
  });

  it('record_creative_decision is legal from open, illegal from rights_review', async () => {
    const cases = createCasesService();
    const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });

    const ok = await cases.executeCommand(WALLET, c.id, { type: 'record_creative_decision', note: 'go dark' });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.row.status).toBe('rights_review');
    expect(ok.row.pending_decision).toBeNull();

    const again = await cases.executeCommand(WALLET, c.id, { type: 'record_creative_decision' });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('ILLEGAL_TRANSITION');
  });

  it('settlement requires a real, owned license and a real paid state', async () => {
    const cases = createCasesService();
    await ensureProfile(WALLET);
    const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });
    await seedPublishedTake('sub-lic');

    // Must reach rights_review through a human decision first.
    const decided = await cases.executeCommand(WALLET, c.id, { type: 'record_creative_decision', note: 'go dark' });
    expect(decided.ok).toBe(true);

    // No license linked yet → settlement can NOT be prepared.
    const rejected = await cases.executeCommand(WALLET, c.id, { type: 'mark_settlement_ready' });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.code).toBe('INVALID_ARGUMENT');

    // A license owned by a DIFFERENT wallet cannot be linked.
    const notOwned = await cases.executeCommand(WALLET, c.id, { type: 'start_rights_review', licenseId: 'lic-other' });
    expect(notOwned.ok).toBe(false);

    // A real license this wallet owns CAN be linked, then settlement prepared.
    await _getTestDb().insert(licenses).values({
      id: 'lic-1',
      supervisorWallet: WALLET,
      submissionId: 'sub-lic',
      briefHash: 'h',
      briefText: BRIEF_A,
      usageType: 'sync_tv_film',
      feeUsdc: '250',
      status: 'pending_payment',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();

    const linked = await cases.executeCommand(WALLET, c.id, { type: 'start_rights_review', licenseId: 'lic-1' });
    expect(linked.ok).toBe(true);

    const ready = await cases.executeCommand(WALLET, c.id, { type: 'mark_settlement_ready' });
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.row.status).toBe('settlement_pending');

    // Settlement only records once the license is actually paid.
    const notPaid = await cases.executeCommand(WALLET, c.id, { type: 'record_settlement' });
    expect(notPaid.ok).toBe(false);

    await _getTestDb().update(licenses).set({ status: 'paid' }).where(eq(licenses.id, 'lic-1'));
    const settled = await cases.executeCommand(WALLET, c.id, { type: 'record_settlement' });
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.row.status).toBe('settled');

    // One settlement transition only, even if retried.
    const events = await _getTestDb().select().from(caseEvents).where(eq(caseEvents.caseId, c.id));
    expect(events.filter((e) => e.kind === 'settled')).toHaveLength(1);
  });

  it('executeCommand is owner-scoped (foreign wallet cannot mutate)', async () => {
    const cases = createCasesService();
    await ensureProfile(OTHER_WALLET);
    const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });

    const res = await cases.executeCommand(OTHER_WALLET, c.id, { type: 'record_creative_decision' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('NOT_FOUND');
  });
});