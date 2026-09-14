# Beachhead — getting to marketplace liquidity

The moat compounds from **logged uses**: which channel used which
listing, where, and how much paid delivery cost. The paid side is only
sellable once the free tier proves the catalog actually gets used.

**Slice to win first:** one ethos where supply and demand already rhyme
(e.g. lo-fi night drive / study / thriller tension / morning routine),
not the whole catalog.

| Step | Do | Signal |
|------|----|--------|
| Supply | 30–50 listings across **both** catalogs (music + placements) with tags that discriminate | Browse returns a tight, relevant page for the beachhead query |
| Demand | 3–5 real YouTube channels connected and **verified** (`stats_source = 'platform_api'`, `can_buy_slots = true`) | A channel that wasn't yours |
| Free proof | Every free use renders attribution unmodified; channel reports where it ran (`POST /api/v1/usage` with `videoUrl`) | `GET /api/v1/usage` shows `organic_events` with `by_reporter` split |
| Paid proof | 1 self-serve slot bought (flat or CPM with cap), settled 60/30/10 on Arc, tracking code resolves (`/t/:code` → `/listings/:id`), delivery capped atomically | `slot.status` transitions + `spend_usdc` only from `slots.accrue`; never from the request body |

**In-app:** Browse — kind + tier filter, **channel picker** (personalizes ranking by ethos), free-text vibe search (`lo-fi night drive`), Supply kind toggle, Channels verify button, Usage reporter in Workspace.

**Seeded:** `npm run seed:marketplace` (and `seed:all` to do both) — idempotent service-layer seed that creates a coherent `lo-fi night drive / study / focus` slice (18 music + 14 placement listings, discriminating tags), backfills `listing_embeddings`, registers 4 demo channels (mock-verified in CI, `pending` in prod until `YOUTUBE_API_KEY`), and mints 1 paid slot + sponsored + organic usage proof. Browse is already personalized: `GET /api/v1/marketplace/search?channelId=&q=` re-ranks by channel ethos (semantic when pgvector is live, tag overlap in mock).

**Batch / script:** `npm run seed` still seeds the legacy demo catalog; `npm run seed:marketplace` / `npm run seed:all` are the beachhead primitives. Both call the service layer directly — no HTTP, works against PGlite and Neon alike.

**What not to claim**

- A high match count is not liquidity — liquidity is **logged uses**.
- A `mock`-sourced channel is not verified demand — `can_buy_slots` must be `true`.
- Channel-reported `usage_events` are not platform-verified delivery — always quote the `by_reporter` split.

Success (post-seed this is already true locally): ≥2 distinct ethos queries that each return ≥10 relevant listings; ≥1 verified external channel; ≥1 paid slot that settled and logged a usage with a video URL. Then widen the niche — add a second ethos (e.g. thriller tension or morning routine) rather than scattering tags.

**Prod note:** channels seed as `pending` when `YOUTUBE_API_KEY` is unset — the paid proof still runs by patching one channel to `verified` for the demo. In prod, verify a real YouTube surface and the demo slot's eligibility follows `can_buy_slots` (no bypass in app code).

Strategy: [STRATEGY.md](../STRATEGY.md) §6.
