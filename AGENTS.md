<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Product positioning (context for agents)

Before touching product or UI code, hold the strategic frame. Full thesis:

- `STRATEGY.md` — source of truth (moat mechanics, incumbent disincentive)
- `POSITIONING.md` — distilled one-pager for external stakeholders

The short version:

- **We are** the matching, attribution, and settlement layer for
  **distribution channels**. Wedge: *one unified listing primitive
  (music + product placements) → matched to a channel's ethos →
  used free with attribution or paid as a sponsor slot → tracked →
  settled flat 60/30/10 on Arc USDC.* Model: **NCS** (free-with-
  attribution wedge, paid gate as the business). We are **not** a
  generation platform, **not** a per-track licensing desk, and **not**
  a consumer remix feed. We own the cross-channel commercial conversion
  rail incumbents won't build.
- **Two catalogs, one primitive.** A listing is a slot in a feed,
  matched by ethos, free or paid — whether the inventory is a track or
  a product. Don't rebuild them as two products.
- **Free tier is the wedge, paid is the business.** The free tier is
  distribution/adoption and the data flywheel; paid ("ad infra") must
  feel as easy as buying a podcast ad slot, not a sync negotiation.
- **Verified reach only.** A channel's subscriber/view numbers come
  from the platform API — self-reported reach is never accepted and
  never unlocks `can_buy_slots`. Mock stays `pending`; it can populate
  a demo but never a paid slot.
- **Keep the outcome we sell clear in the UI.** Lead with Browse →
  pick → use/buy; treat the agent economy and wallet as the proof/rail
  underneath, not the headline. Don't regress the channel-first framing
  or put the wallet back at the front door.
- **Claim discipline.** "Free with attribution" means the generated
  `attribution_text` must be rendered unmodified; "verified" reach
  means `stats_source = 'platform_api'`; "settled" means a `slot_leg`
  on Arc. Aggregates over `usage_events` must show the `by_reporter`
  split — never launder `channel`-reported delivery into "verified."

## Mood-tag wire-format convention

Read-side envelope fields in `src/lib/api-client.ts` can arrive in
two shapes — a JSON-stringified string array OR a Drizzle jsonb
round-tripped JS array. The 4-arm union is exposed as:

```ts
export type MoodTagsEnvelope = string | string[] | null | undefined;
```

**Always route through `parseMoodTags(raw)` in `src/lib/format.ts`**
before reaching for `.length` / `.map` / `deriveValence(...)` /
direct `JSON.parse(...)`. Unpadded accesses fail typecheck by design
— this catches the same bug pattern (silently dropping the
string-shape branch) that escaped AgentMonitor, CuratorDashboard,
and DiscoverView in prior rounds. If you ever narrow the union,
update `tests/unit/api-client-envelope.test.ts` first — the contract
lock there fails typecheck otherwise.

### Outer-vs-inner convention

- **Outer-optional** fields declare as `?: MoodTagsEnvelope`. The
  `?` adds `| undefined` to the union; harmless duplication, mirrors
  repo style.
- **Inner** fields inside an outer-optional block declare as
  `: MoodTagsEnvelope` (no `?`) so "field missing" (whole outer
  block absent / array empty) stays distinct from "value
  undefined" on a present inner field.

Write-side fields (`RatingInput.mood_tags`, `Playlist.mood`,
`SubmissionMetadata.mood`) stay single-typed because writers always
emit canonical shapes; touch only when changing the write path.

## Feed wire-shape convention (camelCase → snake_case)

Drizzle rows are camelCase (`submissionId`, `coverSvg`) but the UI
contract for feed rows is snake_case (`submission_id`, `cover_svg`).
`/api/v1/feed` emits camelCase, so **all feed-row consumption must
route through `normalizeFeedRow(raw)` in `src/lib/api-client.ts`**,
which accepts either shape and returns canonical snake_case
`FeedRow`s. `getFeed` already applies it; server components that
call the feed service directly (e.g. `src/app/feed/page.tsx`) must
apply it themselves. Skipping it reproduces the bug class where
covers render as "···" placeholders and React logs duplicate-key
warnings (every row keyed `undefined`).

## AgentDetail wire convention (per-agent verdicts + sync-fit)

