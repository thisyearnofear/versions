// MODULAR: pure match-benchmark + hash helpers (no DB).

import { describe, it, expect } from 'vitest';
import {
  computeMatchBenchmark,
  matchBriefHash,
  type MatchFeedbackJudgment,
} from '../../src/lib/match-benchmark';

function j(over: Partial<MatchFeedbackJudgment> & { submissionId: string }): MatchFeedbackJudgment {
  return {
    briefHash: over.briefHash ?? 'abcdef12',
    submissionId: over.submissionId,
    fitScoreShown: over.fitScoreShown ?? 0.5,
    rankShown: over.rankShown ?? null,
    verdict: over.verdict ?? 'good_fit',
  };
}

describe('matchBriefHash', () => {
  it('is deterministic and aggregates across whitespace/case', () => {
    expect(matchBriefHash('Car Chase')).toBe(matchBriefHash('  car chase  '));
    expect(matchBriefHash('Car Chase').length).toBe(8);
  });
  it('distinguishes different briefs', () => {
    expect(matchBriefHash('car chase')).not.toBe(matchBriefHash('romantic ballad'));
  });
});

describe('computeMatchBenchmark', () => {
  it('returns nulls when there are no judgments', () => {
    const r = computeMatchBenchmark([]);
    expect(r.queryCount).toBe(0);
    expect(r.judgmentCount).toBe(0);
    expect(r.mrr).toBeNull();
    expect(r.precisionAt[1]).toBeNull();
    expect(r.ndcgAt[3]).toBeNull();
    expect(r.scoreDiscrimination.goodAvgFit).toBeNull();
  });

  it('perfect first-rank good → MRR 1, precision@1 = 1', () => {
    const r = computeMatchBenchmark([
      j({ submissionId: 's0', rankShown: 1, fitScoreShown: 0.9, verdict: 'good_fit' }),
      j({ submissionId: 's1', rankShown: 2, fitScoreShown: 0.4, verdict: 'wrong_fit' }),
    ]);
    expect(r.mrr).toBe(1);
    expect(r.rankOfFirstGood).toBe(1);
    expect(r.precisionAt[1]).toBe(1);
    expect(r.precisionAt[3]).toBe(0.5);
    expect(r.ndcgAt[3]).toBe(1);
    expect(r.goodFraction).toBe(0.5);
  });

  it('good at rank 3 → MRR 1/3, precision@1 = 0', () => {
    const r = computeMatchBenchmark([
      j({ submissionId: 's0', rankShown: 1, verdict: 'wrong_fit' }),
      j({ submissionId: 's1', rankShown: 2, verdict: 'wrong_fit' }),
      j({ submissionId: 's2', rankShown: 3, verdict: 'good_fit' }),
    ]);
    expect(r.mrr).toBeCloseTo(1 / 3, 6);
    expect(r.precisionAt[1]).toBe(0);
    expect(r.precisionAt[3]).toBeCloseTo(1 / 3, 6);
    // nDCG@3: dcg = 0 + 0 + 1/log2(3); idcg = 1
    expect(r.ndcgAt[3]).toBeCloseTo(1 / Math.log2(3), 6);
  });

  it('averages MRR and precision@k across queries', () => {
    const r = computeMatchBenchmark([
      // q1: good at rank 1
      j({ briefHash: 'q1', submissionId: 'a', rankShown: 1, fitScoreShown: 0.9, verdict: 'good_fit' }),
      j({ briefHash: 'q1', submissionId: 'b', rankShown: 2, fitScoreShown: 0.4, verdict: 'wrong_fit' }),
      // q2: first good at rank 4 (three wrong above it)
      j({ briefHash: 'q2', submissionId: 'c', rankShown: 1, fitScoreShown: 0.3, verdict: 'wrong_fit' }),
      j({ briefHash: 'q2', submissionId: 'd', rankShown: 2, fitScoreShown: 0.5, verdict: 'wrong_fit' }),
      j({ briefHash: 'q2', submissionId: 'e', rankShown: 3, fitScoreShown: 0.2, verdict: 'wrong_fit' }),
      j({ briefHash: 'q2', submissionId: 'f', rankShown: 4, fitScoreShown: 0.8, verdict: 'good_fit' }),
    ]);
    expect(r.queryCount).toBe(2);
    expect(r.mrr).toBeCloseTo((1 + 1 / 4) / 2, 6);
    expect(r.precisionAt[1]).toBe(0.5); // q1 1, q2 0
    expect(r.precisionAt[3]).toBe(0.25); // q1 0.5, q2 0
    expect(r.rankOfFirstGood).toBe(2.5);
  });

  it('reports fit-score discrimination (good should score higher than wrong)', () => {
    const r = computeMatchBenchmark([
      j({ submissionId: 'good', fitScoreShown: 0.9, verdict: 'good_fit' }),
      j({ submissionId: 'good2', fitScoreShown: 0.8, verdict: 'good_fit' }),
      j({ submissionId: 'bad', fitScoreShown: 0.3, verdict: 'wrong_fit' }),
      j({ submissionId: 'bad2', fitScoreShown: 0.4, verdict: 'wrong_fit' }),
    ]);
    expect(r.scoreDiscrimination.goodAvgFit).toBeCloseTo(0.85, 6);
    expect(r.scoreDiscrimination.wrongAvgFit).toBeCloseTo(0.35, 6);
    expect(r.scoreDiscrimination.delta).toBeCloseTo(0.5, 6);
  });

  it('excludes rank-null judgments from ranking metrics but includes them in counts', () => {
    const r = computeMatchBenchmark([
      j({ submissionId: 'a', rankShown: 1, verdict: 'wrong_fit' }),
      j({ submissionId: 'b', rankShown: null, verdict: 'good_fit' }), // no rank
    ]);
    expect(r.judgmentCount).toBe(2);
    expect(r.goodFits).toBe(1);
    // only ranked judgments participate in MRR; the good had no rank → 0
    expect(r.mrr).toBe(0);
    expect(r.precisionAt[1]).toBe(0);
  });
});