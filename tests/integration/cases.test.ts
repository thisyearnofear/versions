// MODULAR: Integration tests for the Placement Case foundation. Covers
// DB-backed idempotency, explicit-case shortlists, ownership, server-owned
// decisions, and lifecycle projection from authoritative license records.

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

async function seedLicense(input: { id: string; submissionId: string; briefText: string; status?: 'pending_payment' | 'settling' | 'paid' }) {
  await _getTestDb().insert(licenses).values({
    id: input.id,
    supervisorWallet: WALLET,
    submissionId: input.submissionId,
    briefHash: 'h-' + input.id,
    briefText: input.briefText,
    usageType: 'sync_tv_film',
    feeUsdc: '250',
    status: input.status ?? 'pending_payment',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('placement case foundation', () => {
  it('opens one active case for concurrent searches of the same brief', async () => {
    await ensureProfile(WALLET);
    const cases = createCasesService();

    const rows = await Promise.all(
      Array.from({ length: 4 }, () => cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 })),
    );

    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    const events = await _getTestDb().select().from(caseEvents).where(eq(caseEvents.caseId, rows[0].id));
    expect(events.filter((event) => event.kind === 'case_opened')).toHaveLength(1);
  });

  it('creates distinct cases for distinct briefs', async () => {
    const cases = createCasesService();
    const a = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 10 });
    const b = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_B, rankedCount: 8 });
    expect(a.id).not.toBe(b.id);
  });

  it('shortlists against the explicit case without cross-attaching', async () => {
    const cases = createCasesService();
    const a = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 10 });
    const b = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_B, rankedCount: 8 });
    await seedPublishedTake('sub-a');

    await cases.addShortlist({ supervisorWallet: WALLET, caseId: a.id, submissionId: 'sub-a', fitScore: 0.9, rank: 1 });

    const aRow = await cases.getCase(WALLET, a.id);
    const bRow = await cases.getCase(WALLET, b.id);
    expect(aRow!.case.evidence.shortlistSubmissionIds).toContain('sub-a');
    expect(bRow!.case.evidence.shortlistSubmissionIds ?? []).not.toContain('sub-a');
    expect(aRow!.case.evidence.shortlisted?.[0]?.fitScore).toBe(0.9);
  });

  it('rejects a shortlist mutation by another supervisor', async () => {
    const cases = createCasesService();
    await ensureProfile(OTHER_WALLET);
    const mine = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 5 });
    await seedPublishedTake('sub-f');

    const result = await cases.addShortlist({ supervisorWallet: OTHER_WALLET, caseId: mine.id, submissionId: 'sub-f' });
    expect(result).toBeNull();
    const mineRow = await cases.getCase(WALLET, mine.id);
    expect(mineRow!.case.evidence.shortlistSubmissionIds ?? []).toHaveLength(0);
  });

  it('allows only the pending creative decision to be recorded by a client', async () => {
    const cases = createCasesService();
    const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });

    const recorded = await cases.executeCommand(WALLET, c.id, { type: 'record_creative_decision', note: 'go dark' });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.row.status).toBe('rights_review');
    expect(recorded.row.pending_decision).toBeNull();

    const repeated = await cases.executeCommand(WALLET, c.id, { type: 'record_creative_decision' });
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.code).toBe('ILLEGAL_TRANSITION');
  });

  it('rejects owned licenses unless both the case brief and shortlist match', async () => {
    const cases = createCasesService();
    const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });
    await seedPublishedTake('sub-shortlisted');
    await seedPublishedTake('sub-unrelated');
    await cases.addShortlist({ supervisorWallet: WALLET, caseId: c.id, submissionId: 'sub-shortlisted', fitScore: 0.8, rank: 1 });

    await seedLicense({ id: 'lic-wrong-submission', submissionId: 'sub-unrelated', briefText: BRIEF_A });
    await seedLicense({ id: 'lic-wrong-brief', submissionId: 'sub-shortlisted', briefText: BRIEF_B });

    expect(await cases.linkLicenseForOutcome(WALLET, { licenseId: 'lic-wrong-submission' })).toBeNull();
    expect(await cases.linkLicenseForOutcome(WALLET, { licenseId: 'lic-wrong-brief' })).toBeNull();

    const unchanged = await cases.getCase(WALLET, c.id);
    expect(unchanged!.case.license_id).toBeNull();
    expect(unchanged!.case.status).toBe('open');
  });

  it('derives lifecycle state from a compatible license even if an earlier link write failed', async () => {
    const cases = createCasesService();
    const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });
    await seedPublishedTake('sub-repair');
    await cases.addShortlist({ supervisorWallet: WALLET, caseId: c.id, submissionId: 'sub-repair', fitScore: 0.8, rank: 1 });
    await seedLicense({ id: 'lic-repair', submissionId: 'sub-repair', briefText: BRIEF_A, status: 'settling' });

    const settling = await cases.getCase(WALLET, c.id);
    expect(settling!.case.license_id).toBe('lic-repair');
    expect(settling!.case.pending_decision).toBeNull();
    expect(settling!.case.status).toBe('settlement_pending');
    expect(settling!.case.agent_plan.find((step) => step.key === 'rights')?.done).toBe(true);
    expect(settling!.case.agent_plan.find((step) => step.key === 'settle')?.current).toBe(true);

    await _getTestDb().update(licenses).set({ status: 'paid' }).where(eq(licenses.id, 'lic-repair'));
    const settled = await cases.getCase(WALLET, c.id);
    expect(settled!.case.status).toBe('settled');
    expect(settled!.case.agent_plan.find((step) => step.key === 'settle')?.done).toBe(true);
  });

  it('links a compatible license atomically and clears the stale decision projection', async () => {
    const cases = createCasesService();
    const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });
    await seedPublishedTake('sub-link');
    await cases.addShortlist({ supervisorWallet: WALLET, caseId: c.id, submissionId: 'sub-link', fitScore: 0.8, rank: 1 });
    await seedLicense({ id: 'lic-link', submissionId: 'sub-link', briefText: BRIEF_A });

    const linked = await cases.linkLicenseForOutcome(WALLET, { licenseId: 'lic-link' });
    expect(linked?.license_id).toBe('lic-link');
    expect(linked?.status).toBe('rights_review');
    expect(linked?.pending_decision).toBeNull();

    const events = await _getTestDb().select().from(caseEvents).where(eq(caseEvents.caseId, c.id));
    expect(events.filter((event) => event.kind === 'rights_review')).toHaveLength(1);
  });

  it('scopes commands to the owning supervisor', async () => {
    const cases = createCasesService();
    await ensureProfile(OTHER_WALLET);
    const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });

    const result = await cases.executeCommand(OTHER_WALLET, c.id, { type: 'record_creative_decision' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});



