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
npm test         # vitest (142 tests)
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
| `/agents` | Agent monitor — watch AI agents review the queue in real time |
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
│   │   ├── events/           # SSE endpoint
│   │   └── x402/             # nanopayment tip route (x402 + Circle Gateway)
│   ├── agents/               # Agent monitor dashboard
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
│   ├── curation/             # AgentMonitor, TasteGraph, etc.
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
│   ├── gateway.ts            # Circle Gateway adapter (x402 nanopayments)
│   └── llm.ts                # LLM adapter (agent reviews)
├── lib/
│   ├── api-client.ts         # Typed fetch client
│   ├── cache.ts              # In-process TTL cache w/ event-bus invalidation
│   ├── config.ts             # Env helpers
│   ├── db.ts                 # Neon + Drizzle client
│   ├── event-bus.ts          # In-process pub/sub (SSE backing)
│   ├── ipfs.ts               # Pinata IPFS upload
│   ├── logger.ts             # Structured logging
│   ├── multipart.ts          # Multipart form parsing
│   ├── rate-limit.ts         # Per-IP token-bucket rate limiter
│   ├── schema.ts             # Drizzle schema (12 tables)
│   ├── transaction.ts        # Logical transaction wrapper (compensating rollback)
│   ├── types.ts              # Shared TS types
│   ├── utils.ts              # escapeHtml, cn, etc.
│   ├── validation.ts         # Zod rating validation
│   ├── wagmi.ts              # Wagmi config
│   └── x402.ts               # EIP-712 challenge + verify for nanopayment tips
```

## Migration notes

The migration from the vanilla Node.js proxy to Next.js is complete.
The old `versions-next/` scaffolding directory has been removed.
For the pre-migration project history, see commits before `7b05e333`.
### Remaining work

- [ ] WalletConnect project ID (`NEXT_PUBLIC_WC_PROJECT_ID`) — required for RainbowKit wallet connections
- [ ] Production deployment config (Vercel, Railway, or Docker)

## Publish pipeline hardening

The settlement pipeline has been hardened against double-publish races and
partial-publish state. Key invariants:

- **`uq_legs_submission_wallet_role`** — Postgres unique index on
  `settlement_legs(submission_id, recipient_wallet, recipient_role)`. The
  composite key is required because the same wallet can legitimately appear
  in multiple roles (e.g. the artist is both the `musicbrainz` recipient
  and the `platform` fallback). DDL is mirrored in `tests/helpers/db.ts`.
- **`PublishLegIncompleteError`** — named error class thrown by
  `publishSubmission` when the leg-count guard detects a partial insert.
  Carries `submissionId`, `expected`, `actual`, and `actualLegIds` so
  upstream callers (`curation.ts submitRating`, `agents.ts
  reviewSubmission`) can detect it via `instanceof` and return a
  structured `{ ok: false, error, code: 'publish_legs_incomplete' }`
  response.
- **`expectedLegCountFor(curatorCount)`** — single source of truth for
  the leg-count formula (`curatorCount + 2 = 1 platform + 1
  musicbrainz`). Used by the under-count guard, the over-count warning
  log, and `settlement.splitFee`'s minimum-count check so the "+2"
  invariant can't drift between call sites.
- **`transactional()` wrapper** — logical transaction for Neon HTTP.
  Services that make multi-step DB writes (rating → count → publish →
  leg) wrap their work in `transactional()` so a failure rolls back
  partial state via compensating actions instead of leaving orphan rows.
- **Over-count soft warning** — when orphan legs with `(wallet, role)`
  combos the build doesn't generate are present, the publish still
  succeeds but `log.warn` emits `extraLegIds` / `extraLegKeys` (via set
  difference against the expected keys) so stale rows are traceable
  for cleanup.

## Nanopayments (x402 + Circle Gateway)

The artist dashboard exposes a **Tip** button that lets a listener send a
sub-cent USDC nanopayment to any artist on Arc. The flow uses the
[x402 protocol](https://docs.x402.org) with **Circle Gateway** as the
batched settlement layer:

1. **Client → Server (no payment proof):** `POST /api/x402/tip` with
   `{artistWallet, amountUsdc}`. The route returns **HTTP 402** with a
   `PAYMENT-REQUIRED` header (Base64 JSON) containing the EIP-712
   challenge — the offer the client must sign.
2. **Client signs the offer** with `useSignTypedData` from wagmi. The
   challenge carries the actual Arc `chainId` (not hardcoded to 1) so
   the wallet signs on its current chain.
3. **Client → Server (with payment proof):** Retry the same `POST` with
   a `PAYMENT-SIGNATURE` header (Base64 JSON `{scheme, signature,
   offer}`). The server:
   - decodes and re-validates the challenge (same `payTo`, `amount`,
     `puid`, `validUntil`)
   - recovers the tipper wallet from the EIP-712 signature
   - persists the proof to `x402_proofs` (replay-protected by a
     unique index on `puid`)
   - submits the tip to **Circle Gateway** (`POST {GATEWAY_API_URL}/v1/tips`)
   - emits a `tip-received` event on the bus for real-time dashboards

### Amounts and the lepton primitive

USDC has 6 decimals. The smallest unit — **1 lepton** = `$0.000001` =
`1` micro-USDC — is the floor of the Gateway. Presets on the TipButton:

- **1 lepton** (`$0.000001`) — literally the smallest settleable unit
- **1¢** (`$0.01`) = 10,000 leptons
- **5¢** (`$0.05`) = 50,000 leptons
- **25¢** (`$0.25`) = 250,000 leptons
- **Custom** — any decimal string, per-tip cap is `$1.00`

### Environment variables

```
GATEWAY_API_URL=https://gateway.circle.com   # optional; mock mode if absent
GATEWAY_API_KEY=...                         # optional; Bearer token
GATEWAY_BATCH_INTERVAL_MS=500               # hint for the batcher
```

The Gateway adapter is **mock-first** (same pattern as the arc
adapter): with no `GATEWAY_API_URL` set, `submitTip` returns a
deterministic hash and tags the response with `mock: true` so the
demo and tests are reproducible.

### Files

- `src/lib/x402.ts` — EIP-712 domain/types, `verifyProof`, `offerMatches`,
  `parseAmountToMicroUsdc`, `formatMicroUsdc`, base64 header codecs
- `src/adapters/gateway.ts` — mock-first Gateway client (`submitTip`,
  `getInfo`, `getTipStatus`)
- `src/app/api/x402/tip/route.ts` — the two-shot route
- `src/components/wallet/TipButton.tsx` — the client UI
- `src/lib/format.ts` — `fmtLeptons` (sub-cent formatter)
- `src/lib/event-bus.ts` — `'tip-received'` event
- `src/lib/schema.ts` — `x402_proofs` table
- `tests/unit/x402.test.ts` — verifyProof with a real viem test wallet,
  Gateway mock, route 402/200/401/409

## Known issues

1. **Turbopack `workStore` invariant** — see "Why `--experimental-build-mode compile`" above.
2. **No `.env.example`** — the project uses a `.env` file but there's no checked-in template. Create one to document all required vars.