Every agent verdict carries a per-agent differentiated block, `AgentDetail`,
defined **once** in `src/lib/types.ts`. The adapter emits it, the agent service
tolerantly parses + persists it, `normalizeReviewRow` maps it, and the /agents
UI consumes it. Keep these in sync when touching any one:

```ts
export interface AgentDetail {
  fit_score: number;    // 1-10 sync-fit as judged by THIS agent
  metric: number;        // 0-10 headline metric for this agent's focus
  metric_label: string;   // "mix clarity" | "vocal delivery" | "placement recall"
  note: string;           // one-line expert note
}
```

The three agents must render as **distinct lenses** (mix/mastering → delivery/feel
→ placement recall), never "one model asked three times". When an agent or verdict
field changes, update all of: `agent_reviews.detail` in `src/lib/schema.ts` (jsonb
`AgentDetail`), the mock template in `src/adapters/llm.ts`, the tolerant parser in
`src/services/agents.ts`, `normalizeReviewRow` in `src/lib/api-client.ts`, the
`agent_verdict` SSE event in `src/lib/event-bus.ts`, and the /agents card in
`src/components/curation/AgentMonitor.tsx`. Legacy rows without `detail` /
`fit_score` must keep grading normally — gate UI rendering on field presence.

## Information architecture (three doors only)

The product is the marketplace wedge — three doors, nothing else in nav:

- **Browse** (`/discover`) — `MarketplaceBrowse`: music + placements matched to channel ethos.
- **Supply** (`/submit`) — list a track or a product (kind toggle; blanket agreement).
- **Channels** (`/channels`) — connect YouTube, verify reach; verified unlocks paid slots.

Also public: `/listings/:id` (attribution), `/placements/:slotId`, `/t/:code`, `/legal/agreement`.

**Deleted (do not rebuild):** `/agents`, `/supervisor`, `/feed`, `/cases`, `/artists`,
`/listeners`, `/curators`, `/admin`, DiscoverView briefs/licenses, tips, economy SSE UI,
AR/listener surfaces. Services that still exist in `src/services/*` for settlement/publish
internals are not product doors — see [docs/architecture-split.md](docs/architecture-split.md).

## Interface & surface discipline

Before touching UI, read [docs/interface.md](docs/interface.md) — it owns the
marketplace read: surface contracts, the guest-first onboarding ladder, card/
badge component grammar, and the banned-word list (`supervisor`, `brief`,
`license`, `agent`, `shortlist`, `curator`, `listener`). Non-negotiables:

- **Inventory before manifesto, price before prose.** Every entry surface states
  what's on the shelf (counts, price band, that free-with-credit exists) before it
  explains the thesis.
- **Relevance before identity.** Guests get a channel-shaped result with no
  account. Ask for sign-in at persistence and at money, never at first value.
- **One primary action per viewport** (`.btn-primary`); everything else is a
  secondary/ghost button.
- **No listing ends in a clipboard.** A use must leave the visitor holding the
  asset + credit line, and the kit persists.
- Claim discipline still governs the look: `verified` / `platform_api` /
  `settled` / `by_reporter` / `#ad` render exactly as specified — never soften
  them for visual neatness. Orphaned legacy-thesis components must be deleted
  or remounted, never left mounted-but-stale.

## Durable receipt outbox (outbox_events)

The in-process EventBus is fire-and-forget — it can drop a receipt if the
process dies between "money moved" and a consumer read. Money-adjacent
receipts are emitted via `emitDurable(topic, payload)` in `src/services/outbox.ts`,
which writes a replayable row to `outbox_events` AND broadcasts immediately.
`drainOutbox()` runs from `runSweep()` / `POST /api/cron/sweep` (primary) and
optionally from legacy hooks — prefer cron once the UI is off-box.
`pruneRetention()` is env-tunable; never touches money tables or unprocessed
outbox rows. See docs/deploy.md → "Operational constraints".

Rules: use `emitDurable` for anything a user pays for / is paid for; keep
`emit` for pure ephemeral UX ticks; never treat the outbox as the source of
truth for money state; keep `outbox_events` mirrored in `tests/helpers/db.ts`
when the schema changes.

## Build & test commands

