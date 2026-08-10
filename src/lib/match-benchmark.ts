// MODULAR: Pure match-benchmark + ground-truth helpers. No DB, no
// framework imports — unit-testable in isolation (repo convention:
// snap.ts / format.ts / playlist-reasoning-ui.ts).
//
// Ground truth = supervisors labeling a shown (brief → take) match as a
// good fit or wrong fit (see supervisor service's recordMatchFeedback).
// briefHash is a stable hash of the normalized brief so the same query
// text across supervisors + sessions aggregates into one benchmark query.
//
// Metrics are computed on the *judged* portion of what was shown (online
// eval): for each query we order the judged takes by the rank at which
// the supervisor saw them, then compute MRR, precision@k and nDCG@k over
// that window, plus a fit-score discrimination check (are good matches
// scored higher?). rankShown-null judgments still count toward the
// aggregate counts + score discrimination, but are excluded from ranking
// metrics (treated as rank = +Infinity so they never pollute the top-k).

export type MatchFeedbackVerdict = "good_fit" | "wrong_fit";

export interface MatchFeedbackJudgment {
  briefHash: string;
  submissionId: string;
  fitScoreShown: number;
  rankShown: number | null;
  verdict: MatchFeedbackVerdict;
}

export interface MatchBenchmarkReport {
  queryCount: number;
  judgmentCount: number;
  goodFits: number;
  wrongFits: number;
  /** Fraction of labels that were "good", or null when no labels yet. */
  goodFraction: number | null;
  /** Mean reciprocal rank of the first good_fit per query (0 if none). */
  mrr: number | null;
  /** Avg rank of the first good fit among queries that had ≥1 good. */
  rankOfFirstGood: number | null;
  /** precision@k over judged rows with rank ≤ k, averaged across queries. */
  precisionAt: { 1: number | null; 3: number | null; 5: number | null };
  /** nDCG@k (binary relevance) over judged rows with rank ≤ k. */
  ndcgAt: { 3: number | null; 5: number | null };
  /** Is fit_score predictive? avg shown score for good vs wrong labels. */
  scoreDiscrimination: {
    goodAvgFit: number | null;
    wrongAvgFit: number | null;
    delta: number | null;
  };
}

const KS = [1, 3, 5] as const;

// Standard DCG with 2-based log discount (treating rank as 1-indexed).
function dcgAtK(rels: number[]): number {
  if (rels.length === 0) return 0;
  let dcg = rels[0];
  for (let i = 1; i < rels.length; i++) dcg += rels[i] / Math.log2(i + 1);
  return dcg;
}

// Deterministic 32-bit FNV-1a of the normalized (trimmed, lowercased)
// brief text, hex-encoded. Stable across sessions so the same query text
// aggregates into one benchmark query regardless of who/what ran it.
export function matchBriefHash(briefText: string): string {
  const s = briefText.trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function computeMatchBenchmark(judgments: MatchFeedbackJudgment[]): MatchBenchmarkReport {
  const byQuery = new Map<string, MatchFeedbackJudgment[]>();
  for (const j of judgments) {
    const arr = byQuery.get(j.briefHash) ?? [];
    arr.push(j);
    byQuery.set(j.briefHash, arr);
  }

  const queries = [...byQuery.values()];
  const total = judgments.length;
  let goodFits = 0;
  for (const j of judgments) if (j.verdict === "good_fit") goodFits++;
  const wrongFits = total - goodFits;

  const reciprocalRanks: number[] = [];
  let firstGoodRankSum = 0;
  let firstGoodRankCount = 0;

  const pSum: Record<(typeof KS)[number], number> = { 1: 0, 3: 0, 5: 0 };
  const pCount: Record<(typeof KS)[number], number> = { 1: 0, 3: 0, 5: 0 };
  const nSum: Record<3 | 5, number> = { 3: 0, 5: 0 };
  const nCount: Record<3 | 5, number> = { 3: 0, 5: 0 };

  for (const q of queries) {
    // Order judged takes by the rank at which they were shown.
    const ordered = q
      .map((j) => ({ ...j, rank: j.rankShown ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.rank - b.rank);

    let firstGoodRank: number | null = null;
    for (const it of ordered) {
      // rank-null judgments were not seen in a ranked position; don't let
      // them count as the "first good" (it would pretend an unseen take was
      // ranked #MAX_SAFE_INTEGER).
      if (it.rankShown == null) continue;
      if (it.verdict === "good_fit") {
        firstGoodRank = it.rank;
        break;
      }
    }
    reciprocalRanks.push(firstGoodRank != null ? 1 / firstGoodRank : 0);
    if (firstGoodRank != null) {
      firstGoodRankSum += firstGoodRank;
      firstGoodRankCount++;
    }

    for (const k of KS) {
      const top = ordered.filter((it) => it.rank <= k);
      if (top.length === 0) continue;
      const goods = top.filter((it) => it.verdict === "good_fit").length;
      pSum[k] += goods / top.length;
      pCount[k] += 1;

      const rels = top.map((it) => (it.verdict === "good_fit" ? 1 : 0));
      const dcg = dcgAtK(rels);
      const idcg = dcgAtK(rels.slice().sort((a, b) => b - a));
      if (k === 3 || k === 5) {
        nSum[k] += idcg > 0 ? dcg / idcg : 0;
        nCount[k] += 1;
      }
    }
  }

  let goodSum = 0;
  let goodN = 0;
  let wrongSum = 0;
  let wrongN = 0;
  for (const j of judgments) {
    if (j.verdict === "good_fit") {
      goodSum += j.fitScoreShown;
      goodN++;
    } else {
      wrongSum += j.fitScoreShown;
      wrongN++;
    }
  }
  const goodAvgFit = goodN > 0 ? goodSum / goodN : null;
  const wrongAvgFit = wrongN > 0 ? wrongSum / wrongN : null;

  return {
    queryCount: queries.length,
    judgmentCount: total,
    goodFits,
    wrongFits,
    goodFraction: total > 0 ? goodFits / total : null,
    mrr: reciprocalRanks.length > 0 ? reciprocalRanks.reduce((a, b) => a + b, 0) / reciprocalRanks.length : null,
    rankOfFirstGood: firstGoodRankCount > 0 ? firstGoodRankSum / firstGoodRankCount : null,
    precisionAt: {
      1: pCount[1] > 0 ? pSum[1] / pCount[1] : null,
      3: pCount[3] > 0 ? pSum[3] / pCount[3] : null,
      5: pCount[5] > 0 ? pSum[5] / pCount[5] : null,
    },
    ndcgAt: {
      3: nCount[3] > 0 ? nSum[3] / nCount[3] : null,
      5: nCount[5] > 0 ? nSum[5] / nCount[5] : null,
    },
    scoreDiscrimination: {
      goodAvgFit,
      wrongAvgFit,
      delta: goodAvgFit != null && wrongAvgFit != null ? goodAvgFit - wrongAvgFit : null,
    },
  };
}