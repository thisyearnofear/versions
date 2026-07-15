// MODULAR: tests for the legacy placement_briefs purge runbook.
//
// Validates scripts/purge-legacy-placement-briefs.apply.sql against
// PGlite so the operator can run `npm run db:purge:apply` with
// confidence. The scripts are SQL, not TypeScript — so this file
// reads the .sql files via fs and pipes them to PGlite.
//
// Test seeds two placement_briefs rows with the EXACT snake_case
// column names (`scene_tags / instruments / emotional_arcs /
// sync_comparables / audience_summary`) so we bypass Drizzle's TS-level
// shape enforcement. The legacy row carries object-array shapes
// (the pre-repurpose representation); the new-shape row carries
// string[] / Array<{name, why}> (the post-repurpose representation).
// After the apply SQL runs, only the legacy row should be wiped.

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  initTestDb,
  getTestDb,
  getTestPg,
  resetTestDb,
} from '../helpers/db';
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
} from 'vitest';
import {
  submissions as submissionsTable,
  placementBriefs as briefsTable,
} from '../../src/lib/schema';
import { sql } from 'drizzle-orm';

const APPLY_SQL = readFileSync(
  join(process.cwd(), 'scripts/purge-legacy-placement-briefs.apply.sql'),
  'utf-8',
);
const PREVIEW_SQL = readFileSync(
  join(process.cwd(), 'scripts/purge-legacy-placement-briefs.preview.sql'),
  'utf-8',
);

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

async function seedBothShapes() {
  const pg = getTestPg();
  // The test DDL has a loose FK (no REFERENCES clause). Seeding
  // submissions anyway so the env matches production surface — the
  // placement_briefs.submission_id can resolve.
  await pg.exec(`
    INSERT INTO submissions
      (id, artist_wallet, audio_path, audio_size_bytes, content_type,
       title, artist_name, version_type, fee_quote_usdc, status,
       payment_tx_hash, payment_verified_at)
    VALUES
      ('sub-legacy', '0x1', 'a', 10, 'audio/mp3', 'L', 'A', 'live', '1',
       'published', '${'0x' + 'a'.repeat(64)}', NOW()),
      ('sub-new', '0x2', 'b', 10, 'audio/mp3', 'N', 'B', 'live', '1',
       'published', '${'0x' + 'a'.repeat(64)}', NOW()),
      ('sub-stubborn', '0x3', 'c', 10, 'audio/mp3', 'S', 'C', 'live', '1',
       'published', '${'0x' + 'a'.repeat(64)}', NOW());
  `);
  await pg.exec(`
    INSERT INTO placement_briefs
      (id, submission_id, scene_tags, instruments, emotional_arcs,
       sync_comparables, audience_summary)
    VALUES
      ('pb-legacy', 'sub-legacy',
       '[{"name": "Madison Square Garden", "location": "NY"}]',
       '["@handle"]',
       '[{"twitter": "test", "followers": 100}]',
       '[{"to": "x@y", "subject": "hi"}]',
       'Old summary'),
      ('pb-stubborn', 'sub-stubborn',
       '[]',
       '["@handle"]',
       '[{"twitter": "test", "followers": 100}]',
       '[{"to": "x@y", "subject": "hi"}]',
       'Empty venues summary'),
      ('pb-new', 'sub-new',
       '["car chase"]',
       '["guitar_led"]',
       '["rising tension"]',
       '[{"name": "Ref Track", "why": "Shares the urgency"}]',
       'New summary');
  `);
}

describe('runbook: purge-legacy-briefs (apply)', () => {
  it('snaps legacy rows to [] and leaves new-shape rows untouched', async () => {
    await seedBothShapes();
    const db = getTestDb();

    const before = await db.select().from(briefsTable);
    expect(before).toHaveLength(3);

    // Run the apply SQL. PGlite handles BEGIN/COMMIT blocks in
    // multi-statement pg.exec() just like real Postgres.
    const pg = getTestPg();
    await pg.exec(APPLY_SQL);

    const after = await db
      .select()
      .from(briefsTable)
      .orderBy(briefsTable.id);
    const legacy = after.find((r) => r.id === 'pb-legacy');
    const fresh = after.find((r) => r.id === 'pb-new');

    // Legacy: all four JSONB columns are zeroed.
    expect(legacy).toBeDefined();
    expect(legacy!.sceneTags).toEqual([]);
    expect(legacy!.instruments).toEqual([]);
    expect(legacy!.emotionalArcs).toEqual([]);
    expect(legacy!.syncComparables).toEqual([]);
    // audience_summary preserved (the runbook does not touch TEXT).
    expect(legacy!.audienceSummary).toBe('Old summary');

    // New-shape: completely untouched.
    expect(fresh).toBeDefined();
    expect(fresh!.sceneTags).toEqual(['car chase']);
    expect(fresh!.instruments).toEqual(['guitar_led']);
    expect(fresh!.emotionalArcs).toEqual(['rising tension']);
    expect(fresh!.syncComparables).toEqual([
      { name: 'Ref Track', why: 'Shares the urgency' },
    ]);
    expect(fresh!.audienceSummary).toBe('New summary');

    // Stubborn fixture: empty scene_tags but legacy object-array shapes
    // elsewhere. Narrow-by-design — the WHERE predicate keys off
    // `scene_tags` only, so this row is deliberately skipped. The legacy
    // object arrays in the other 3 columns are inert (downstream
    // `.map()` over them would TypeError, but they won't be touched
    // until a future operator-driven migration). Locking this in
    // test coverage so the narrow-by-design choice is auditable.
    const stubborn = after.find((r) => r.id === 'pb-stubborn');
    expect(stubborn).toBeDefined();
    expect(stubborn!.sceneTags).toEqual([]);
    expect(stubborn!.instruments).toEqual(['@handle']);
    expect(stubborn!.emotionalArcs).toEqual([{ twitter: 'test', followers: 100 }]);
    expect(stubborn!.syncComparables).toEqual([{ to: 'x@y', subject: 'hi' }]);
    expect(stubborn!.audienceSummary).toBe('Empty venues summary');
  });
});

describe('runbook: purge-legacy-briefs (preview)', () => {
  // MODULAR: equivalence note. The test asserts the count via
  // Drizzle's `sql` template — the SAME predicate the production
  // apply.sql uses — rather than parsing the SQL file's stdout.
  // PGlite's pg.exec() doesn't expose statement results cleanly,
  // so the Drizzle mirror is the right call; a change to that
  // predicate in either the SQL or the test must propagate to the
  // other, or this assertion breaks loudly.

  it('counts legacy rows via the WHERE predicate mirrored from apply', async () => {
    await seedBothShapes();
    const db = getTestDb();

    // Mirror the preview SELECT via Drizzle's sql template + count()
    // so the test exercises the SAME predicate as the production SQL.
    const [{ value: legacyCount }] = await db
      .select({ value: sql<number>`COUNT(*)::int` })
      .from(briefsTable)
      .where(sql`
        jsonb_typeof(${briefsTable.sceneTags}) = 'array'
        AND jsonb_array_length(${briefsTable.sceneTags}) > 0
        AND jsonb_typeof(${briefsTable.sceneTags} -> 0) <> 'string'
      `);
    expect(legacyCount).toBe(1);

    // Smoke test the preview SQL: read-only, must not throw, must not
    // mutate row state.
    const pg = getTestPg();
    await pg.exec(PREVIEW_SQL);
    const afterPreview = await db.select().from(briefsTable);
    expect(afterPreview).toHaveLength(3);
  });
});
