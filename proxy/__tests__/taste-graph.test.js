// MODULAR: pure-fn tests for the taste-graph aggregator. No DB.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  mean,
  pluralityWithTiebreak,
  unionMoodTags,
  aggregateRatings
} = require('../services/taste-graph');

// ---------- mean ----------

test('mean: returns 0 for empty input', () => {
  assert.equal(mean([]), 0);
  assert.equal(mean(null), 0);
});

test('mean: returns arithmetic mean', () => {
  assert.equal(mean([1, 2, 3, 4, 5]), 3);
  assert.equal(mean([10, 20]), 15);
});

// ---------- pluralityWithTiebreak ----------

test('pluralityWithTiebreak: picks the most common value', () => {
  const v = ['higher', 'higher', 'lower', 'same'];
  assert.equal(pluralityWithTiebreak(v, ['lower', 'same', 'higher']), 'higher');
});

test('pluralityWithTiebreak: alphabetical tie-break is deterministic', () => {
  // 2 each — alphabetical winner is "higher"
  const v = ['same', 'same', 'higher', 'higher'];
  assert.equal(pluralityWithTiebreak(v, ['lower', 'same', 'higher']), 'higher');
});

test('pluralityWithTiebreak: different valid set, same input, same answer', () => {
  // Same tie; the answer does not depend on the order of validOptions.
  const v = ['dragging', 'dragging', 'rushing', 'rushing'];
  assert.equal(
    pluralityWithTiebreak(v, ['dragging', 'locked', 'rushing']),
    'dragging'
  );
  assert.equal(
    pluralityWithTiebreak(v, ['rushing', 'locked', 'dragging']),
    'dragging'
  );
});

test('pluralityWithTiebreak: returns fallback for empty input', () => {
  assert.equal(pluralityWithTiebreak([], ['lower', 'same', 'higher']), 'higher'); // sorted, first = "higher"
});

// ---------- unionMoodTags ----------

test('unionMoodTags: union, sorted, deduped', () => {
  const ratings = [
    { mood_tags: ['Bluesy', 'Raw'] },
    { mood_tags: ['Euphoric', 'Bluesy'] },
    { mood_tags: [] },
    { mood_tags: ['raw'] }  // case-sensitive — not deduped against 'Raw'
  ];
  const out = unionMoodTags(ratings);
  assert.deepEqual(out, ['Bluesy', 'Euphoric', 'Raw', 'raw']);
});

test('unionMoodTags: tolerates JSON-stringified arrays', () => {
  const ratings = [
    { mood_tags: JSON.stringify(['a', 'b']) },
    { mood_tags: JSON.stringify(['b', 'c']) }
  ];
  assert.deepEqual(unionMoodTags(ratings), ['a', 'b', 'c']);
});

test('unionMoodTags: skips garbage', () => {
  const ratings = [
    { mood_tags: 'not-json' },
    { mood_tags: 42 },
    { mood_tags: null },
    { mood_tags: ['ok'] }
  ];
  assert.deepEqual(unionMoodTags(ratings), ['ok']);
});

// ---------- aggregateRatings ----------

test('aggregateRatings: empty ratings returns nulls + count 0', () => {
  const out = aggregateRatings([]);
  assert.equal(out.rating_count, 0);
  assert.equal(out.avg_solo_intensity, null);
  assert.equal(out.energy_consensus, null);
  assert.equal(out.aggregated_mood_tags, '[]');
});

test('aggregateRatings: full path with mixed ratings', () => {
  const ratings = [
    { solo_intensity: 7, vocal_quality: 8, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: ['Bluesy', 'Raw'] },
    { solo_intensity: 9, vocal_quality: 6, energy_vs_studio: 'higher', tempo_feel: 'locked', mood_tags: ['Euphoric'] },
    { solo_intensity: 5, vocal_quality: 7, energy_vs_studio: 'same',   tempo_feel: 'rushing', mood_tags: ['Raw'] }
  ];
  const out = aggregateRatings(ratings);
  assert.equal(out.rating_count, 3);
  assert.equal(out.avg_solo_intensity, (7 + 9 + 5) / 3);
  assert.equal(out.avg_vocal_quality, (8 + 6 + 7) / 3);
  assert.equal(out.energy_consensus, 'higher');  // 2 of 3
  assert.equal(out.tempo_consensus, 'rushing');  // 2 of 3
  assert.deepEqual(JSON.parse(out.aggregated_mood_tags), ['Bluesy', 'Euphoric', 'Raw']);
});

test('aggregateRatings: tie-break goes alphabetically', () => {
  // 1-1-1 tie on energy: alphabetical winner is "higher"
  const ratings = [
    { solo_intensity: 1, vocal_quality: 1, energy_vs_studio: 'lower', tempo_feel: 'dragging', mood_tags: [] },
    { solo_intensity: 1, vocal_quality: 1, energy_vs_studio: 'same',  tempo_feel: 'locked',   mood_tags: [] },
    { solo_intensity: 1, vocal_quality: 1, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: [] }
  ];
  const out = aggregateRatings(ratings);
  assert.equal(out.energy_consensus, 'higher');
  assert.equal(out.tempo_consensus, 'dragging');
});
