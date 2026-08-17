// MODULAR: supervisor dashboard service tests.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const { getTestDb: _getTestDb, initTestDb: _initTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi: _vi } = await import('vitest');
_vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createSupervisorDashboardService } = await import('../../src/services/supervisor');
const { submissions, publishedVersions } = await import('../../src/lib/schema');
const { matchBriefHash } = await import('../../src/lib/match-benchmark');

const WALLET = '0x' + 'a'.repeat(40);

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
});

function makeService() {
  return createSupervisorDashboardService();
}

async function seedPublishedVersion(subId: string, catalogSource: 'demo' | 'live' = 'live') {
  const db = _getTestDb();
  await db.insert(submissions).values({
    id: subId,
    artistWallet: WALLET,
    audioPath: 'audio/' + subId,
    audioSizeBytes: 1024,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    title: 'Seed ' + subId,
    artistName: 'Seeder',
    versionType: 'demo',
    status: 'published',
    paymentTxHash: '0x' + 'a'.repeat(64),
    paymentVerifiedAt: new Date(),
  }).onConflictDoNothing();
  await db.insert(publishedVersions).values({
    submissionId: subId,
    artistWallet: WALLET,
    title: 'Seed ' + subId,
    artistName: 'Seeder',
    versionType: 'demo',
    audioPath: 'audio/' + subId,
    ratingCount: 3,
    catalogSource,
    publishedAt: new Date(),
  }).onConflictDoNothing();
}

