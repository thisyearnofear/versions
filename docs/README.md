# Docs

| Doc | What |
|-----|------|
| [../STRATEGY.md](../STRATEGY.md) | Why we win (moat, incumbents, wedge) |
| [../POSITIONING.md](../POSITIONING.md) | One-pager |
| [arc.md](./arc.md) | USDC, x402, ERC-8183/8004, App Kit |
| [primitive-api.md](./primitive-api.md) | Brief → license HTTP contract |
| [search.md](./search.md) | Discover, embeddings, pgvector |
| [guided-demo-and-billing.md](./guided-demo-and-billing.md) | Catalog provenance, guided demo, subscription and relayer seams |
| [beachhead.md](./beachhead.md) | Ground-truth labels + benchmark |
| [deploy.md](./deploy.md) | Git-only production deploy and guarded schema operations |

Agent conventions (mood tags, feed shape, NFT traces): [../AGENTS.md](../AGENTS.md).

## Loop

Artist submits (0.50 USDC) → three agents review in parallel → publish + split settlement → supervisor searches by brief → license as an ERC-8183 job → Arc USDC.

Guests search free. Shortlist and license need a wallet session.

## Routes

| Path | Role |
|------|------|
| `/discover` | Brief search (primary) |
| `/supervisor` | Shortlist, licenses, treasury, agent stack |
| `/submit` | Artist upload |
| `/agents` | Live review queue |
| `/feed` | Published catalog |
| `/auth/signin` | Connect + EIP-191 sign-in |
| `/api/health/ready` | Adapter mock/live flags |

## Local

```bash
npm install
npm run db:push
npm run seed          # optional demo catalog
npm run dev
```

`GET /api/health/ready` reports `arc` / `llm` / `embedding` mock flags.
Inference: `OPENROUTER_API_KEY`. Arc: `ARC_RPC_URL` + platform wallet key.
Embeddings backfill: `POST /api/v1/embeddings/backfill` (needs pgvector:
`npm run db:pgvector`).
