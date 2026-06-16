// MODULAR: pure aggregation. No DB writes; called from curation.publishSubmission.
// DRY: every consumer of taste-graph data goes through this module.
// PERFORMANT: O(n) in number of ratings; runs once per publish, not per read.

'use strict';

const VALID_ENERGY = ['higher', 'lower', 'same'];
const VALID_TEMPO = ['dragging', 'locked', 'rushing'];

/** Arithmetic mean. Returns 0 for an empty input. */
function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((a, v) => a + v, 0);
  return sum / values.length;
}

/**
 * Plurality with deterministic alphabetical tie-break.
 * Tally wins go to the value that appears most often; ties go to the value
 * that sorts first alphabetically. The set of valid options is required so
 * we can short-circuit to a known value if a tally somehow has no entries.
 */
function pluralityWithTiebreak(values, validOptions) {
  const fallback = [...validOptions].sort()[0];
  if (!Array.isArray(values) || values.length === 0) return fallback;
  const counts = new Map();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let bestValue = fallback;
  let bestCount = -1;
  // Tie-break: walk validOptions in lex order; the first one whose count
  // equals the max wins. This keeps the result deterministic regardless
  // of Map iteration order.
  const maxCount = Math.max(...counts.values());
  for (const opt of [...validOptions].sort()) {
    if ((counts.get(opt) || 0) === maxCount) {
      bestValue = opt;
      break;
    }
  }
  return bestValue;
}

/** Union of all mood_tags arrays, sorted, deduped. */
function unionMoodTags(ratings) {
  const set = new Set();
  for (const r of ratings) {
    let tags = r.mood_tags;
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch (_) { tags = []; }
    }
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      if (typeof t === 'string' && t.trim()) set.add(t.trim());
    }
  }
  return [...set].sort();
}

/**
 * Aggregate a submission's ratings into a published_versions row.
 * Pure function — no DB I/O. Caller (curation.publishSubmission) wraps the
 * read + write in a transaction.
 */
function aggregateRatings(ratings) {
  const ratingCount = ratings.length;
  if (ratingCount === 0) {
    return {
      avg_solo_intensity: null,
      avg_vocal_quality: null,
      energy_consensus: null,
      tempo_consensus: null,
      aggregated_mood_tags: JSON.stringify([]),
      rating_count: 0
    };
  }

  const soloValues = ratings.map((r) => r.solo_intensity);
  const vocalValues = ratings.map((r) => r.vocal_quality);
  const energyValues = ratings.map((r) => r.energy_vs_studio);
  const tempoValues = ratings.map((r) => r.tempo_feel);

  return {
    avg_solo_intensity: mean(soloValues),
    avg_vocal_quality: mean(vocalValues),
    energy_consensus: pluralityWithTiebreak(energyValues, VALID_ENERGY),
    tempo_consensus: pluralityWithTiebreak(tempoValues, VALID_TEMPO),
    aggregated_mood_tags: JSON.stringify(unionMoodTags(ratings)),
    rating_count: ratingCount
  };
}

module.exports = {
  aggregateRatings,
  mean,
  pluralityWithTiebreak,
  unionMoodTags,
  VALID_ENERGY,
  VALID_TEMPO
};
