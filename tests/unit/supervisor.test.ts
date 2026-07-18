// MODULAR: supervisor dashboard service tests.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const { getTestDb: _getTestDb, initTestDb: _initTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi: _vi } = await import('vitest');
_vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createSupervisorDashboardService } = await import('../../src/services/supervisor');
const { submissions, publishedVersions } = await import('../../src/lib/schema');

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

async function seedPublishedVersion(subId: string) {
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
});
