# VERSIONS · Next.js (production architecture)

This is the production-grade rebuild of the VERSIONS Lepton Submission
Marketplace, ported from the vanilla Node.js + SQLite + browser-ESM
architecture at `../versions` to **Next.js 16.2** with **PostgreSQL**
(Neon serverless), **NextAuth v5** (wallet credentials), **Wagmi v2** +
**RainbowKit**, **Drizzle ORM**, and the **Vercel AI SDK**.

The vanilla project remains the working hackathon build. This project is the
strategic migration target.

## Why migrate

| Current limitation | Production fix |
| --- | --- |
| SQLite single-writer, single-server | Postgres (Neon serverless) |
| No SSR / no SEO | Server Components + RSC streaming |
| Imperative DOM, no component system | React 19 + Tailwind v4 |
| Wallet-only auth | NextAuth v5 wallet credentials + extensibility for email/OAuth |
| No real-time | SSE / WebSocket via route handlers |
| Single process | Edge + serverless adapters |

## Stack

- **Next.js** 16.2.9 (App Router, Turbopack, React 19.2)
- **TypeScript** 5, strict
- **Tailwind CSS** v4 with the VERSIONS design system (cream / ink / rust, Fraunces serif, JetBrains Mono)
- **Drizzle ORM** + `@neondatabase/serverless`
- **NextAuth v5** beta with `Credentials` provider for wallet signatures
- **Wagmi v2** + **RainbowKit** for wallet UX
- **Vercel AI SDK** (`ai`, `@ai-sdk/openai`) for the curator agents
- **Zod** for validation
- **Framer Motion** for kinetic transitions (parallax, scroll reveals)

## Build commands

```bash
npm install --legacy-peer-deps
npm run dev      # next dev .
npm run build    # next build . --experimental-build-mode compile
npm start        # next start .
npm run db:push  # drizzle-kit push (apply schema to Neon)
npm run db:studio
```

### Why `--experimental-build-mode compile`

Next.js 16.2.9 has a known Turbopack regression (workStore invariant) when
prerendering internal `/_global-error` and `/_not-found` routes during a
default `next build`. The `compile` build mode produces the same artifacts
but marks every route as **ƒ Dynamic — server-rendered on demand**, which is
the correct mode for an authenticated marketplace anyway.

The expected real-world deployment target is Vercel, where static prerendering
is not a hot path — every user view is personalised by wallet, role, and
playback state.

## Environment

Copy `.env.example` to `.env.local` and fill in:

```
DATABASE_URL=postgresql://...       # Neon pooled connection string
NEXTAUTH_SECRET=                    # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_WC_PROJECT_ID=          # WalletConnect Cloud project id (optional)
ARC_RPC_URL=https://...             # Arc testnet/mainnet RPC
ARC_PAYMENT_RECIPIENT=0x...
OPENAI_API_KEY=sk-...               # Curator agents
PINATA_API_KEY=...                  # IPFS audio uploads
```

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Brand-forward landing with 4-section nav |
| `/submit` | Submit a version (audio upload + metadata + 0.50 USDC fee) |
| `/curate` | Curator queue + scorecard + taste-graph radar |
| `/feed` | Published versions with mood/energy/tempo filters |
| `/discover` | A&R agent playlists with per-play micro-payments |
| `/api/health` | Service health probe |
| `/api/feed` | List published submissions |
| `/api/submissions` | List submissions (optionally filtered by artist) |
| `/api/auth/[...nextauth]` | NextAuth handler (wallet credentials) |

## Project layout

```
src/
├── app/                      # App Router
│   ├── api/                  # Route handlers
│   ├── curate/               # Curator queue page
│   ├── discover/             # A&R playlists page
│   ├── feed/                 # Published feed page
│   ├── submit/               # Submission form page
│   ├── globals.css           # Tailwind v4 design system
│   ├── layout.tsx            # Root layout
│   ├── not-found.tsx         # 404
│   ├── page.tsx              # Landing
│   └── providers.tsx         # Session + Wagmi + RainbowKit + Query
├── components/
│   └── SiteHeader.tsx        # Shared header + tab nav
└── lib/
    ├── config.ts             # Env helpers
    ├── db.ts                 # Neon + Drizzle client
    ├── schema.ts             # Drizzle schema (11 tables)
    ├── types.ts              # Shared TS types
    └── wagmi.ts              # Wagmi config (mainnet, base, baseSepolia, arbitrum, sepolia)
```

## Migration status

- [x] Next.js 16.2 project scaffold with App Router, Tailwind v4, design system
- [x] Drizzle schema for 11 tables (users, submissions, ratings, agent reviews, briefs, settlement, published, playlists, plays, listen events)
- [x] NextAuth v5 with wallet credentials
- [x] Wagmi v2 + RainbowKit providers
- [x] Landing page + 4 section pages + 4 API routes
- [x] Build succeeds with `--experimental-build-mode compile`
- [x] Dev server runs on `next dev .`
- [ ] Port `../versions/proxy/services/` (agents, submissions, curation, settlement, taste-graph) into `src/services/`
- [ ] Port `../versions/proxy/adapters/` (arc, llm) into `src/adapters/`
- [ ] Implement SSE route for live events
- [ ] Implement wallet-signed payment verification
- [ ] Add Drizzle migrations folder + first migration
- [ ] Audio upload → IPFS via Pinata
- [ ] Curator agent pipeline (Production, Performance, Market)
- [ ] A&R playlist generation
- [ ] Play-event micro-payment flow

## Known issues

1. **Turbopack `workStore` invariant** — see "Why `--experimental-build-mode compile`" above.
2. **Workspace root detection** — Next.js may pick up the parent
   `/Users/udingethe/package-lock.json` if you run `next dev` from outside
   this directory. The `npm` scripts use `next dev .` / `next build .` to
   pin the project root.
