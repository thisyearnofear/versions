# Docs

| Doc | What |
|-----|------|
| [../STRATEGY.md](../STRATEGY.md) | Why we win (moat, incumbents, wedge) |
| [../POSITIONING.md](../POSITIONING.md) | One-pager |
| [arc.md](./arc.md) | USDC, x402, ERC-8183/8004, App Kit + slot settlement |
| [primitive-api.md](./primitive-api.md) | Marketplace HTTP contract (listings / channels / slots / usage) + legacy brief→license |
| [search.md](./search.md) | Browse, supply, matching, channel ethos |
| [guided-demo-and-billing.md](./guided-demo-and-billing.md) | Catalog provenance, usage proof, settlement safety |
| [delivery-ingestion.md](./delivery-ingestion.md) | Spec: platform-verified delivery (channel-reported → `platform_api`) |
| [beachhead.md](./beachhead.md) | How to get to liquidity |
| [deploy.md](./deploy.md) | Git-only production deploy, Grove uploads, Neon quota note, guarded schema ops |
| [architecture-split.md](./architecture-split.md) | Netlify UI + box API; Grove; GHCR pull-deploy |

Agent conventions (mood tags, feed shape, NFT traces): [../AGENTS.md](../AGENTS.md).

## Marketplace loop (dual catalog)

Supply lists a **music** track or a **placement** product (`POST /api/v1/listings`, live immediately, one blanket agreement) → **Channel** connects and verifies a distribution surface (`POST /api/v1/channels`, platform-pulled stats, `can_buy_slots` only when `verified`) → **Browse** surfaces either kind personalized to ethos (`GET /api/v1/marketplace/search?q=&channelId=`) → **Free** use renders attribution (`/listings/:id`, `/t/:code`) → **Paid** slot bought self-serve (`POST /api/v1/slots` → `/pay`, flat 60/30/10 on Arc, tracking code + disclosure, budget cap) → **Every use logged** (`POST /api/v1/usage`, channel-reported by default; `by_reporter` split visible) → settlement legs cap spend atomically.

Guests browse and read. Creating supply, connecting a channel, buying a slot, and logging usage require a wallet session. Free tier is the cold-start mechanism (see [../POSITIONING.md](../POSITIONING.md) — wedge vs primitive vs cold start); paid is ad infra (podcast-ad-slot simple). Beachhead is seeded locally with `npm run seed:marketplace` (idempotent) so browse already feels tight on the first query.

### Beachhead wedge (what to demo on day one)

One tight ethos where supply and demand already rhyme — `lo-fi night drive / study / focus` (18 music + 14 placement listings, discriminating tags) + 4 demo channels + 1 sold paid slot and its `usage_events` proof (see [beachhead.md](./beachhead.md)). The point is *logged uses*, not a high match count. Then widen to a second ethos (thriller tension / morning routine) instead of scattering tags.

## Routes

| Path | Role |
|------|------|
| `/discover` | **Browse** — music + placements matched to channel ethos |
| `/submit` | **Supply** — music ↔ placement toggle, tier/pricing/cap |
| `/channels` | **Channels** — connect + verify a distribution surface |
| `/listings/:id` | Public attribution page |
| `/placements/:slotId` | Paid placement detail + usage reporter |
| `/t/:code` | Tracking redirect → listing |
| `/legal/agreement` | Blanket ToS (versioned, stamped on every row) |
| `/api/health/ready` | Adapter mock/live flags (incl. `channelProbe`) |

Hosting split: [architecture-split.md](./architecture-split.md).

## Local

```bash
npm install
npm run db:push
npm run db:pgvector
npm run seed:marketplace   # beachhead slice: 32 listings + 4 channels, ethos-embedded, with a paid slot + usage proof
npm run verify        # typecheck + tests + lint (the CI gate)
npm run dev
```

`GET /api/health/ready` reports `arc` / `llm` / `embedding` / `channelProbe` mock flags.
Inference keeps a provider fallback chain for LLM (Venice → HF Qwen → TokenRouter → OpenRouter → mock); set `VENICE_API_KEY` / `HF_QWEN_API_URL` / `TOKENROUTER_API_KEY` + `TOKENROUTER_API_URL` / `OPENROUTER_API_KEY`. Channel verification needs `YOUTUBE_API_KEY` to reach `verified`; without it, onboarding still works but stays `pending` (mock source, cannot buy).
Arc: `ARC_RPC_URL` + platform wallet key. Embeddings backfill: `POST /api/v1/embeddings/backfill` (add `?scope=marketplace` or `?scope=all`, needs pgvector: `npm run db:pgvector`).
