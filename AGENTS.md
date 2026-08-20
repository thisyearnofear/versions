<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Product positioning (context for agents)

Before touching product or UI code, hold the strategic frame. Full thesis:

- `STRATEGY.md` — source of truth (moat mechanics, incumbent disincentive)
- `POSITIONING.md` — distilled one-pager for external stakeholders

The short version:

- **We are** the consent, curation, and settlement layer for **derivative
  music versions**. Wedge: *one rights-controlled song → a portfolio of
  artist-authorized versions (alt takes today; approved AI derivatives as
  the growth path) → ranked against real briefs → paid placements*, with
  per-version attribution and micro-settlement on Arc USDC. We are **not**
  a generation platform and **not** a consumer remix feed — Spotify/UMG
  own the on-platform fan-cover lane since May 2026. We own the
  cross-platform commercial conversion rail they won't build.
- **Supervisor-first on the demand side.** The primary *buyer* is the music
  supervisor/A&R; the primary action is searching versions by brief.
  Search is guest-friendly — no wallet required. Artists are the
  supply-side partners (opt-in consent programs), not the business model.
  The consumer catalog/feed/tips are beachhead and distribution, **not**
  the business model.
- **Keep the outcome we sell clear in the UI.** Lead with the supervisor
  job (brief → ranked, license-ready versions); treat the agent economy and
  wallet as the proof/rail underneath, not the headline. Don't regress the
  supervisor-first framing or put the wallet back at the front door.
- **Claim discipline.** "Pre-cleared" applies only to versions inside an
  authorized-version program; legacy/demo catalog results stay labeled
  rights-unverified. "Settled" applies only to uses VERSIONS tracks and
  controls. Agents currently score metadata, not audio — don't claim they
  listened until audio-aware evaluation ships.

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

## BriefSearchRow consent lineage and version families

`BriefSearchRow` has three pilot additions that enable the authorized-version
wedge:

- **`family_id?: string`** — groups alternate takes / versions of the same
  song. DiscoverView groups results by `family_id`; the best match renders as
  the primary row, siblings are expandable via a chevron toggle.
- **`program?: { programId, programStatus, rightsHolderWallet, ... }`** —
  populated when `catalog.source === 'authorized'`. Contains the full
  consent program data: consent_policy, splits, lineage, audio_features,
  agent_scores. Renders as a `ConsentLineagePanel` below the match row in
  DiscoverView.
- **`audio_features: AudioFeatures | null`** on submissions — extracted at
  publish time via the 3-tier pipeline (API → chromagram → ffmpeg).
  Included in agent prompts for defensible audio-aware scoring.

The `ConsentLineagePanel` component (src/components/supervisor/ConsentLineage.tsx)
renders: consent → lineage → approval → audio features → agent scores →
settlement waterfall. When `BriefSearchRow.program` is present, the panel
is rendered below the MatchRow.

### Wire-format gotchas (learned the hard way)

- **Semantic search must LEFT JOIN `version_embeddings`.** Authorized
  pilot versions seeded before embedding backfill have no embedding row;
  an inner JOIN silently drops them from `/discover/brief`. Use
  `COALESCE(similarity, 0)` + `ORDER BY ... NULLS LAST` so they rank by
  structured-tag score instead.
- **Never write `sql\`col = ANY(${array})\`` in Drizzle.** It renders as
  `ANY(($1, $2))` — a row constructor, not an array — and throws at
  runtime. Use `inArray(col, values)` from `drizzle-orm`. This bug was
  latent in `fetchProgramData` and only fired once authorized versions
  actually surfaced (empty arrays never executed the query).
- The semantic path returns raw snake_case rows; keep `family_id` in the
  SELECT list or version-family grouping silently breaks for authorized
  rows.

## Information architecture (three doors)

The nav is organized around jobs, not modules — three doors:

- **Search** (`/discover`) — the supervisor job: brief → ranked takes.
- **Workspace** (`/supervisor`) — cases, shortlists, licenses, AND the
  library as tabs (`?tab=library` embeds `FeedView`; decisions is the
  default tab). `/feed` is a redirect to `/supervisor?tab=library` —
  keep it alive for deep links, don't rebuild it as a page.
- **For Artists** (`/submit`) — the supply side.

`/agents` (system proof) is demoted out of the primary rail. When adding
a surface, ask which door it belongs to before adding a fourth.

Per-wallet dashboards (`/artists/[wallet]`, `/curators/[wallet]`,
`/listeners/[wallet]`) are NOT nav items — they're reached in context:

- **Artist dashboard** — linked from the `/submit` success state
  ("Track your release case →"). It's the artist half of the wedge
  (Release Cases + earnings), so keep it reachable, just not in the rail.
