# VERSIONS Primitive API — v1

The **primitive** is what we sell: *a brief → a pre-cleared, attributed,
micro-settled license.* This document is the versioned contract external
catalogs, labels, and DSPs (who are structurally disincentivized to build
it themselves) could consume. Typed shapes live in
[`src/lib/primitive-contract.ts`](../src/lib/primitive-contract.ts); the
reference implementation is the app's own routes under `/api/v1`.

Version: **`v1`** (`X-Primitive-Version: v1`, optional header).
Base path: `/api/v1`.

---

## Conventions

**Auth / identity.** Requests carry an operator identity via the header
`x-supervisor-guest: <id>` (a stable per-operator id) or a connected
wallet. No wallet is required — search and even settlement work for a
guest in mock-first mode. When real Arc is configured, settlement
broadcasts actual USDC transfers.

**Response envelope.**
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "…", "message": "…", "requestId": "…" } }
```

**Error codes.** `INVALID_BRIEF` (400) · `INVALID_BODY` (400) ·
`INVALID_VERDICT`/`INVALID_LICENSE` (400) · `UNAUTHORIZED` (401) ·
`VERSION_NOT_FOUND` (404) · `NOT_FOUND` (404) · `RATE_LIMITED` (429) ·
`INTERNAL` (500).

**Rate limits.** `brief-match` is limited per-IP to 60 req/60s by default.
**Idempotency.** Verdicts and licenses upsert on `(operator, brief_hash,
submission_id)` — re-sending the same (broad outcome-defining) call does not
duplicate. `settle` is idempotent for an already-paid license.

---

## Endpoints

### 1. `GET /brief-match` — brief → ranked takes
Ranked alternate takes for a plain-English brief.
- `?brief` (3–500 chars, required) · `?limit` (≤50) · `?offset`
- Response `data`: `{ rows: BriefSearchRow[], total, limit, offset }`
  Each row carries `fit_score`, `why_fits`, `submission_id`, `title`,
  `artist_name`, and the structured `brief` the take was placed under.

```json
{ "success": true, "data": {
  "rows": [ { "submission_id": "sub_abc", "title": "Run Scene 3 (take 2)",
             "artist_name": "M. Rivera", "fit_score": 0.87,
             "why_fits": ["matches 'tense car chase' via high energy + locked tempo"],
             "brief": { "scene_tags": ["car chase"], "instruments": ["synth"],
                        "emotional_arcs": ["tension"], "audience_summary": "…" } } ],
  "total": 42, "limit": 20, "offset": 0 } }
```

### 2. `POST /verdict` — record ground truth
Label a shown match as a good fit / wrong fit (feeds the benchmark moat).
- Body: `{ briefText, briefHash, submissionId, fitScoreShown, rankShown?, verdict: "good_fit"|"wrong_fit" }`
- Response `data`: `{ row: MatchFeedbackRow }`

### 3. `POST /license` — open a license for a matched take
- Body: `{ submissionId, briefHash, briefText, usageType }` where
  `usageType ∈ { sync_ad, sync_tv_film, sync_digital, other }`.
- Fee is derived server-side (`licenseFeeUsdc`). Response `data`:
  `{ license: LicenseRow }` with `status: "pending_payment"`.

### 4. `POST /license/:id` — settle on Arc
Settle a pending license (platform-brokered, mock-first). Idempotent.
- Response `data`: `{ license: LicenseRow, settled: { txHash, mock } }`.

### 5. `GET /license/:id` — the receipt
- Response `data`: `{ license: LicenseRow }` (status, fee, `settled_at`,
  `payment_tx_hash` → link via ArcScan).

### 6. `GET /benchmark` — match-quality report
Aggregates every labeled verdict into the online benchmark.
- Response `data`: `{ report: { queryCount, judgmentCount, goodFits,
  wrongFits, goodFraction, mrr, rankOfFirstGood, precisionAt: {1,3,5},
  ndcgAt: {3,5}, scoreDiscrimination: { goodAvgFit, wrongAvgFit, delta } } }`

---

## Why a catalog would adopt this

They're disincentivized to build autonomous long-tail clearance + micro-
settlement (it cannibalizes their curation premium / human sync model), so
the *outcome* — pre-cleared, attributed, micro-settled licenses plus the
compounding ground-truth dataset — is theirs to consume without the
internal cost or conflict. See `STRATEGY.md`.