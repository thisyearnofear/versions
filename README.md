# VERSIONS

Brief → ranked alternate takes → license, settled in USDC on Arc.

Supervisors paste a scene in plain English (no wallet). Three agents
(Production, Performance, Market) score the long tail by fit. Sign-in
to shortlist and license. We sell that **outcome**, not a similarity
API. Thesis: [STRATEGY.md](./STRATEGY.md) · [POSITIONING.md](./POSITIONING.md).

**Live:** [versions.persidian.com](https://versions.persidian.com)  
**Repo:** [github.com/thisyearnofear/versions](https://github.com/thisyearnofear/versions)

## Judges (Agentic Economy)

1. Open [Discover](https://versions.persidian.com/discover), paste a brief (or an example chip).
2. Expand **agent trace** — Production / Performance / Market + x402 if you paid to score.
3. Sign in (connect + signature). Shortlist or license a take.
4. Dashboard: settle the license (ERC-8183 job, ArcScan). Fund treasury via App Kit if needed.
5. `GET /api/health/ready` — Arc, LLM, embeddings should be live.

Local, zero keys (mock adapters):

```bash
npm install && npm run db:push && npm run seed && npm run dev
```

Then `http://localhost:3000`. Full docs: [docs/README.md](./docs/README.md).

## Stack

Next.js 16 · Postgres (Neon) · Drizzle · NextAuth (wallet) · Wagmi / RainbowKit · Arc USDC · OpenRouter (LLM + embeddings)

## Commands

```bash
npm run dev          # local
npm test             # vitest
npm run build        # production image
npm run seed         # demo catalog
npm run check:arc    # live Arc probe
./scripts/deploy-remote.sh   # prod app deploy (git-only — see docs/deploy.md)
npm run db:prod:status       # prod DB state (read-only; run on VPS)
npm run db:prod:backup       # verified production backup (run on VPS)
npm run db:prod:restore-drill -- /absolute/path/to/backup.dump  # isolated recovery test
```

Env: copy `.env.example`. Omit keys → mock. `OPENROUTER_API_KEY` and Arc vars go live. Never commit `.env`.
