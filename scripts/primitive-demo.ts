// MODULAR: External-client demonstration of the versioned primitive. Calls
// the real endpoints over HTTP exactly as a catalog / label / DSP consumer
// would, and walks the whole wedge: brief → ranked matches → record a
// ground-truth verdict → open a license → settle it on Arc (mock-first) →
// pull the match-quality benchmark.
//
// Run a dev server first:
//   npm run dev
// Then:
//   npm run primitive:demo            # http://localhost:3000
//   VERSIONS_BASE_URL=https://... npm run primitive:demo

import {
  PRIMITIVE_ENDPOINTS,
  PRIMITIVE_VERSION,
  type PrimitiveLicenseRequest,
  type PrimitiveSettleResponse,
  type PrimitiveVerdictRequest,
  type PrimitiveVerdictResponse,
} from '../src/lib/primitive-contract';
import type { BriefSearchResponse } from '../src/lib/types';
import type { LicenseRow } from '../src/lib/api-client';
import { matchBriefHash } from '../src/lib/match-benchmark';

const BASE = process.env.VERSIONS_BASE_URL || 'http://localhost:3000';
const GUEST = `demo-${Math.random().toString(36).slice(2, 10)}`;
const BRIEF = 'tense car chase, no vocals, ~120 bpm';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-supervisor-guest': GUEST,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: { data?: T; error?: { code?: string; message?: string } } | null = null;
  try {
    json = text ? (JSON.parse(text) as typeof json) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? text} @ ${path}`);
  }
  return (json?.data ?? (json as unknown as T)) as T;
}

async function main() {
  console.log(`\nVERSIONS primitive · ${PRIMITIVE_VERSION} · ${BASE}`);
  console.log(`  guest = ${GUEST}`);
  console.log(`  brief = "${BRIEF}"\n`);

  // 1. Match — brief → ranked takes.
  const match = await req<BriefSearchResponse>(
    `${PRIMITIVE_ENDPOINTS.match}?brief=${encodeURIComponent(BRIEF)}&limit=5`,
  );
  console.log(`  [match] total=${match.total} returned=${match.rows.length}`);
  if (match.rows.length === 0) {
    console.log('\n  No published takes — seed the catalog first (npm run seed).\n');
    return;
  }
  const top = match.rows[0];
  console.log(`    #1 ${top.title} — ${top.artist_name}  (fit ${top.fit_score})`);
  console.log(`    WHY: ${top.why_fits?.[0] ?? '(no rationale)'}`);

  // 2. Verdict — record ground truth on the #1 result.
  const briefHash = matchBriefHash(BRIEF);
  const verdictReq: PrimitiveVerdictRequest = {
    briefText: BRIEF,
    briefHash,
    submissionId: top.submission_id,
    fitScoreShown: top.fit_score,
    rankShown: 1,
    verdict: 'good_fit',
  };
  const verdict = await req<PrimitiveVerdictResponse>(PRIMITIVE_ENDPOINTS.verdict, {
    method: 'POST',
    body: JSON.stringify(verdictReq),
  });
  console.log(`  [verdict] recorded ${verdict.row.verdict}  (${verdict.row.brief_hash.slice(0, 8)}…)`);

  // 3. License — open a license for the take.
  const licenseReq: PrimitiveLicenseRequest = {
    submissionId: top.submission_id,
    briefHash,
    briefText: BRIEF,
    usageType: 'sync_tv_film',
  };
  const license = await req<{ license: LicenseRow }>(PRIMITIVE_ENDPOINTS.license, {
    method: 'POST',
    body: JSON.stringify(licenseReq),
  });
  console.log(`  [license] ${license.license.status} · $${license.license.fee_usdc} USDC · ${license.license.usage_type}`);

  // 4. Settle — pay on Arc (mock-first when not configured).
  const settle = await req<PrimitiveSettleResponse>(PRIMITIVE_ENDPOINTS.settle(license.license.id), {
    method: 'POST',
  });
  console.log(
    `  [settle] ${settle.license.status} ${settle.settled?.mock ? '(mock) ' : ''}tx=${settle.settled?.txHash.slice(0, 12)}…`,
  );

  // 5. Benchmark — the ground-truth report feeding the moat.
  const bench = await req<{ report: { judgmentCount: number; mrr: number | null; precisionAt: { 1: number | null } } }>(
    PRIMITIVE_ENDPOINTS.benchmark,
  );
  console.log(
    `  [benchmark] judgments=${bench.report.judgmentCount} mrr=${bench.report.mrr?.toFixed(3) ?? 'n/a'} p@1=${bench.report.precisionAt[1]?.toFixed(3) ?? 'n/a'}`,
  );

  console.log('\n  Primitive loop complete — this is the wedge external catalogs could plug into.\n');
}

main().catch((err) => {
  console.error(`\nprimitive:demo failed: ${(err as Error).message}\n`);
  process.exit(1);
});