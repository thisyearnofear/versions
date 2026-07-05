// MODULAR: pure aggregation. No DB writes; called from curation.publishSubmission
// and agents.tryPublish. DRY: every consumer of taste-graph data goes through
// this module. PERFORMANT: O(n) in number of ratings; runs once per publish,
// not per read.

import type { Energy, Tempo, Valence } from '../lib/types';

const VALID_ENERGY: readonly Energy[] = ['higher', 'lower', 'same'];
const VALID_TEMPO: readonly Tempo[] = ['dragging', 'locked', 'rushing'];

// MODULAR: valence is the 5th radar axis -- derived deterministically
// from the aggregated mood_tags union rather than stored per-rating.
// The keyword sets are deliberately small and case-insensitive;
// unknown tags fall through and contribute zero weight to either side.
const BRIGHT_MOOD_TAGS: ReadonlySet<string> = new Set([
  'euphoric', 'uplifting', 'hopeful', 'warm', 'sunny', 'bright',
  'joyful', 'light', 'optimistic', 'effervescent', 'triumphant',
]);
const DARK_MOOD_TAGS: ReadonlySet<string> = new Set([
  'melancholic', 'sad', 'dark', 'brooding', 'moody', 'noir',
  'gloomy', 'haunting', 'heavy', 'broody', 'somber', 'bleak',
]);

/** Classify the union of mood_tags as bright / neutral / dark.
 *  Returns null when no polarity signal exists so consumers can
 *  distinguish "no data" from "neutral". Ties resolve to neutral. */
export function deriveValence(tags: string[]): Valence | null {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  let bright = 0;
  let dark = 0;
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const lower = tag.trim().toLowerCase();
    if (BRIGHT_MOOD_TAGS.has(lower)) bright++;
    else if (DARK_MOOD_TAGS.has(lower)) dark++;
  }
  if (bright === 0 && dark === 0) return null;
  if (bright > dark) return 'bright';
  if (dark > bright) return 'dark';
  return 'neutral';
}

/** Arithmetic mean. Returns 0 for an empty input. */
export function mean(values: number[]): number {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((a, v) => a + v, 0);
  return sum / values.length;
}

export interface RatingRowLike {
  solo_intensity: number;
  vocal_quality: number;
  energy_vs_studio: string;
  tempo_feel: string;
  mood_tags: unknown;
}

/**
 * Plurality with deterministic alphabetical tie-break.
 * Tally wins go to the value that appears most often; ties go to the value
 * that sorts first alphabetically. The set of valid options is required so
 * we can short-circuit to a known value if a tally somehow has no entries.
 */
export function pluralityWithTiebreak<T extends string>(
  values: string[],
  validOptions: readonly T[],
): T {
  const sorted = [...validOptions].sort();
  const fallback = sorted[0];
  if (!Array.isArray(values) || values.length === 0) return fallback;
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  for (const opt of sorted) {
    if ((counts.get(opt) || 0) === maxCount) {
      return opt as T;
    }
  }
  return fallback;
}

/** Union of all mood_tags arrays, sorted, deduped. */
export function unionMoodTags(ratings: RatingRowLike[]): string[] {
  const set = new Set<string>();
  for (const r of ratings) {
    let tags: unknown = r.mood_tags;
    if (typeof tags === 'string') {
      try {
        tags = JSON.parse(tags);
      } catch {
        tags = [];
      }
    }
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      if (typeof t === 'string' && t.trim()) set.add(t.trim());
    }
  }
  return [...set].sort();
}

export interface AggregatedRatings {
  avg_solo_intensity: number | null;
  avg_vocal_quality: number | null;
  energy_consensus: Energy | null;
  tempo_consensus: Tempo | null;
  valence_consensus: Valence | null;
  aggregated_mood_tags: string[];
  rating_count: number;
}

/**
 * Aggregate a submission's ratings into a published_versions row.
 * Pure function — no DB I/O. Caller (curation.publishSubmission) wraps the
 * read + write in a transaction.
 *
 * valence_consensus is derived from the lexical polarity of the unioned
 * mood_tags (see deriveValence), not collected per-rating. This keeps the
 * 5-axis radar honest without requiring a schema migration for the
 * ratings table -- existing 4-axis data continues to render, and the
 * new axis materialises as soon as ratings carry mood-tags vocabulary.
 */
export function aggregateRatings(ratings: RatingRowLike[]): AggregatedRatings {
  const ratingCount = ratings.length;
  if (ratingCount === 0) {
    return {
      avg_solo_intensity: null,
      avg_vocal_quality: null,
      energy_consensus: null,
      tempo_consensus: null,
      valence_consensus: null,
      aggregated_mood_tags: [],
      rating_count: 0,
    };
  }

  const soloValues = ratings.map((r) => r.solo_intensity);
  const vocalValues = ratings.map((r) => r.vocal_quality);
  const energyValues = ratings.map((r) => r.energy_vs_studio);
  const tempoValues = ratings.map((r) => r.tempo_feel);

  const tags = unionMoodTags(ratings);
  return {
    avg_solo_intensity: mean(soloValues),
    avg_vocal_quality: mean(vocalValues),
    energy_consensus: pluralityWithTiebreak(energyValues, VALID_ENERGY),
    tempo_consensus: pluralityWithTiebreak(tempoValues, VALID_TEMPO),
    valence_consensus: deriveValence(tags),
    aggregated_mood_tags: tags,
    rating_count: ratingCount,
  };
}

export { VALID_ENERGY, VALID_TEMPO };
