# VERSIONS

Music & product placements for distribution channels — matched by ethos, free with attribution or paid as a sponsor slot, tracked and settled on Arc.

Channels (YouTube automation, radio-style feeds) browse a feed of **music + placements** — same primitive — pick what fits their ethos, and use it. Free use carries a generated attribution you render unmodified; paid placements are flat-fee or CPM with a tracking code, disclosure, and budget cap — self-serve. Thesis: [STRATEGY.md](./STRATEGY.md) · [POSITIONING.md](./POSITIONING.md).

**Live:** [versions.persidian.com](https://versions.persidian.com) — 32 listings · 5 verified channels · 1 slot settled for real on Arc (2026-09-17, runbook: [docs/demo-runbook.md](./docs/demo-runbook.md))
**Repo:** [github.com/thisyearnofear/versions](https://github.com/thisyearnofear/versions)

## In 30 seconds

1. **Browse** — open [/discover](https://versions.persidian.com/discover), filter by kind/tag/budget, play a track or skim a product. Or paste a brief — the same matcher repoints at channel ethos.
2. **Supply** — [/submit](https://versions.persidian.com/submit): pick `music` (link an uploaded track) or `placement` (images + pitch). Choose free or set flat/CPM + cap. Live immediately under the blanket agreement; attribution + disclosure generated for you.
3. **Channels** — [/channels](https://versions.persidian.com/channels): connect a YouTube URL/handle/UC…, verify against the platform, get `can_buy_slots`.
4. **Paid** — buy a slot self-serve (budget, checkout on Arc → 60/30/10 supplier/channel/platform). Every slot mints a tracking code (`/t/:code` → listing). Serving stops atomically at the cap.
5. **Proof** — `GET /api/health/ready` + `GET /api/v1/usage` summary (with `by_reporter` split: `channel | platform_api | manual`).

Local, zero keys (mock adapters):

```bash
npm install && npm run db:push && npm run db:pgvector && npm run dev
```

Seed the beachhead marketplace slice (idempotent — 32 listings + channels with
ethos embeddings, one paid slot + usage proof):

```bash
npm run seed:marketplace   # beachhead slice (or seed:all for legacy + marketplace)
npm run seed               # legacy demo catalog only (optional)
```

Then `http://localhost:3000`. Without keys everything runs mocked: mock Arc
hashes, mock LLM reviews/embeddings, mock (`pending`) channels that can't buy.
Full docs: [docs/README.md](./docs/README.md).

## Stack

Next.js 16 · Postgres (Neon, pgvector for semantic ranking) · Drizzle · NextAuth (wallet) · Wagmi / RainbowKit · Arc USDC · LLM fallback chain (Venice → HF Qwen → TokenRouter → OpenRouter) + OpenRouter embeddings · YouTube Data API (channel verification)

Claim discipline: "free with attribution" = render `attribution_text` unmodified; "verified" reach = `stats_source = 'platform_api'`; "settled" = a `slot_leg` on Arc. Usage aggregates always show the `by_reporter` split (`channel | platform_api | manual`) — channel-reported delivery is never "verified".

## Commands

```bash
npm run dev          # local
npm test             # vitest
npm run verify       # typecheck + tests + lint (CI gate)
npm run build        # next build . --experimental-build-mode compile
npm run seed:marketplace  # beachhead demo slice (idempotent)
npm run seed:all     # legacy catalog + marketplace slice
npm run check:arc    # live Arc probe
./scripts/deploy-remote.sh   # prod app deploy (git-only — see docs/deploy.md)
npm run db:prod:status       # prod DB state (read-only; run on VPS)
npm run db:prod:backup       # verified production backup (run on VPS)
npm run db:prod:restore-drill -- /absolute/path/to/backup.dump  # isolated recovery test
```

Env: copy `.env.example`. Omit keys → mock (`GET /api/health/ready` reports
`arc` / `llm` / `embedding` / `channelProbe` flags). Going live needs
`OPENROUTER_API_KEY` (or Venice/HF/TokenRouter keys) for real matching,
`YOUTUBE_API_KEY` for verified channels, and `ARC_RPC_URL` + platform wallet
key for real settlement. Never commit `.env`.
