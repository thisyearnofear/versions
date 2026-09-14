# Browse, supply & channel ethos

VERSIONS is a **marketplace of slots in a feed**, not a catalog browser.
Browse surfaces **two catalogs — music + product placements** — as the
same primitive (`listings`), matched to a **channel's ethos** in the same
vector space, free with attribution or paid as a sponsor slot. Search
remains guest-friendly; a wallet is required only to list, connect a
channel, buy a slot, or log where it ran.

## The primitive

| Concept | Table | What |
|---------|-------|------|
| **Listing** | `listings` | `music` (track, features, mood/genre tags) or `placement` (brand, images, pitch, target ethos tags). Both `free | paid`, paid is `flat | cpm` with optional `budget_cap_usdc`. Embeddings shared with channels. |
| **Channel** | `channels` | A verified distribution surface (YouTube). Niche + ethos summary + platform-pulled recent content → `channel_embeddings`. Only `verified` channels can buy. |
| **Slot** | `slots` | A **paid placement** of a listing on a channel (self-serve, tracking code + disclosure, flat 60/30/10 `slot_legs`, budget cap). |
| **Usage** | `usage_events` | Every use (free or paid) logged: who, what, when, where (`videoUrl` when available). The flywheel and the paid-side proof. |

One blanket agreement (`src/lib/agreement.ts`, `marketplace-1.0.0`, stamped
on every listing and channel row) covers all free use. No per-listing
negotiation — Browse is the product, not the contract.

## Current experience

- **Browse (`/discover`)** — unified feed above the legacy brief search.
  Kind filter (`all | music | placement`), text filter over title/brand/
  summary/tags, tier badge (`free · attribution` / `paid · flat|CPM`),
  tag chips, audio player or image grid, attribution block with disclosure
  (`#ad`), buy sheet (pick a verified channel, set budget, `POST /slots`
  → `/pay`), and a usage proof rollup (`by_reporter` split).
- **Supply (`/submit`)** — one card, two kinds (toggle). Title/brand +
  pitch + tags, track picker (music, ownership-checked) or image URLs
  (placement), tier, model, fee/CPM, optional budget cap, live
  attribution preview, agreement terms + acceptance. `POST /api/v1/listings`
  is live immediately — matching ranks for discovery, it does not gate
  publication.
- **Channel ethos (`/channels`, `ethosText`)** — channel connects a real
  YouTube URL (`platform_url`), the probe pulls `subscriberCount`/
  `viewCount`/`videoCount` + description + recent titles (`recentContent`),
  and `buildChannelEthosText` joins niche + ethosSummary +
  platformDescription + `recent: title` lines into the embedding input.
  Verified channels unlock paid placements everywhere.
- **Matching** — listings and channel ethos share the same vector space
  (`listing_embeddings` / `channel_embeddings`, pgvector 512). The legacy
  `brief → rank` path (`placement_briefs`, `version_embeddings`, 0.7/0.3
  hybrid) still runs on `/discover` for supervisor workflows; channel-
  ethos ranking reuses the same embedding adapter (one vector space,
  single provider: OpenRouter by default; Venice opt-in via
  `VENICE_EMBED_ENABLE=1` + re-embed).
- **Catalog provenance** — `catalog.source` is `demo | live` on legacy
  brief results. `authorized` is retired (see deploy notes). Listings
  have `status: draft | active | paused | exhausted | archived` and a
  campaign spend counter (`budget_spent_usdc`). Slots have
  `pending_payment | active | paused | exhausted | completed | cancelled`.

## Required invariants (do not regress)

- **No self-reported reach.** `ChannelRegisterSchema` has no stats field;
  stats are written only by `src/adapters/youtube.ts`. `can_buy_slots`
  is `verified && active` — the single predicate every buy path checks.
- **No spend from the request body.** `POST /api/v1/usage` ignores
  `spendUsdc`; spend comes only from `slots.accrue` via the guarded
  atomic `UPDATE … WHERE spent+delta <= cap`.
- **Disclosure travels with the creative.** Paid listings carry
  `disclosure` (`sponsored`, `#ad`) and every slot copies it at purchase
  — the channel cannot drop it by editing the listing.
- **Caps are atomic.** `listings.budget_spent_usdc` and `slots.spent_usdc`
  move with `SET col = col + delta WHERE col + delta <= cap` in the same
  statement that increments — concurrent delivers cannot double-spend.

## Routes (marketplace)

```
GET  /api/v1/listings[?kind=music|placement&limit&offset]    public, live supply
GET  /api/v1/listings?mine=1&limit                          caller-scoped
POST /api/v1/listings                                        supplier, agreement required

GET  /api/v1/channels[?limit]                                caller-scoped
POST /api/v1/channels                                        caller, agreement required
GET  /api/v1/channels/:id                                    public if verified else owner-only
POST /api/v1/channels/:id/verify                            owner, re-probe
GET  /api/v1/channels/:id/slots                             pending once probe is live

POST /api/v1/slots                                           verified channel buys paid listing
GET  /api/v1/slots[?channelId|listingId]                    caller-scoped
POST /api/v1/slots/:id/pay                                   pay & activate (flat settles here; CPM escrows)
POST /api/v1/slots/:id/complete                              CPM settle accrued + refund remainder
PATCH /api/v1/slots/:id  {action: pause|resume}              either party

POST /api/v1/usage                                           channel owner logs where it ran
GET  /api/v1/usage[?listingId|channelId|slotId|since]       scoped list or catalog summary

GET  /listings/:id                                           public attribution page
GET  /t/:code                                                302 → attributionUrl (tracking code)
```

## Progression

1. **Now:** browseable supply (music + placements), verifiable channels,
   self-serve slots with tracking + disclosure + cap, and reportable
   usage — all wired in the UI with empty states that sell the loop.
2. **Next:** channel-personalized ranking (embed channel ethos → surface
   either kind in one ranked feed), unreported-use nudges, and a
   verified-delivery ingestion path alongside channel-reported events.
3. **Then:** campaign analytics that are actually useful (spend vs
   delivery curve, budget headroom per campaign, reproducible reporter
   split).

Ground-truth taps (`good_fit` / `wrong_fit`) still feed the benchmark
(`npm run benchmark`). The versioned external contract is in
[primitive-api.md](./primitive-api.md); the strategic rationale is in
[`STRATEGY.md`](../STRATEGY.md).
