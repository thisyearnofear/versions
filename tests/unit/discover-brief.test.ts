// MODULAR: route-level tests for /api/v1/discover/brief.
// Per-IP cold bucket strategy: each test sets a UNIQUE x-forwarded-for
// so the module-scoped `inverseSearchLimiter` starts cold. Across the
// four tests, IPs 10.0.0.1 / 10.0.0.2 / 10.0.0.3 / 10.0.0.4 never
// collide. The burst test pushes 61 sequential calls with the same
// IP to overflow max=60.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { NextRequest } = await import('next/server');
const { GET } = await import('../../src/app/api/v1/discover/brief/route');
const { publishedVersions, submissions, placementBriefs } = await import('../../src/lib/schema');
const { describe, it, expect, beforeAll, beforeEach } = await import('vitest');
const { clearCache } = await import('../../src/lib/cache');

// MODULAR: brief→match fixture. Mirrors tests/unit/feed.test.ts's
// seedBriefRow but kept local so this file is self-contained on
// import. Uses Drizzle column-aliasing under the hood.
async function seedBriefRow(
  subId: string,
  title: string,
  brief: {
    sceneTags: string[],
    instruments: string[],
    emotionalArcs: string[],
    syncComparables: Array<{ name: string; why: string }>,
    audienceSummary: string,
  },
) {
  const db = _getTestDb();
  await db.insert(submissions).values({
    id: subId,
    artistWallet: '0x' + subId.replace(/-/g, '').slice(0, 40).padEnd(40, 'a'),
    audioPath: 'audio/' + subId,
    audioSizeBytes: 1024,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    title,
    artistName: 'S',
    versionType: 'demo',
    status: 'published',
    paymentTxHash: '0x' + 'a'.repeat(64),
    paymentVerifiedAt: new Date(),
  }).onConflictDoNothing();
  await db.insert(publishedVersions).values({
    submissionId: subId,
    artistWallet: '0xaaa',
    title,
    artistName: 'S',
    versionType: 'demo',
    audioPath: 'p',
    ratingCount: 3,
    publishedAt: new Date(),
  }).onConflictDoNothing();
  await db.insert(placementBriefs).values({
    id: 'pb-' + subId,
    submissionId: subId,
    agentName: 'market',
    sceneTags: brief.sceneTags,
    instruments: brief.instruments,
    emotionalArcs: brief.emotionalArcs,
    syncComparables: brief.syncComparables,
    audienceSummary: brief.audienceSummary,
    createdAt: new Date(),
  }).onConflictDoNothing();
}

function makeReq(url: string, ip: string): InstanceType<typeof NextRequest> {
  return new NextRequest(url, {
    headers: {
      'x-forwarded-for': ip,
      'x-request-id': 'req-' + ip,
    },
  });
}

beforeAll(async () => {
  await _initTestDb();
});
beforeEach(async () => {
  await _resetTestDb();
  clearCache();
});

describe('discover/brief: bounds', () => {
  it('400 INVALID_BRIEF when brief is below min length (3)', async () => {
    const res = await GET(makeReq('http://x/api/v1/discover/brief?brief=hi', '10.0.0.1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_BRIEF');
    expect(String(body.error.message)).toMatch(/3.*500/);
  });

  it('400 INVALID_BRIEF when brief exceeds max length (500)', async () => {
    const overlong = 'a'.repeat(501);
    const res = await GET(
      makeReq('http://x/api/v1/discover/brief?brief=' + encodeURIComponent(overlong), '10.0.0.2'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_BRIEF');
  });
});

describe('discover/brief: happy path', () => {
  it('200 OK with full wire shape lock', async () => {
    await seedBriefRow('sub-route-1', 'Wire Lock Track', {
      sceneTags: ['car chase', 'highway'],
      instruments: ['guitar_led'],
      emotionalArcs: ['rising tension'],
      syncComparables: [{ name: 'Reference Track', why: 'shares the same urgency' }],
      audienceSummary: 'Action soundtrack supervisors',
    });
    const res = await GET(
      makeReq('http://x/api/v1/discover/brief?brief=car+chase', '10.0.0.3'),
    );
    expect(res.status).toBe(200);
    // MODULAR: lock the response-header surface as part of the wire
    // shape. requestIdFor echoes the inbound x-request-id verbatim,
    // and every response carries application/json. A regression that
    // strips either (e.g. requestIdFor falls back to a fresh UUID
    // when it should preserve the inbound) trips this assertion
    // before a downstream consumer sees the diff.
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('x-request-id')).toBe('req-10.0.0.3');
    const body = await res.json();
    expect(body.success).toBe(true);
    // MODULAR: wire-shape lock. The carryover decision from the alpha PR
    // review — lock the brief→match response shape via toMatchObject so a
    // rename in src/lib/types.ts or src/services/feed.ts trips a test
    // before it trips a downstream consumer.
    expect(body.data).toMatchObject({
      total: expect.any(Number),
      limit: expect.any(Number),
      offset: expect.any(Number),
      rows: expect.any(Array),
    });
    expect(body.data.rows.length).toBe(1);
    expect(body.data.rows[0]).toMatchObject({
      submission_id: 'sub-route-1',
      title: 'Wire Lock Track',
      artist_name: 'S',
      version_type: 'demo',
      audio_path: 'p',
      rating_count: 3,
      fit_score: expect.any(Number),
      why_fits: expect.any(Array),
      brief: {
        scene_tags: expect.arrayContaining(['car chase']),
        instruments: expect.arrayContaining(['guitar_led']),
        emotional_arcs: expect.arrayContaining(['rising tension']),
        sync_comparables: expect.arrayContaining([
          expect.objectContaining({ name: 'Reference Track', why: expect.any(String) }),
        ]),
        audience_summary: expect.any(String),
      },
    });
    expect(typeof body.data.rows[0].published_at).toBe('string');
  });
});

describe('discover/brief: rate limit', () => {
  // MODULAR: burst test — 61 calls with the same IP. The limiter
  // pushes BEFORE the length check, so calls 1–60 succeed (length
  // 1–60 ≤ 60) and the 61st fails (length 61 > 60).
  it('429 RATE_LIMITED on burst with the same IP', async () => {
    const ip = '10.0.0.4';
    const url = 'http://x/api/v1/discover/brief?brief=car';
    // MODULAR: capture every Response so the 61st can serve double
    // duty — it both proves the rate-limit hits AND supplies the
    // envelope body to lock the {error.code:'RATE_LIMITED'} shape.
    // No 62nd call needed; the bucket never gets hit with extra noise.
    const responses: Response[] = [];
    for (let i = 0; i < 61; i++) {
      responses.push(await GET(makeReq(url, ip)));
    }
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBe(60);
    expect(statuses.filter((s) => s === 429).length).toBe(1);
    expect(statuses[60]).toBe(429);
    // Lock the 429 envelope shape from the captured 61st response.
    const burstBody = await responses[60].json();
    expect(burstBody.error.code).toBe('RATE_LIMITED');
  });
});
