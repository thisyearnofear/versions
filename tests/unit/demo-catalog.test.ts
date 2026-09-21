import { describe, it, expect } from 'vitest';
import { DEMO_CHANNELS, DEMO_LISTINGS, rankDemoListings } from '../../src/lib/demo-catalog';

describe('demo-catalog fallback', () => {
  it('ships music + placement rows across free + paid tiers', () => {
    const kinds = new Set(DEMO_LISTINGS.map((l) => l.kind));
    const tiers = new Set(DEMO_LISTINGS.map((l) => l.tier));
    expect(kinds.has('music')).toBe(true);
    expect(kinds.has('placement')).toBe(true);
    expect(tiers.has('free')).toBe(true);
    expect(tiers.has('paid')).toBe(true);
  });

  it('ranks the study query toward study-tagged tracks', () => {
    const rows = rankDemoListings('lo-fi study calm instrumental', 4);
    expect(rows.length).toBe(4);
    expect(rows[0].tags).toContain('study');
  });

  it('ids are demo-namespaced so they never collide with live rows', () => {
    for (const l of DEMO_LISTINGS) expect(l.id.startsWith('demo-')).toBe(true);
  });

  it('covers every channel vibe with at least one fit', () => {
    for (const c of DEMO_CHANNELS) {
      expect(rankDemoListings(c.query, 4).length).toBeGreaterThan(0);
    }
  });
});
