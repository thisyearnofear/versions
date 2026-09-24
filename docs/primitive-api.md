# VERSIONS Primitive API — v1 (+ marketplace wedge)

Two surfaces live under the same `/api/v1` base path: the **original
brief → licensed-version pipeline** (kept, surfaces still use it) and
the new **marketplace wedge** — unified listings, verified channels,
paid placements (slots), and usage tracking. External consumers should
treat the marketplace contract as the forward path; the brief pipeline
remains documented below for completeness.

Version: **`v1`** (`X-Primitive-Version: v1`, optional header).
Base path: `/api/v1`.

---

## Conventions

**Auth.** Browse + listing/channel reads are public. Creating a listing,
registering a channel, buying a slot, and logging usage require a
NextAuth wallet session. Real money moves on live Arc only.

**Response envelope.**
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "…", "message": "…", "requestId": "…" } }
```

**Error codes.** `INVALID_BODY` (400) · `INVALID_LISTING`/`INVALID_CHANNEL`/
`INVALID_SLOT`/`INVALID_USAGE` (400) · `UNAUTHORIZED` (401) ·
`LISTING_NOT_FOUND`/`CHANNEL_NOT_FOUND`/`SLOT_NOT_FOUND` (404) ·
`CHANNEL_UNVERIFIED`/`CAMPAIGN_EXHAUSTED`/`BUDGET_BELOW_FEE` (403/409) ·
`SETTLEMENT_IN_PROGRESS`/`SETTLEMENT_CLAIM_LOST` (409) ·
`RATE_LIMITED` (429) · `INTERNAL` (500).

**Rate limits.** Standard IP-based limiter (60/60s). Slot `pay`/`complete`
take a fail-closed lease (`settlement_lease_id`) — a second caller gets
409 without double-spending.

**Idempotency.** Listing creation is not deduped. Slot creation is
deduped per `(listing_id, channel_id)` for live statuses (`pending_payment
| active | paused`) via `uq_slots_active_listing_channel` — a second POST
returns the existing row (`alreadyExisted: true`). Usage logging is
append-only.

---

## Marketplace endpoints

### `GET /listings` — browse live supply

Query: `?kind=music|placement&limit&offset` (public). Or `?mine=1` for
caller-scoped (requires auth). Returns `{ listings: ListingRecord[] }`.

### `GET /marketplace/search` — ethos-personalized ranking

Query: `?q` (vibe) `&channelId` (personalize) `&kind=music|placement`
`&tier=free|paid` `&sort` `&limit&offset` — public, guest-friendly.
- `q` is free-text (e.g. `lo-fi night drive`); `channelId` pulls the
  store's ethos (niche + platform description + recent titles) so the feed
  ranks by that channel. Both together combine: `q` refines the channel vector.
- Returns `{ rows: ListingRecord[] & { fit_score, why_fits, similarity }, total, limit, offset, mode, counts, sort }`
  where `mode` is `semantic` (cosine vs `listing_embeddings`, 70/30 hybrid with tags),
  `tag` (tag-overlap only, e.g. in PGlite/mock), or `recent` (no query/channel).
  `why_fits` cites the matching tags; `similarity` is 0..1 when `mode: semantic`.
- `sort` is `fit` (default — keeps the ranking order) `| newest | price_asc |
  price_desc`, applied **before** `offset`/`limit` so paging cannot mis-order.
  Free supply prices at 0, so `price_asc` surfaces the free tier first.
- `counts: { total, music, placement, free, paid }` is computed **before** the
  `kind`/`tier` facets — a facet never collapses the other groups. The top-level
  `total` remains the post-facet count that paging uses. Clients must not
  derive either number locally.
- Invalid `channelId` is ignored (falls back to `q`-only ranking) rather than 404.
- A degraded (DB-unreachable) response returns `total: 0`, zeroed `counts`, and
  `degraded: true` — the UI renders "no matches for now", never a fake shelf.

### `POST /listings` — create supply

Body (strict):
```json
{
  "kind": "music | placement",
  "title": "string (1–200)",
  "supplierName": "string (1–120)",
  "summary": "string? (≤1000)",
  "tags": ["string (1–40, 1–12 items)"],
  "images": ["string (≤2000, ≤8)"] ,
  "submissionId": "string? (music requires an owned submission)",
  "tier": "free | paid",
  "pricing": { "model": "flat", "flatFeeUsdc": "25" } | { "model": "cpm", "cpmUsdc": "4.50" } | null,
  "budgetCapUsdc": "string? (paid only; null = uncapped)",
  "agreementVersion": "marketplace-1.0.0"
}
```
- `tier: paid` requires `pricing` and mints `disclosure` (`sponsored`, `#ad`).
- `tier: free` must have no `pricing`/`disclosure`.
- Response `201 { listing }` — `status: 'active'`, `attribution_text`/`attribution_url`/`attribution_slug` generated (NCS-style), `pricing`/`disclosure` baked in.

