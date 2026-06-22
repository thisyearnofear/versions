# VERSIONS · Next.js (production architecture)

This is the production-grade rebuild of the VERSIONS Lepton Submission
Marketplace, ported from the vanilla Node.js + SQLite + browser-ESM
architecture at `../versions` to **Next.js 16.2** with **PostgreSQL**
(Neon serverless), **NextAuth v5** (wallet credentials), **Wagmi v2** +
**RainbowKit**, **Drizzle ORM**, and the **Vercel AI SDK**.

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
npm install
npm run dev      # next dev .
npm run build    # next build . --experimental-build-mode compile
npm start        # next start .
npm test         # vitest (114 tests)
npm run db:push  # drizzle-kit push
npm run db:studio
```

### Why `--experimental-build-mode compile`

Next.js 16.2.9 has a known Turbopack regression (workStore invariant) when
prerendering internal `/_global-error` and `/_not-found` routes during a
default `next build`. The `compile` build mode produces the same artifacts
but marks every route as **ƒ Dynamic — server-rendered on demand**, which is
the correct mode for an authenticated marketplace anyway.

## Environment

Copy `.env.example` to `.env` and fill in:

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
| `/api/events` | SSE stream for real-time feed + queue updates |
| `/api/v1/feed` | List published submissions (filtered) |
| `/api/v1/submissions` | Create / list submissions |
| `/api/v1/submissions/queue` | Curation queue |
| `/api/v1/submissions/[id]/verify-payment` | Verify on-chain payment |
| `/api/v1/submissions/[id]/claim` | Claim a submission for curation |
| `/api/v1/submissions/[id]/rate` | Submit a rating |
| `/api/v1/submissions/[id]/reviews` | Agent reviews for a submission |
| `/api/v1/submissions/[id]/brief` | Placement brief |
| `/api/v1/versions/[id]` | Single published version |
| `/api/v1/ar/playlists` | A&R playlists |
| `/api/v1/ar/playlists/generate` | Generate new playlists via LLM |
| `/api/v1/ar/play` | Record a play (micro-payment) |
| `/api/v1/artists/[wallet]/versions` | Artist dashboard — versions |
| `/api/v1/artists/[wallet]/earnings` | Artist dashboard — earnings |
| `/api/v1/arc/info` | Arc chain info (mock or live) |
| `/api/auth/[...nextauth]` | NextAuth handler (wallet credentials) |

## Project layout

```
src/
├── app/                      # App Router
│   ├── api/                  # Route handlers
│   │   ├── v1/               # Versioned API surface
│   │   └── events/           # SSE endpoint
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
│   ├── audio/                # AudioPlayer
│   ├── cover/                # Cover SVG rendering
│   ├── curation/             # CurateConsole, TasteGraph, etc.
│   ├── discovery/            # DiscoverView (A&R playlists)
│   ├── feed/                 # FeedView
│   ├── submit/               # SubmitForm
│   ├── ui/                   # Shared UI (Toast, etc.)
│   ├── wallet/               # Wallet connection components
│   └── SiteHeader.tsx        # Shared header + tab nav
├── services/
│   ├── submissions.ts        # Create, verify payment, list queue
│   ├── curation.ts           # Claim, rate, publish
│   ├── feed.ts               # List published versions
│   ├── settlement.ts         # Fee split + settlement legs
│   ├── agents.ts             # AI agent auto-review
│   ├── ar.ts                 # A&R playlist generation
│   └── taste-graph.ts        # Rating aggregation
├── adapters/
│   ├── arc.ts                # Arc blockchain adapter
│   └── llm.ts                # LLM adapter (agent reviews)
├── lib/
│   ├── api-client.ts         # Typed fetch client
│   ├── config.ts             # Env helpers
│   ├── db.ts                 # Neon + Drizzle client
│   ├── event-bus.ts          # In-process pub/sub (SSE backing)
│   ├── ipfs.ts               # Pinata IPFS upload
│   ├── logger.ts             # Structured logging
│   ├── multipart.ts          # Multipart form parsing
│   ├── schema.ts             # Drizzle schema (12 tables)
│   ├── types.ts              # Shared TS types
│   ├── utils.ts              # escapeHtml, cn, etc.
│   ├── validation.ts         # Zod rating validation
│   └── wagmi.ts              # Wagmi config
```

## Migration notes

The migration from the vanilla Node.js proxy to Next.js is complete.
The old `versions-next/` scaffolding directory has been removed.
For the pre-migration project history, see commits before `7b05e333`.
### Remaining work

- [ ] WalletConnect project ID (`NEXT_PUBLIC_WC_PROJECT_ID`) — required for RainbowKit wallet connections
- [ ] Production deployment config (Vercel, Railway, or Docker)

## Known issues

1. **Turbopack `workStore` invariant** — see "Why `--experimental-build-mode compile`" above.
2. **No `.env.example`** — the project uses a `.env` file but there's no checked-in template. Create one to document all required vars.
