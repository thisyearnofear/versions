// MODULAR: Beachhead curation tool. Records hand-curated ground-truth labels
// directly into the match_feedback table, reusing the SAME supervisor-service
// path the in-app "Good fit / Wrong fit" buttons use — so a manually curated
// set (or a remote supervisor's batch of notes) feeds the exact benchmark
// that `npm run benchmark` reports.
//
// Each label is tied to the system state at curation time: the tool looks up
// the take's current fit_score + rank under the brief before recording it
// (an online-eval label, matching how the live loop labels).
//
// Usage (labels are idempotent upserts keyed by brief_hash + submission):
//   npm run curate -- --set path/to/labels.json
//
// labels.json:  [ { "brief": "...", "submissionId": "...", "verdict": "good_fit"|"wrong_fit" } ]
//
// Configure the curation identity with CURATOR_WALLET, or it defaults to a
// stable dev wallet so a dry run never collides with a real supervisor.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { services } from '../src/lib/services';
import { matchBriefHash } from '../src/lib/match-benchmark';

interface Label {
  brief: string;
  submissionId: string;
  verdict: 'good_fit' | 'wrong_fit';
}

const CURATOR_WALLET = process.env.CURATOR_WALLET || '0x' + 'c'.repeat(40);

function pct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(1)}%` : '(no data)';
}

async function main() {
  const setPath = process.argv[2] === '--set' ? process.argv[3] : null;
  if (!setPath) {
    console.error('\nusage: npm run curate -- --set path/to/labels.json\n');
    process.exit(1);
  }
  const labels: Label[] = JSON.parse(readFileSync(resolve(setPath), 'utf8'));
  if (!Array.isArray(labels) || labels.length === 0) {
    console.error('labels file must be a non-empty array');
    process.exit(1);
  }

  const feed = services().feed;
  const supervisor = services().supervisor;
  console.log(`\n── VERSIONS beachhead curation ─────────────────────────\n`);
  console.log(`  curator wallet: ${CURATOR_WALLET}`);
  console.log(`  labels:         ${labels.length}\n`);

  let recorded = 0;
  for (const label of labels) {
    // Online-eval label: snapshot the take's current score + rank under the
    // brief at the moment of curation.
    let fitScore = 0;
    let rank: number | null = null;
    try {
      const res = await feed.searchByBrief({ brief: label.brief, limit: 50 });
      const idx = res.rows.findIndex((r) => r.submission_id === label.submissionId);
      if (idx >= 0) {
        fitScore = res.rows[idx].fit_score;
        rank = idx + 1;
      }
    } catch {
      // keep score 0 / rank null — the label is still recorded.
    }
    await supervisor.recordMatchFeedback({
      supervisorWallet: CURATOR_WALLET,
      briefHash: matchBriefHash(label.brief),
      briefText: label.brief,
      submissionId: label.submissionId,
      fitScoreShown: fitScore,
      rankShown: rank,
      verdict: label.verdict,
    });
    recorded++;
    console.log(`  [${recorded}/${labels.length}] ${label.verdict.padEnd(9)} ${label.submissionId}  (score ${fitScore}, rank ${rank ?? '-'})`);
  }

  console.log('');
  const report = await supervisor.benchmarkMatchFeedback();
  console.log('  benchmark after curation:');
  console.log(`    queries   = ${report.queryCount}`);
  console.log(`    judgments = ${report.judgmentCount}  (good ${report.goodFits} / wrong ${report.wrongFits})`);
  console.log(`    MRR       = ${report.mrr != null ? report.mrr.toFixed(3) : '(no data)'}`);
  console.log(`    precision@1 = ${pct(report.precisionAt[1])} · @3 ${pct(report.precisionAt[3])}`);
  console.log(`    good fraction = ${pct(report.goodFraction)}`);
  console.log('──────────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error(`curate failed: ${(err as Error).message}`);
  process.exit(1);
});