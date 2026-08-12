# VERSIONS Primitive API — v1

The **primitive’s target outcome** is *a brief → a cleared, attributed,
micro-settled license.* This document specifies the versioned contract that
external catalogs, labels, and DSPs (who are structurally disincentivized to
build it themselves) can consume. The current v1 match response truthfully
exposes a take’s workflow requestability and the platform’s indicative quote;
it does **not** assert rights clearance. Typed shapes live in
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
`VERSION_NOT_FOUND` (404) · `DEMO_CATALOG_ONLY`/`SETTLEMENT_IN_PROGRESS`/
`SETTLEMENT_CLAIM_LOST` (409) · `NOT_FOUND` (404) · `RATE_LIMITED` (429) ·
`INTERNAL` (500).

**Rate limits.** Brief matching is limited per-IP to 60 requests per 60
seconds by default.

**Idempotency.** Verdicts and licenses upsert on `(operator, brief_hash,
submission_id)`; resending an outcome-defining call does not duplicate it.
Settlement is idempotent once a license is paid. Before external work starts, a
pending license is atomically claimed by one lease owner; a `settling` claim is
never automatically reclaimed because a prior executor may have broadcast a
job or payout. Persistent `settling` rows require receipt reconciliation before
an operator can finalize or release them.

## Endpoints

### 1. `GET /discover/brief` — brief → ranked takes

Ranked alternate takes for a plain-English brief.

- `?brief` (3–500 chars, required) · `?limit` (≤50) · `?offset`
- Optional filters: `sceneTags`, `instruments`, `energy`, `tempo`
- Response `data`: `{ rows: BriefSearchRow[], total, limit, offset }`

Each v1 row contains `fit_score`, `why_fits`, track metadata, `catalog`
provenance, a structured placement brief, `license_availability`,
`license_quote`, and `licensing_evidence`. The response also has a `catalog`
summary with its mode and live/demo result counts. `why_fits` is evidence from
the available catalog-ranking signals; it is not an individual agent verdict or
clearance claim.

```json
{ "success": true, "data": {
  "rows": [{
    "submission_id": "sub_abc",
    "title": "Run Scene 3 (take 2)",
    "artist_name": "M. Rivera",
    "fit_score": 0.87,
    "why_fits": ["scene: car chase", "instrument: synth"],
    "catalog": {
      "source": "live",
      "label": "Live catalog",
      "description": "Catalog data supplied for the live workflow. Rights clearance remains independently unverified unless evidenced."
    },
    "license_availability": {
      "status": "requestable",
      "reason": "Published takes can enter the current platform license-request workflow.",
      "clearance": {
        "status": "unverified",
        "reason": "No auditable rights-clearance record exists for this take."
      }
    },
    "license_quote": {
      "status": "indicative",
      "territory": "worldwide",
      "term_months": 12,
      "usage_options": [
        { "usage_type": "sync_ad", "fee_usdc": "150.00" },
        { "usage_type": "sync_tv_film", "fee_usdc": "250.00" },
        { "usage_type": "sync_digital", "fee_usdc": "75.00" },
        { "usage_type": "other", "fee_usdc": "100.00" }
      ]
    },
    "licensing_evidence": {
      "status": "rights_review_required",
      "summary": "This live-catalog take is requestable, but rights authority, scope, and final terms still require review.",
      "outstanding": [
        { "requirement": "rights_authority", "description": "Confirm the authority to license every required right for this take." },
        { "requirement": "scope_and_restrictions", "description": "Record territory, term, media scope, and any restrictions or exclusions." },
        { "requirement": "final_quote", "description": "Issue a rights-aware final quote before treating the license as cleared." }
      ]
    },
    "brief": {
      "scene_tags": ["car chase"],
      "instruments": ["synth"],
      "emotional_arcs": ["tension"],
      "audience_summary": "…"
    }
  }],
  "catalog": { "mode": "live_catalog", "demo_result_count": 0, "live_result_count": 42 },
  "total": 42,
  "limit": 20,
  "offset": 0
}}
```

`catalog.source: "demo"` is guided-demo data. Its availability is
`"demo_preview"` and its quote is a `"sample"`; `POST /licenses` returns
`DEMO_CATALOG_ONLY` (409) and never opens a job, payment, or settlement.
`catalog.source: "live"` may be `"requestable"`, which means only that the
matched published take can enter the existing authenticated `POST /licenses`
workflow. `clearance.status: "unverified"` is deliberate: v1 has no persisted
rights-holder, authority, restriction, chain-of-title, revocation, or
clearance-proof record. `license_quote.status: "indicative"` is the
server-derived global platform schedule (currently worldwide for 12 months),
not a negotiated, cleared, or final license offer. `licensing_evidence` turns
that absence into an explicit decision checklist; its `outstanding` items are
requirements, not claims that the evidence has been collected.

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

Opening a job requires the supervisor’s approval and does not convert an
unverified result into a clearance claim. A v1 search result may say
**requestable** and **indicative quote available**; it must not say
**pre-cleared** or **license-ready** without auditable, result-level clearance
and final-quote evidence.

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

The v1 contract intentionally does not promise a simulated agent trace or
rights clearance. The new requestability and indicative-quote fields make the
current workflow inspectable, but they are not substitutes for verification.
Before a future version exposes named agent verdicts or a `clearance.status`
other than `unverified`, a ranked row needs auditable fields such as:

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
  clearance: {
    status: "cleared" | "needs_review";
    scope: string;
    restrictions: string[];
    proof: string;
  },
  license_quote: {
    status: "final";
    usage_type: string;
    territory: string;
    term_months: number;
    fee_usdc: string;
    source: string;
  }
}
```

Those fields enable a supervisor decision workspace: a recommendation,
inspectable evidence and trade-offs, a human approval gate, and an executable
license state. They must be derived from actual runs and rights records—not
from generic rank, timing, or curator-review counts. The product expression
and staged UX are documented in [search.md](./search.md).

## Why a catalog would adopt this

Catalogs are disincentivized to build autonomous long-tail clearance and
micro-settlement because it cannibalizes their curation premium and human sync
model. VERSIONS can provide the workflow and a compounding ground-truth
dataset now, while building toward auditable cleared, attributed,
micro-settled licenses rather than merely claiming that outcome. See
[`STRATEGY.md`](../STRATEGY.md).
