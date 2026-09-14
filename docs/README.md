# Docs

| Doc | What |
|-----|------|
| [../STRATEGY.md](../STRATEGY.md) | Why we win (moat, incumbents, wedge) |
| [../POSITIONING.md](../POSITIONING.md) | One-pager |
| [arc.md](./arc.md) | USDC, x402, ERC-8183/8004, App Kit + slot settlement |
| [primitive-api.md](./primitive-api.md) | Marketplace HTTP contract (listings / channels / slots / usage) + legacy brief→license |
| [search.md](./search.md) | Browse, supply, matching, channel ethos |
| [guided-demo-and-billing.md](./guided-demo-and-billing.md) | Catalog provenance, usage proof, settlement safety |
| [beachhead.md](./beachhead.md) | How to get to liquidity |
| [deploy.md](./deploy.md) | Git-only production deploy and guarded schema operations |

Agent conventions (mood tags, feed shape, NFT traces): [../AGENTS.md](../AGENTS.md).

## Marketplace loop (dual catalog)

Supply lists a **music** track or a **placement** product (`POST /api/v1/listings`, live immediately, one blanket agreement) → **Channel** connects and verifies a distribution surface (`POST /api/v1/channels`, platform-pulled stats, `can_buy_slots` only when `verified`) → **Browse** surfaces either kind against ethos (`GET /api/v1/listings` + `GET /api/v1/discover/brief`) → **Free** use renders attribution (`/listings/:id`, `/t/:code`) → **Paid** slot bought self-serve (`POST /api/v1/slots` → `/pay`, flat 60/30/10 on Arc, tracking code + disclosure, budget cap) → **Every use logged** (`POST /api/v1/usage`, channel-reported by default; `by_reporter` split visible) → settlement legs cap spend atomically.

Guests browse and read. Creating supply, connecting a channel, buying a slot, and logging usage require a wallet session. Free tier is the wedge; paid is ad infra (podcast-ad-slot simple).

## Routes

| Path | Role |
|------|------|
| `/discover` | **Browse** — unified music + placements feed, brief search, usage ticker |
| `/submit` | **Supply** — music ↔ placement toggle, tier/pricing/cap, agreement click-through |
| `/channels` | **Channels** — connect + verify a distribution surface |
| `/supervisor` | Workspace — cases/shortlists/licenses + library tab + usage reporter |
| `/listings/:id` | Public attribution page |
| `/t/:code` | Tracking redirect → listing |
| `/legal/agreement` | Blanket ToS (versioned, stamped on every row) |
| `/agents` | Live review / system proof (demoted) |
| `/feed` | Redirect → `/supervisor?tab=library` |
| `/api/health/ready` | Adapter mock/live flags (incl. `channelProbe`) |

## Local

```bash
npm install
npm run db:push
npm run db:pgvector
npm run verify        # typecheck + tests + lint (the CI gate)
npm run dev
```

`GET /api/health/ready` reports `arc` / `llm` / `embedding` / `channelProbe` mock flags.
Inference keeps a provider fallback chain for LLM (Venice → HF Qwen → TokenRouter → OpenRouter → mock); set `VENICE_API_KEY` / `HF_QWEN_API_URL` / `TOKENROUTER_API_KEY` + `TOKENROUTER_API_URL` / `OPENROUTER_API_KEY`. Channel verification needs `YOUTUBE_API_KEY` to reach `verified`; without it, onboarding still works but stays `pending` (mock source, cannot buy).
Arc: `ARC_RPC_URL` + platform wallet key. Embeddings backfill: `POST /api/v1/embeddings/backfill` (needs pgvector: `npm run db:pgvector`).