describe('placement case terminal reconciliation', () => {
  it('persists a paid outcome as terminal so a renewed same-brief case can open', async () => {
    const cases = createCasesService();
    const original = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });
    await seedPublishedTake('sub-terminal');
    await cases.addShortlist({ supervisorWallet: WALLET, caseId: original.id, submissionId: 'sub-terminal', fitScore: 0.9, rank: 1 });
    await seedLicense({ id: 'lic-terminal', submissionId: 'sub-terminal', briefText: BRIEF_A, status: 'paid' });

    await expect(cases.reconcileLicenseOutcome(WALLET, 'lic-terminal')).resolves.toMatchObject({
      id: original.id,
      status: 'settled',
    });

    const renewed = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 12 });
    expect(renewed.id).not.toBe(original.id);
    expect(renewed.status).toBe('open');

    const events = await _getTestDb().select().from(caseEvents).where(eq(caseEvents.caseId, original.id));
    expect(events.filter((event) => event.kind === 'settled')).toHaveLength(1);
  });
});



  it('does not let a later paid license replace an already linked case license', async () => {
    const cases = createCasesService();
    const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });
    await seedPublishedTake('sub-linked-first');
    await seedPublishedTake('sub-linked-second');
    await cases.addShortlist({ supervisorWallet: WALLET, caseId: c.id, submissionId: 'sub-linked-first', fitScore: 0.9, rank: 1 });
    await cases.addShortlist({ supervisorWallet: WALLET, caseId: c.id, submissionId: 'sub-linked-second', fitScore: 0.8, rank: 2 });
    await seedLicense({ id: 'lic-first', submissionId: 'sub-linked-first', briefText: BRIEF_A });
    await seedLicense({ id: 'lic-second-paid', submissionId: 'sub-linked-second', briefText: BRIEF_A, status: 'paid' });

    await cases.linkLicenseForOutcome(WALLET, { licenseId: 'lic-first' });
    await expect(cases.reconcileLicenseOutcome(WALLET, 'lic-second-paid')).resolves.toBeNull();

    const unchanged = await cases.getCase(WALLET, c.id);
    expect(unchanged!.case.license_id).toBe('lic-first');
    expect(unchanged!.case.status).toBe('rights_review');
  });



it('reconciles concurrent paid-license retries exactly once', async () => {
  const cases = createCasesService();
  const c = await cases.openCase({ supervisorWallet: WALLET, briefText: BRIEF_A, rankedCount: 42 });
  await seedPublishedTake('sub-concurrent-paid');
  await cases.addShortlist({ supervisorWallet: WALLET, caseId: c.id, submissionId: 'sub-concurrent-paid', fitScore: 0.9, rank: 1 });
  await seedLicense({ id: 'lic-concurrent-paid', submissionId: 'sub-concurrent-paid', briefText: BRIEF_A, status: 'paid' });

  await Promise.all(
    Array.from({ length: 3 }, () => cases.reconcileLicenseOutcome(WALLET, 'lic-concurrent-paid')),
  );

  const events = await _getTestDb().select().from(caseEvents).where(eq(caseEvents.caseId, c.id));
  expect(events.filter((event) => event.kind === 'settled')).toHaveLength(1);
  const settled = await cases.getCase(WALLET, c.id);
  expect(settled!.case.status).toBe('settled');
});