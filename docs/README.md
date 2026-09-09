# Docs

| Doc | What |
|-----|------|
| [../STRATEGY.md](../STRATEGY.md) | Why we win (moat, incumbents, wedge) |
| [../POSITIONING.md](../POSITIONING.md) | One-pager |
| [arc.md](./arc.md) | USDC, x402, ERC-8183/8004, App Kit |
| [primitive-api.md](./primitive-api.md) | Brief → license HTTP contract |
| [search.md](./search.md) | Discover, embeddings, pgvector |
| [guided-demo-and-billing.md](./guided-demo-and-billing.md) | Catalog provenance, guided demo, subscription and relayer seams |
| [beachhead.md](./beachhead.md) | Distribution-side adoption + usage instrumentation moat |
| [deploy.md](./deploy.md) | Git-only production deploy and guarded schema operations |

Agent conventions (mood tags, feed shape, NFT traces): [../AGENTS.md](../AGENTS.md).

## Loop

Channel registers → verifies (real reach via public API) → ethos embedded →
browses a feed of music + product placements → free use with attribution OR a
paid sponsor slot → attribution tracked + flat 3-way settlement on Arc.

## Routes

| Path | Role |
|------|------|
| `/discover` | Listings feed (primary) — ethos-matched `music` + `placement` listings |
| `/supervisor` | Channel workspace — shortlists, paid slots, treasury |
| `/submit` | Supplier upload — one flow, two kinds (music / product placement) |
| `/agents` | Ethos-fit review — per-channel verdicts |
| `/feed` | Published listings |
| `/auth/signin` | Connect + EIP-191 sign-in |
| `/api/health/ready` | Adapter mock/live flags |

Channel onboarding + verification lives in the channel workspace; paid slots
are created/accepted there and settle via Arc.

## Local

```bash
npm install
npm run db:push
npm run seed          # optional demo catalog
npm run verify        # typecheck + tests + lint (the CI gate)
npm run dev
```

`GET /api/health/ready` reports `arc` / `llm` / `embedding` mock flags.
Inference runs a provider fallback chain so one rate limit never silently
mocks the agents: LLM is Venice → HF Qwen → TokenRouter (DeepSeek) →
OpenRouter → mock; set `VENICE_API_KEY` (primary), `HF_QWEN_API_URL`,
`TOKENROUTER_API_KEY` + `TOKENROUTER_API_URL`, and/or `OPENROUTER_API_KEY`.
Embeddings stay single-provider to keep one vector space (OpenRouter by
default; Venice bge-m3 is opt-in via `VENICE_EMBED_ENABLE=1` + a
re-embed). Arc: `ARC_RPC_URL` + platform wallet key.
Embeddings backfill: `POST /api/v1/embeddings/backfill` (needs pgvector:
`npm run db:pgvector`).