```bash
npm test              # vitest
npm run typecheck     # tsc --noEmit (typecheck only)
npm run verify        # typecheck + tests + lint (the CI gate)
npm run build         # next build . --experimental-build-mode compile
npx eslint src/ tests/ --max-warnings 0  # strict lint (see CI note)
npm run db:push       # drizzle-kit push (schema → DB)
npm run db:pgvector   # enable pgvector + create version_embeddings + marketplace embedding tables
npm run db:rename-briefs  # rename legacy placement_briefs columns
npm run db:purge:preview  # dry-run legacy brief purge
npm run db:purge:apply    # apply legacy brief purge
```

CI (`.github/workflows/ci.yml`) hard-gates on typecheck + tests. The lint step
is **non-blocking** until the pre-existing `react-hooks/set-state-in-effect`
errors are cleared — do not reintroduce them, and new code should lint clean.

## Mock-first architecture

All external adapters fall back to deterministic mock mode when their
env vars are absent. The full demo loop (submit → pay → review →
publish → tip) runs with zero external dependencies. Check mock status
via `GET /api/health/ready` — it reports `arc.mock`, `llm.mock`,
`llm.provider`, `embedding.mock`, `embedding.provider`, `gateway.mock`,
and `ipfs.configured`.

## Marketplace search (ethos-personalized)

Browse ranking is now personalized: `GET /api/v1/marketplace/search?q=&channelId=&kind=&tier=`.

- **Input:** free-text `q` (vibe) and/or `channelId` (ethos). `q` and channel ethos combine —
  `q=lo-fi night drive` refines the channel vector.
- **Vector space:** listings + channels share one pgvector space (512 via
  `listing_embeddings` / `channel_embeddings`, text via `buildListingEmbedText` /
  `buildChannelEmbedText` in `src/lib/catalog-embed-text.ts`).`embeddings` backfills both;
  new rows fire-and-forget an embedding at creation (`listings`/`channels` routes) so
  browse ranks without an extra backfill.
- **Ranking:** semantic (cosine vs `listing_embeddings`, 70%) + tag overlap (30%) →
  `mode: semantic`, else tag overlap → `mode: tag`, else recency → `mode: recent`.
  Mock/PGlite have no pgvector, so they degrade gracefully to tag.
  Each row carries `fit_score` + `why_fits` citations; the UI shows them inline.
- **Backfill:** `POST /api/v1/embeddings/backfill?scope=marketplace` (or `all`).
  Beachhead demo data: `npm run seed:marketplace` (or `seed:all`) is idempotent and also
  embeds + mints one paid slot + usage proof so the paid side is already sellable.

## Service registry

Services are accessed via `services()` from `src/lib/services.ts`. The
registry is a singleton (cached on first call). It exposes:
`submissions`, `curation`, `feed`, `settlement`, `agents`, `ar`,
`tasteGraph`, `embeddings`, `marketplace`, `channels`, `listings`, `slots`, `usage`, and `config` (mock flags, upload dir, etc.).

## Integration tests

Integration tests live in `tests/integration/` and call services
directly (not via HTTP). They use the same PGlite test DB as unit
tests but don't mock the service registry — they exercise the full
service chain. The `*_embeddings` tables (pgvector in prod) use TEXT (not vector)
in PGlite since pgvector isn't available.


## Node built-in imports in API routes (security rule)

**Never use dynamic `await import(...)` for Node built-ins** (`crypto`,
`fs`, `path`, `os`, etc.) inside `src/app/api/` route handlers. Always
use static top-level imports:

```ts
// GOOD — static, traceable
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// BAD — causes @vercel/nft to trace the entire project root,
// leaking .git/, .env, data/uploads/ into the serverless bundle
const crypto = await import('crypto');
```

The ESLint config enforces this (`no-restricted-syntax` on
`ImportExpression` in `src/app/api/**`). The `postbuild` script
(`scripts/audit-nft-traces.sh`) also hard-fails if `.git`, `.env`, or
`data/uploads` appear in any `.nft.json` trace.

## Production deploy (hard rule)

Live: `https://versions.persidian.com` on `nuncio-vultr`.
**Git is the only way source reaches the server.**

```bash
git push origin master
./scripts/deploy-remote.sh
```

Do not `scp` / `rsync` application source. Do not leave the server tree
dirty. Env-only: edit server `.env`, then
`docker compose up -d --force-recreate app`.

Runbook: `docs/deploy.md`. Docs hub: `docs/README.md`.
