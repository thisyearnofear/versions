// MODULAR: guards the beachhead starter ground-truth set so the checked-in
// artifact (fed to `npm run curate`) can't silently drift out of shape —
// e.g. a submissionId that isn't a seeded take, an unparseable verdict, or
// a set with no good/wrong balance.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const RAW = readFileSync(
  new URL('../../scripts/labels/beachhead-starter.labels.json', import.meta.url),
  'utf8',
);
const LABELS = JSON.parse(RAW) as Array<{ brief: string; submissionId: string; verdict: string }>;

// Matches the deterministic seed IDs in scripts/seed-catalog.ts (IDS.*).
const SEED_ID = /^demo-published-\d{4}-\d{4}-\d{12}$/;

describe('beachhead starter labels', () => {
  it('is a non-empty array with well-formed entries', () => {
    expect(LABELS.length).toBeGreaterThanOrEqual(6);
    for (const l of LABELS) {
      expect(l.brief.trim().length).toBeGreaterThanOrEqual(3);
      expect(l.submissionId).toMatch(SEED_ID);
      expect(['good_fit', 'wrong_fit']).toContain(l.verdict);
    }
  });

  it('has both good and wrong fits (a usable baseline)', () => {
    const good = LABELS.filter((l) => l.verdict === 'good_fit').length;
    const wrong = LABELS.filter((l) => l.verdict === 'wrong_fit').length;
    expect(good).toBeGreaterThanOrEqual(1);
    expect(wrong).toBeGreaterThanOrEqual(1);
  });

  it('groups everything under one brief so the benchmark sees a single query', () => {
    const briefs = new Set(LABELS.map((l) => l.brief.trim().toLowerCase()));
    expect(briefs.size).toBe(1);
  });
});