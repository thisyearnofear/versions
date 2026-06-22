// MODULAR: taste-graph aggregator tests. Pure functions; no DB.

import { describe, it, expect } from 'vitest';
import {
  mean,
  pluralityWithTiebreak,
  unionMoodTags,
  aggregateRatings,
} from '../../src/services/taste-graph';

describe('mean', () => {
  it('returns 0 for empty input', () => {
    expect(mean([])).toBe(0);
    expect(mean(null as unknown as number[])).toBe(0);
  });

  it('returns arithmetic mean', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(mean([10, 20])).toBe(15);
  });
});

describe('pluralityWithTiebreak', () => {
  it('picks the most common value', () => {
    expect(pluralityWithTiebreak(['higher', 'higher', 'lower', 'same'], ['lower', 'same', 'higher'])).toBe('higher');
  });

  it('alphabetical tie-break is deterministic', () => {
    expect(pluralityWithTiebreak(['same', 'same', 'higher', 'higher'], ['lower', 'same', 'higher'])).toBe('higher');
  });

  it('returns fallback for empty input', () => {
    // sorted: ['higher','lower','same'] → first = 'higher'
    expect(pluralityWithTiebreak([], ['lower', 'same', 'higher'])).toBe('higher');
  });
});

describe('unionMoodTags', () => {
  it('union, sorted, deduped (case-sensitive)', () => {
    const ratings = [
      { mood_tags: ['Bluesy', 'Raw'] },
      { mood_tags: ['Euphoric', 'Bluesy'] },
      { mood_tags: [] },
      { mood_tags: ['raw'] },
    ];
    expect(unionMoodTags(ratings)).toEqual(['Bluesy', 'Euphoric', 'Raw', 'raw']);
  });

  it('tolerates JSON-stringified arrays', () => {
    const ratings = [
      { mood_tags: JSON.stringify(['a', 'b']) },
      { mood_tags: JSON.stringify(['b', 'c']) },
    ];
    expect(unionMoodTags(ratings)).toEqual(['a', 'b', 'c']);
  });

  it('skips garbage', () => {
    const ratings = [
      { mood_tags: 'not-json' },
      { mood_tags: 42 },
      { mood_tags: null },
      { mood_tags: ['ok'] },
    ];
    expect(unionMoodTags(ratings)).toEqual(['ok']);
  });
});

describe('aggregateRatings', () => {
  it('empty ratings returns nulls + count 0', () => {
    const out = aggregateRatings([]);
    expect(out.rating_count).toBe(0);
    expect(out.avg_solo_intensity).toBeNull();
    expect(out.energy_consensus).toBeNull();
    expect(out.aggregated_mood_tags).toEqual([]);
  });

  it('full path with mixed ratings', () => {
    const ratings = [
      { solo_intensity: 7, vocal_quality: 8, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: ['Bluesy', 'Raw'] },
      { solo_intensity: 9, vocal_quality: 6, energy_vs_studio: 'higher', tempo_feel: 'locked', mood_tags: ['Euphoric'] },
      { solo_intensity: 5, vocal_quality: 7, energy_vs_studio: 'same', tempo_feel: 'rushing', mood_tags: ['Raw'] },
    ];
    const out = aggregateRatings(ratings);
    expect(out.rating_count).toBe(3);
    expect(out.avg_solo_intensity).toBe((7 + 9 + 5) / 3);
    expect(out.avg_vocal_quality).toBe((8 + 6 + 7) / 3);
    expect(out.energy_consensus).toBe('higher');
    expect(out.tempo_consensus).toBe('rushing');
    expect(out.aggregated_mood_tags).toEqual(['Bluesy', 'Euphoric', 'Raw']);
  });

  it('tie-break goes alphabetically', () => {
    const ratings = [
      { solo_intensity: 1, vocal_quality: 1, energy_vs_studio: 'lower', tempo_feel: 'dragging', mood_tags: [] },
      { solo_intensity: 1, vocal_quality: 1, energy_vs_studio: 'same', tempo_feel: 'locked', mood_tags: [] },
      { solo_intensity: 1, vocal_quality: 1, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: [] },
    ];
    const out = aggregateRatings(ratings);
    expect(out.energy_consensus).toBe('higher');
    expect(out.tempo_consensus).toBe('dragging');
  });
});