describe('supervisor service', () => {
  it('upserts and retrieves a profile', async () => {
    const service = makeService();
    const profile = await service.upsertProfile({
      wallet: WALLET,
      email: 'sup@example.com',
      name: 'Sync Supervisor',
      company: 'Sync House',
      role: 'sync_house',
    });
    expect(profile.wallet).toBe(WALLET.toLowerCase());
    expect(profile.email).toBe('sup@example.com');
    expect(profile.role).toBe('sync_house');

    const got = await service.getProfile(WALLET);
    expect(got).not.toBeNull();
    expect(got!.name).toBe('Sync Supervisor');
  });

  it('auto-creates a profile when saving a brief', async () => {
    const service = makeService();
    const brief = await service.saveBrief({
      supervisorWallet: WALLET,
      briefText: 'tense car chase, no vocals',
      filters: { genre: 'orchestral' },
    });
    expect(brief.brief_text).toBe('tense car chase, no vocals');
    expect(brief.supervisor_wallet).toBe(WALLET.toLowerCase());

    const profile = await service.getProfile(WALLET);
    expect(profile).not.toBeNull();
  });

  it('lists saved briefs in descending creation order', async () => {
    const service = makeService();
    await service.saveBrief({ supervisorWallet: WALLET, briefText: 'first brief' });
    await service.saveBrief({ supervisorWallet: WALLET, briefText: 'second brief' });
    const rows = await service.listSavedBriefs(WALLET, { limit: 10 });
    expect(rows.length).toBe(2);
    expect(rows[0].brief_text).toBe('second brief');
  });

  it('deletes only its own saved briefs', async () => {
    const service = makeService();
    const brief = await service.saveBrief({ supervisorWallet: WALLET, briefText: 'to delete' });
    const otherWallet = '0x' + 'b'.repeat(40);
    const deletedByOther = await service.deleteSavedBrief(brief.id, otherWallet);
    expect(deletedByOther.ok).toBe(false);

    const deletedByOwner = await service.deleteSavedBrief(brief.id, WALLET);
    expect(deletedByOwner.ok).toBe(true);
    expect((await service.listSavedBriefs(WALLET)).length).toBe(0);
  });

  it('logs recent searches', async () => {
    const service = makeService();
    const row = await service.logSearch({
      supervisorWallet: WALLET,
      briefText: 'romantic comedy montage',
      resultsCount: 12,
    });
    expect(row.results_count).toBe(12);
    const searches = await service.listRecentSearches(WALLET, { limit: 10 });
    expect(searches.length).toBe(1);
  });

  it('tracks licensing interests', async () => {
    const service = makeService();
    await seedPublishedVersion('sub-interest-1');
    const interest = await service.addInterest({
      supervisorWallet: WALLET,
      submissionId: 'sub-interest-1',
      status: 'interested',
      notes: 'perfect for trailer',
    });
    expect(interest.submission_id).toBe('sub-interest-1');
    expect(interest.status).toBe('interested');

    const updated = await service.updateInterest(interest.id, WALLET, { status: 'contacted' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('contacted');

    const interests = await service.listInterests(WALLET, { limit: 10 });
    expect(interests.length).toBe(1);
  });

  it('records match feedback and computes a benchmark', async () => {
    const service = makeService();
    await seedPublishedVersion('sub-fb-1');
    await seedPublishedVersion('sub-fb-2');

    const hash = matchBriefHash('car chase');
    await service.recordMatchFeedback({
      supervisorWallet: WALLET,
      briefHash: hash,
      briefText: 'car chase',
      submissionId: 'sub-fb-1',
      fitScoreShown: 0.9,
      rankShown: 1,
      verdict: 'good_fit',
    });
    await service.recordMatchFeedback({
      supervisorWallet: WALLET,
      briefHash: hash,
      briefText: 'car chase',
      submissionId: 'sub-fb-2',
      fitScoreShown: 0.3,
      rankShown: 2,
      verdict: 'wrong_fit',
    });

    const report = await service.benchmarkMatchFeedback();
    expect(report.queryCount).toBe(1);
    expect(report.judgmentCount).toBe(2);
    expect(report.goodFits).toBe(1);
    expect(report.mrr).toBe(1); // best take already #1
    expect(report.rankOfFirstGood).toBe(1);
    expect(report.precisionAt[3]).toBe(0.5);
    expect(report.scoreDiscrimination.goodAvgFit).toBeCloseTo(0.9, 6);

    // Upsert: re-labeling a take does not create a duplicate row.
    await service.recordMatchFeedback({
      supervisorWallet: WALLET,
      briefHash: hash,
      briefText: 'car chase',
      submissionId: 'sub-fb-1',
      fitScoreShown: 0.95,
      rankShown: 1,
      verdict: 'wrong_fit',
    });
    const mine = await service.listMatchFeedback(WALLET);
    expect(mine.length).toBe(2);
    const after = await service.benchmarkMatchFeedback();
    expect(after.judgmentCount).toBe(2);
    expect(after.goodFits).toBe(0); // both now wrong_fit
    expect(after.mrr).toBe(0);
  });

  it('keeps demo feedback out of the live benchmark and blocks demo licensing', async () => {
    const service = makeService();
    await seedPublishedVersion('sub-demo-1', 'demo');

    const feedback = await service.recordMatchFeedback({
      supervisorWallet: WALLET,
      briefHash: matchBriefHash('car chase'),
      briefText: 'car chase',
      submissionId: 'sub-demo-1',
      fitScoreShown: 0.9,
      rankShown: 1,
      verdict: 'good_fit',
    });
    expect(feedback.catalog_source).toBe('demo');
    expect((await service.benchmarkMatchFeedback()).judgmentCount).toBe(0);

    const license = await service.createLicense({
      supervisorWallet: WALLET,
      submissionId: 'sub-demo-1',
      briefHash: matchBriefHash('car chase'),
      briefText: 'car chase',
      usageType: 'sync_ad',
    });
    expect(license).toBeNull();
  });

  it('creates and settles a license for a matched take', async () => {
    const service = makeService();
    await seedPublishedVersion('sub-lic-1');

    const license = await service.createLicense({
      supervisorWallet: WALLET,
      submissionId: 'sub-lic-1',
      briefHash: matchBriefHash('car chase'),
      briefText: 'car chase',
      usageType: 'sync_tv_film',
    });
    expect(license).not.toBeNull();
    expect(license!.status).toBe('pending_payment');
    expect(license!.fee_usdc).toBe('1.00');
    expect(license!.submission_id).toBe('sub-lic-1');
    expect(license!.title).toBe('Seed sub-lic-1');
    expect(license!.artist_wallet).toBe(WALLET.toLowerCase());

    // Claim before external settlement. A second claimant, a stale lease, and
    // an unowned release must not reopen or complete the same license.
    const claim = await service.beginLicenseSettlement(license!.id, WALLET);
    expect(claim).not.toBeNull();
    expect(await service.beginLicenseSettlement(license!.id, WALLET)).toBeNull();
    expect(await service.markLicensePaid(license!.id, WALLET, 'wrong-lease', {
      txHash: '0x' + 'b'.repeat(64),
      mock: true,
    })).toBeNull();
    await service.releaseLicenseSettlement(license!.id, WALLET, 'wrong-lease');
    expect((await service.getLicense(license!.id, WALLET))!.status).toBe('settling');

    // Only the owning lease may record the mocked on-chain + ERC-8183 receipt.
    const paid = await service.markLicensePaid(license!.id, WALLET, claim!.leaseId, {
      txHash: '0x' + 'b'.repeat(64),
      mock: true,
      jobId: '42',
      jobStatus: 'Completed',
      deliverableHash: '0x' + 'c'.repeat(64),
      jobCompleteTxHash: '0x' + 'd'.repeat(64),
    });
    expect(paid).not.toBeNull();
    expect(paid!.status).toBe('paid');
    expect(paid!.payment_tx_hash).toBe('0x' + 'b'.repeat(64));
    expect(paid!.payment_mock).toBe(true);
    expect(paid!.job_id).toBe('42');
    expect(paid!.job_status).toBe('Completed');
    expect(paid!.settled_at).not.toBeNull();

    const got = await service.getLicense(license!.id, WALLET);
    expect(got!.status).toBe('paid');
    expect((await service.listLicenses(WALLET)).length).toBe(1);
    expect(await service.countLicenses(WALLET)).toBe(1);
  });

  it('returns null when licensing a take that is not published', async () => {
    const service = makeService();
    const license = await service.createLicense({
      supervisorWallet: WALLET,
      submissionId: 'does-not-exist',
      briefHash: matchBriefHash('car chase'),
      briefText: 'car chase',
      usageType: 'sync_ad',
    });
    expect(license).toBeNull();
  });
});
