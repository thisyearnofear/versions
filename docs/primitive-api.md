# VERSIONS Primitive API — v1

The **primitive** is what we sell: *a brief → a pre-cleared, attributed,
micro-settled license.* This document is the versioned contract external
catalogs, labels, and DSPs (who are structurally disincentivized to build it
themselves) can consume. Typed shapes live in
[`src/lib/primitive-contract.ts`](../src/lib/primitive-contract.ts); the
reference implementation is the app's own routes under `/api/v1`.

Version: **`v1`** (`X-Primitive-Version: v1`, optional header).
Base path: `/api/v1`.

---

## Conventions

**Auth.** Search is guest-friendly (`x-supervisor-guest` or no identity).
Feedback accepts a guest identity. Shortlist and license require a NextAuth
wallet session. Settlement on live Arc broadcasts real USDC transfers.

**Response envelope.**
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "…", "message": "…", "requestId": "…" } }
```

**Error codes.** `INVALID_BRIEF` (400) · `INVALID_BODY` (400) ·
`INVALID_VERDICT`/`INVALID_LICENSE` (400) · `UNAUTHORIZED` (401) ·
`VERSION_NOT_FOUND` (404) · `NOT_FOUND` (404) · `RATE_LIMITED` (429) ·
`INTERNAL` (500).

**Rate limits.** Brief matching is limited per-IP to 60 requests per 60
seconds by default.

**Idempotency.** Verdicts and licenses upsert on `(operator, brief_hash,
submission_id)`; resending an outcome-defining call does not duplicate it.
Settlement is idempotent once a license is paid.

## Endpoints

### 1. `GET /discover/brief` — brief → ranked takes

Ranked alternate takes for a plain-English brief.

- `?brief` (3–500 chars, required) · `?limit` (≤50) · `?offset`
- Optional filters: `sceneTags`, `instruments`, `energy`, `tempo`
- Response `data`: `{ rows: BriefSearchRow[], total, limit, offset }`

Each v1 row contains `fit_score`, `why_fits`, track metadata, and the
structured placement brief. `why_fits` is evidence from the available
catalog-ranking signals; it is not an individual agent verdict or clearance
claim.

```json
{ "success": true, "data": {
  "rows": [{
    "submission_id": "sub_abc",
    "title": "Run Scene 3 (take 2)",
    "artist_name": "M. Rivera",
    "fit_score": 0.87,
    "why_fits": ["scene: car chase", "instrument: synth"],
    "brief": {
      "scene_tags": ["car chase"],
      "instruments": ["synth"],
      "emotional_arcs": ["tension"],
      "audience_summary": "…"
    }
  }],
  "total": 42,
  "limit": 20,
  "offset": 0
}}
```

### 2. `POST /discover/brief/feedback` — record ground truth

Label a shown match as a good fit or wrong fit. The label feeds the benchmark
and future scorer tuning.

- Body: `{ briefText, briefHash, submissionId, fitScoreShown, rankShown?, verdict: "good_fit"|"wrong_fit" }`
- Response `data`: `{ row: MatchFeedbackRow }`

### 3. `POST /licenses` — open a license for a matched take

- Body: `{ submissionId, briefHash, briefText, usageType }`, where
  `usageType ∈ { sync_ad, sync_tv_film, sync_digital, other }`
- The fee is derived server-side. Response `data`:
  `{ license: LicenseRow }`, with `status: "pending_payment"` and an
  ERC-8183 license job when available.

A v1 search result may say **available to request**. It must not say
**pre-cleared** or **license-ready** until it includes auditable, result-level
clearance and quote evidence.

### 4. `POST /licenses/:id` — settle on Arc

Settle a pending license (platform-brokered, mock-first). Idempotent.
Response `data` includes `{ license, settled }`, with transaction and
ERC-8183 job receipt fields where available.

### 5. `GET /licenses/:id` — the receipt

Returns `{ license: LicenseRow }`, including status, fee, settlement time,
payment transaction, and license-job receipt fields.

### 6. `GET /discover/benchmark` — match-quality report

Aggregates labeled verdicts into the online benchmark:
`queryCount`, `judgmentCount`, good/wrong fit counts, MRR, precision@k,
nDCG, and score discrimination.

## Contract evolution: decision evidence

The v1 contract intentionally does not promise a simulated agent trace.
Before a future version exposes named agent verdicts or clearance state, a
ranked row needs auditable fields such as:

```ts
{
  ranking_run: { id: string; mechanisms: string[]; scorer_version: string },
  agent_verdicts: Array<{
    agent: "production" | "performance" | "market";
    score: number;
    confidence: number;
    evidence: string[];
    objection?: string;
  }>,
  clearance: { status: "cleared" | "needs_review"; scope: string; proof: string },
  license_quote: { usage_type: string; territory: string; term_months: number; fee_usdc: string }
}
```

Those fields enable a supervisor decision workspace: a recommendation,
inspectable evidence and trade-offs, a human approval gate, and an executable
license state. They must be derived from actual runs and rights records—not
from generic rank, timing, or curator-review counts. The product expression
and staged UX are documented in [search.md](./search.md).

## Why a catalog would adopt this

They are disincentivized to build autonomous long-tail clearance and
micro-settlement because it cannibalizes their curation premium and human sync
model. The outcome—pre-cleared, attributed, micro-settled licenses plus a
compounding ground-truth dataset—is theirs to consume without the internal
cost or conflict. See [`STRATEGY.md`](../STRATEGY.md).
