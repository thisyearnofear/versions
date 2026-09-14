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

**In-app:** Browse filters (kind/tag/budget), Supply kind toggle, Channels verify button, Usage reporter in Workspace.

**Batch / script:** `npm run seed` still seeds the legacy demo catalog; marketplace seed is a thin one-off that calls `listings.create` / `channels.register` against the running app or test DB.

**What not to claim**

- A high match count is not liquidity — liquidity is **logged uses**.
- A `mock`-sourced channel is not verified demand — `can_buy_slots` must be `true`.
- Channel-reported `usage_events` are not platform-verified delivery — always quote the `by_reporter` split.

Success: ≥2 distinct ethos queries that each return ≥10 relevant listings; ≥1 verified external channel; ≥1 paid slot that settled and logged a usage with a video URL. Then widen the niche.

Strategy: [STRATEGY.md](../STRATEGY.md) §6.
