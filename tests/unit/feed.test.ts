// MODULAR: feed service tests. Reads from published_versions; uses real DB.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { clearCache } = await import('../../src/lib/cache');

const { describe, it, expect, beforeAll, beforeEach } = await import('vitest');
const { eq } = await import('drizzle-orm');
const { createFeedService } = await import('../../src/services/feed');
const { publishedVersions, submissions } = await import('../../src/lib/schema');

async function seedSubmission(subId: string) {
  const db = _getTestDb();
  const existing = await db.select().from(submissions).where(eq(submissions.id, subId)).limit(1);
  if (existing.length > 0) return;
  await db.insert(submissions).values({
    id: subId,
    artistWallet: '0x' + subId.replace(/-/g, '').slice(0, 40).padEnd(40, 'a'),
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
  });
}

beforeAll(async () => {
  await _initTestDb();
});

beforeEach(async () => {
  await _resetTestDb();
  clearCache();
});

describe('feed: listPublished', () => {
  it('empty when nothing is published', async () => {
    const feed = createFeedService();
    const r = await feed.listPublished();
    expect(r.total).toBe(0);
    expect(r.rows).toEqual([]);
  });

  it('returns rows + total count', async () => {
    const db = _getTestDb();
    await seedSubmission('sub-1');
    await db.insert(publishedVersions).values({
      submissionId: 'sub-1',
      artistWallet: '0xaaa',
      title: 'V1',
      artistName: 'A1',
      versionType: 'demo',
      audioPath: 'p',
      ratingCount: 3,
      avgSoloIntensity: 7.0,
      avgVocalQuality: 8.0,
      energyConsensus: 'higher',
      tempoConsensus: 'rushing',
      aggregatedMoodTags: ['Bluesy'],
      publishedAt: new Date(),
    });
    const feed = createFeedService();
    const r = await feed.listPublished();
    expect(r.total).toBe(1);
    expect(r.rows[0].submissionId).toBe('sub-1');
    expect(r.rows[0].energyConsensus).toBe('higher');
  });

  it('pagination with limit + offset', async () => {
    const db = _getTestDb();
    for (let i = 0; i < 3; i++) {
      await seedSubmission('sub-' + i);
      await db.insert(publishedVersions).values({
        submissionId: `sub-${i}`,
        artistWallet: '0xaaa',
        title: `V${i}`,
        artistName: 'A',
        versionType: 'demo',
        audioPath: 'p',
        ratingCount: 1,
        publishedAt: new Date(),
      });
    }
    const feed = createFeedService();
    const page1 = await feed.listPublished({ limit: 2, offset: 0 });
    expect(page1.rows.length).toBe(2);
    const page2 = await feed.listPublished({ limit: 2, offset: 2 });
    expect(page2.rows.length).toBe(1);
    const ids1 = new Set(page1.rows.map((r) => r.submissionId));
    for (const row of page2.rows) expect(ids1.has(row.submissionId)).toBe(false);
  });

  it('limit is capped at MAX_LIMIT (100)', async () => {
    const feed = createFeedService();
    const r = await feed.listPublished({ limit: 9999 });
    expect(r.limit).toBeLessThanOrEqual(100);
  });
});

describe('feed: getVersion', () => {
  it('returns null for unknown id', async () => {
    const feed = createFeedService();
    expect(await feed.getVersion('nope')).toBeNull();
  });

  it('returns version + legs', async () => {
    const db = _getTestDb();
    await seedSubmission('sub-detail');
    await db.insert(publishedVersions).values({
      submissionId: 'sub-detail',
      artistWallet: '0xbbb',
      title: 'Detail',
      artistName: 'A',
      versionType: 'demo',
      audioPath: 'p',
      ratingCount: 3,
      publishedAt: new Date(),
    });
    const feed = createFeedService();
    const r = await feed.getVersion('sub-detail');
    expect(r).not.toBeNull();
    expect(r!.version.title).toBe('Detail');
    expect(r!.settlement_legs).toEqual([]);
  });
});