- **Curator dashboard** — RETIRED. Human curation was replaced by the
  three AI agents (only writer of curator ratings is `src/services/agents.ts`),
  so the page was vestigial and contradicted the "three distinct agent
  lenses" story. `/curators/[wallet]` redirects to `/agents`; the
  `/api/v1/curators/*` read endpoints remain. Don't rebuild the page.
- **Listener dashboard** — still live (plays/reputation/badges accrue via
  the AR flow) but currently orphaned; decide per-surface whether to link
  it in context or retire it.

## Case thread (placement case as conversation)

The supervisor job (brief → licensed track) renders as ONE continuous
surface: the durable placement case appears in-thread on `/discover`
(`CaseThread` in `src/components/discovery/CaseThread.tsx`), collapsed
to a status line, expanding into a chronological conversation — brief
as the supervisor's opening message, every durable `case_events` row
as a one-line agent reply.

Conventions when touching this surface:

- **Cases are keyed on the BASE brief.** Refinements ("darker", "no
  vocals") re-run the search inside the SAME case — iteration, not a
  new placement. `openCase` is idempotent per (supervisor, brief) via
  the partial unique index on non-terminal statuses.
- **Events are the source of truth for the thread.** Add new agent
  voice lines in `eventMessage()` in CaseThread; unknown kinds fall
  back to a cleaned label, never raw JSON. Record new events in
  `src/services/cases.ts` alongside the state transition that caused
  them — the thread must never narrate state it can't prove.
- **Refresh is key-bump + gentle poll + live SSE.** The parent bumps
  `threadRefreshKey` on search/shortlist/license; while expanded the
  thread polls every 10s; and the thread subscribes to the shared SSE
  settlement stream so a split leg landing on Arc for a shortlisted
  take flashes in-thread instantly (transient — the durable `settled`
  case event is the permanent record; the outbox stays source of
  truth). Don't add a second SSE route here.
- **Guest-friendly.** Cases work wallet-free (guest pseudo-wallet via
  `resolveSupervisorIdentity`); the thread renders for any searcher.

## A/B family compare (FamilyCompare)

Version families with 2+ takes render a `FamilyCompare` transport
(`src/components/discovery/FamilyCompare.tsx`) under the family group:
the best match (A) and first sibling (B) share ONE player — play/pause,
one position bar, and an A/B switch that preserves playback position so
the supervisor hears the same moment under both takes. This is the
authorized wedge's decision moment; keep it position-preserving and
self-contained (two `<audio>` elements, no global state).

## Durable receipt outbox (outbox_events)

The in-process EventBus is fire-and-forget — it can drop a receipt if the
process dies between "money moved" and "SSE read". The canonical receipt stream
(`settlement-event`: split legs, tip batches, play payouts, license settlement)
is therefore emitted via `emitDurable(topic, payload)` in `src/services/outbox.ts`,
which writes a replayable row to `outbox_events` AND broadcasts immediately.
`drainOutbox()` (so the receipt is at-least-once) runs on the cron sweep and on
SSE reconnect (throttled in-process for the hot path); consumers re-fetch and
dedupe. The cron tick also runs `pruneRetention()` (env-tunable windows,
max once / 30 min; never touches money tables or unprocessed rows). See
docs/deploy.md → "Operational constraints" for the single-instance
requirement this design assumes.

Rules: use `emitDurable` for anything a user pays for / is paid for; keep
`emit` for pure ephemeral UX ticks (throttled typewriter/reveal visuals); never
treat the outbox as the source of truth for money state (that stays in the
settlement / license tables); keep `outbox_events` mirrored in
`tests/helpers/db.ts` when the schema changes.

## Build & test commands

```bash
npm test              # vitest
npm run typecheck     # tsc --noEmit (typecheck only)
npm run verify        # typecheck + tests + lint (the CI gate)
npm run build         # next build . --experimental-build-mode compile
npx eslint src/ tests/ --max-warnings 0  # strict lint (see CI note)
npm run db:push       # drizzle-kit push (schema → DB)
npm run db:pgvector   # enable pgvector + create version_embeddings table
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

## Service registry

Services are accessed via `services()` from `src/lib/services.ts`. The
registry is a singleton (cached on first call). It exposes:
`submissions`, `curation`, `feed`, `settlement`, `agents`, `ar`,
`tasteGraph`, `embeddings`, and `config` (mock flags, upload dir, etc.).

## Integration tests

Integration tests live in `tests/integration/` and call services
directly (not via HTTP). They use the same PGlite test DB as unit
tests but don't mock the service registry — they exercise the full
service chain. The `version_embeddings` table uses TEXT (not vector)
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
