// MODULAR: pure-function tests for the semantic scoring layer.
// These don't need pgvector — they test the cosine similarity
// and hybrid score functions that the feed service uses to
// combine semantic + structured-tag signals.

import { describe, it, expect } from 'vitest';
import { cosineSimilarity, hybridScore } from '../../src/services/feed';

describe('cosineSimilarity', () => {
  it('returns 1 for identical normalized vectors', () => {
    const v = [1, 0, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns ~0.5 for 60-degree vectors', () => {
    // cos(60°) = 0.5. [1,0] and [0.5, sqrt(3)/2] are 60° apart.
    const a = [1, 0];
    const b = [0.5, Math.sqrt(3) / 2];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 3);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });

  it('clamps negative dot products to 0', () => {
    // Opposite vectors would give -1; clamped to 0.
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe('hybridScore', () => {
  it('semantic similarity dominates the score', () => {
    // High semantic (0.9), zero structured → score should be high
    const highSem = hybridScore(0.9, 0, 0, 0);
    // Low semantic (0.1), high structured (10) → score should be lower
    const lowSem = hybridScore(0.1, 10, 0, 0);
    expect(highSem).toBeGreaterThan(lowSem);
  });

  it('structured score contributes as a secondary signal', () => {
    const base = hybridScore(0.5, 0, 0, 0);
    const withStructured = hybridScore(0.5, 10, 0, 0);
    expect(withStructured).toBeGreaterThan(base);
  });

  it('popularity and recency are small tiebreakers', () => {
    const base = hybridScore(0.5, 5, 0, 0);
    const withPopularity = hybridScore(0.5, 5, 1, 0);
    const withRecency = hybridScore(0.5, 5, 0, 1);
    expect(withPopularity).toBeGreaterThan(base);
    expect(withRecency).toBeGreaterThan(base);
  });

  it('a strong semantic match beats a strong structured match', () => {
    // semantic 1.0 (perfect) with no structured tags
    const perfectSem = hybridScore(1.0, 0, 0, 0);
    // semantic 0 with max structured tags (score 20)
    const maxStruct = hybridScore(0, 20, 0, 0);
    expect(perfectSem).toBeGreaterThan(maxStruct);
  });

  it('zero inputs produce zero score', () => {
    expect(hybridScore(0, 0, 0, 0)).toBe(0);
  });
});