### `GET /listings/:id` / `PATCH /listings/:id`

- `GET` public. `PATCH { status }` owner-only (`paused|archived|active`).

### Public pages

- `GET /listings/:id` (HTML) — attribution page.
- `GET /t/:code` — `302` tracking redirect → `attribution_url`.

### `POST /channels` / `GET /channels` / `GET /channels/:id`

- `POST { platformUrl, niche?, ethosSummary?, agreementVersion }` (strict, **no stats field** — a 400 for `subscriberCount` is by design). Probes YouTube; without `YOUTUBE_API_KEY` returns `pending` + `stats_source: 'mock'` (cannot buy). With live probe → `verified` + `stats_source: 'platform_api'` and `can_buy_slots: true` only when `verified && active`.
- `GET /channels/:id/verify` re-probes a pending channel (owner-only).

### `POST /slots` — buy a placement

```json
{ "listingId": "string", "channelId": "string (owned, verified)", "budgetUsdc": "string? (CPM requires; flat optional as cap)" }
```
Guards: listing must be `active` + `paid`, channel must be `verified`, CPM budget clamped to campaign headroom. Returns `201 { slot }` (or `200` if the live slot already exists).

### `POST /slots/:id/pay` / `POST /slots/:id/complete`

- `/pay` collects the gross (flat fee or CPM escrow), reserves campaign spend atomically, settles flat `60/30/10` `slot_legs` via `insertSlotLegsAtomic` → `settleSlotLegsAsync`, emits the durable receipt (`slot` source). Locks `settlement_lease_id`.
- `/complete` settles CPM accrued spend (`spend_usdc` only from `slots.accrue`) and refunds unspent escrow; flat is idempotent.

### `POST /usage` / `GET /usage`

```json
{ "listingId": "string", "channelId": "string (owned)", "slotId": "string? (paid requires; omitted resolves the channel's latest slot)", "videoUrl": "string?", "impressions": 0, "clicks": 0, "attributionCode": "string?", "externalContentId": "string?", "occurredAt": "ISO?" }
```
- No `reportedBy` or `spendUsdc` in the body — `reported_by` is recorded (default `channel`; only the platform probe may write `platform_api`) and spend comes from `slots.accrue`'s capped atomic increment.
- `GET /usage[?listingId|channelId|slotId|since]` → scoped rows or `{ summary: { total_events, by_reporter, spend_usdc, … } }` and `attributionCompliance(listingId)`. Aggregates must quote the `by_reporter` split alongside any total.

---

## Legacy: brief → licensed take (kept)

These endpoints remain for `/discover` supervisor workflows and share settlement rails with the slot path.

### 1. `GET /discover/brief` — brief → ranked takes

`?brief` (3–500 chars, required) · `?limit` (≤50) · `?offset` · filters `sceneTags`, `instruments`, `energy`, `tempo` → `{ rows: BriefSearchRow[], total, catalog: { mode, demo_result_count, live_result_count } }`. Rows carry `fit_score`/`why_fits`/`catalog`/`license_availability`/`license_quote`/`licensing_evidence`.

### 2. `POST /discover/brief/feedback` — label a shown match

`{ briefText, briefHash, submissionId, fitScoreShown, rankShown?, verdict }`.

### 3. `POST /licenses` — open a license

`{ submissionId, briefHash, briefText, usageType }` → `{ license }` `pending_payment` (+ ERC-8183 job).

### 4. `POST /licenses/:id` — settle / `GET /licenses/:id` — receipt · `GET /discover/benchmark`

Unchanged. See the prior spec revision for shapes.

## Why this marketplace wedge

Supply (music + products) and distribution (verified channels) are two
sides of the same feed. One blanket agreement, one attribution format,
one tracking code, one flat split — instead of bespoke, per-track legal
surface that the founder explicitly asked to drop. Money rails reuse
`settlement.ts` patterns with fewer, simpler legs; the durability
machinery (`outbox`, `settlement-sweeper`) is unchanged, just with
simpler inputs.
