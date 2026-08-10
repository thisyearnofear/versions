// MODULAR: Match ground-truth benchmark. Reads every labeled
// (brief → take) judgment and prints MRR / precision@k / nDCG and the
// fit-score discrimination check. This is the "is the matcher getting
// better" number behind the ground-truth moat.
//
// Run:   npm run benchmark
// Same report over HTTP: GET /api/v1/discover/benchmark

import { services } from '../src/lib/services';

function pct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(1)}%` : '(no data)';
}
function num(v: number | null, digits = 3): string {
  return v != null ? v.toFixed(digits) : '(no data)';
}

async function main() {
  console.log('\n── VERSIONS match ground-truth benchmark ────────────────\n');
  const report = await services().supervisor.benchmarkMatchFeedback();

  console.log(`  queries:            ${report.queryCount}`);
  console.log(`  judgments:          ${report.judgmentCount}`);
  console.log(`  good / wrong fits:  ${report.goodFits} / ${report.wrongFits}  (good fraction ${pct(report.goodFraction)})`);
  console.log('');
  console.log(`  MRR:                ${num(report.mrr)}`);
  console.log(`  rank of 1st good:   ${report.rankOfFirstGood != null ? `#${report.rankOfFirstGood.toFixed(2)}` : '(no data)'}`);
  console.log(`  precision@1:        ${pct(report.precisionAt[1])}`);
  console.log(`  precision@3:        ${pct(report.precisionAt[3])}`);
  console.log(`  precision@5:        ${pct(report.precisionAt[5])}`);
  console.log(`  nDCG@3:             ${num(report.ndcgAt[3])}`);
  console.log(`  nDCG@5:             ${num(report.ndcgAt[5])}`);
  const d = report.scoreDiscrimination;
  console.log(`  fit score good/wrong: ${num(d.goodAvgFit, 2)} / ${num(d.wrongAvgFit, 2)}  (Δ ${d.delta != null ? `+${d.delta.toFixed(2)}` : 'n/a'})`);
  console.log('');
  console.log('  If MRR / precision@k are flat while good-fraction climbs,');
  console.log('  the scorer is surfacing relevant long-tail takes the reviewer ');
  console.log('  did not know to expect — a strong signal the semantic layer is worth\n  shipping as default ranking.');
  console.log('──────────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('benchmark failed:', err);
  process.exit(1);
});