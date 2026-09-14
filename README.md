# VERSIONS

Music & product placements for distribution channels — matched by ethos, free with attribution or paid as a sponsor slot, tracked and settled on Arc.

Channels (YouTube automation, radio-style feeds) browse a feed of **music + placements** — same primitive — pick what fits their ethos, and use it. Free use carries a generated attribution you render unmodified; paid placements are flat-fee or CPM with a tracking code, disclosure, and budget cap — self-serve. Thesis: [STRATEGY.md](./STRATEGY.md) · [POSITIONING.md](./POSITIONING.md).

**Live:** [versions.persidian.com](https://versions.persidian.com)  
**Repo:** [github.com/thisyearnofear/versions](https://github.com/thisyearnofear/versions)

## In 30 seconds

1. **Browse** — open [/discover](https://versions.persidian.com/discover), filter by kind/tag/budget, play a track or skim a product. Or paste a brief — the same matcher repoints at channel ethos.
2. **Supply** — [/submit](https://versions.persidian.com/submit): pick `music` (link an uploaded track) or `placement` (images + pitch). Choose free or set flat/CPM + cap. Live immediately under the blanket agreement; attribution + disclosure generated for you.
3. **Channels** — [/channels](https://versions.persidian.com/channels): connect a YouTube URL/handle/UC…, verify against the platform, get `can_buy_slots`.
4. **Paid** — buy a slot self-serve (budget, checkout on Arc → 60/30/10 supplier/channel/platform). Every slot mints a tracking code (`/t/:code` → listing). Serving stops atomically at the cap.
5. **Proof** — `GET /api/health/ready` + `GET /api/v1/usage` summary (with `by_reporter` split: `channel | platform_api | manual`).

Local, zero keys (mock adapters):

```bash
npm install && npm run db:push && npm run dev
```

Seed + demo supply (free music + paid CPM placement):

```bash
npm run seed            # legacy demo catalog (optional)
# Seed marketplace demo via the running app (or call the services in a one-off script)
```

Then `http://localhost:3000`. Full docs: [docs/README.md](./docs/README.md).

## Stack

Next.js 16 · Postgres (Neon) · Drizzle · NextAuth (wallet) · Wagmi / RainbowKit · Arc USDC · OpenRouter (LLM + embeddings) · YouTube Data API (channel verification)

## Commands

```bash
npm run dev          # local
npm test             # vitest
npm run verify       # typecheck + tests + lint (CI gate)
npm run build        # production image
npm run seed         # demo catalog
npm run check:arc    # live Arc probe
./scripts/deploy-remote.sh   # prod app deploy (git-only — see docs/deploy.md)
npm run db:prod:status       # prod DB state (read-only; run on VPS)
npm run db:prod:backup       # verified production backup (run on VPS)
npm run db:prod:restore-drill -- /absolute/path/to/backup.dump  # isolated recovery test
```

Env: copy `.env.example`. Omit keys → mock. `OPENROUTER_API_KEY`, Arc vars, and `YOUTUBE_API_KEY` (for verified channels; mock otherwise) go live. Never commit `.env`.
