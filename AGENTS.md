<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Product positioning (context for agents)

Before touching product or UI code, hold the strategic frame. Full thesis:

- `STRATEGY.md` — source of truth (moat mechanics, incumbent disincentive)
- `POSITIONING.md` — distilled one-pager for external stakeholders

The short version:

- **We are** the autonomous curation + per-play settlement layer for music
  licensing. Positioned as a **wedge built on one agentic primitive**: an
  *autonomous brief → licensed-track pipeline* (three AI agents rank the
  long tail of alternate takes by fit + per-play micro-settlement on Arc USDC).
- **Supervisor-first.** The primary user is the music supervisor/A&R; the
  primary action is searching the catalog by brief. Search is guest-friendly —
  no wallet required. The consumer catalog/feed/tips are beachhead and
  distribution, **not** the business model.
- **Keep the outcome we sell clear in the UI.** Lead with the supervisor
  job (brief → ranked, license-ready tracks); treat the agent economy and
  wallet as the proof/rail underneath, not the headline. Don't regress the
  supervisor-first framing or put the wallet back at the front door.

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

## Build & test commands

```bash
npm test              # vitest — 362 tests (359 unit + 3 integration)
npm run build         # next build . --experimental-build-mode compile
npx tsc --noEmit      # typecheck only
npx eslint src/ tests/ --max-warnings 0  # lint (pre-existing warnings exist)
npm run db:push       # drizzle-kit push (schema → DB)
npm run db:pgvector   # enable pgvector + create version_embeddings table
npm run db:rename-briefs  # rename legacy placement_briefs columns
npm run db:purge:preview  # dry-run legacy brief purge
npm run db:purge:apply    # apply legacy brief purge
```

## Mock-first architecture

All external adapters fall back to deterministic mock mode when their
env vars are absent. The full demo loop (submit → pay → review →
publish → tip) runs with zero external dependencies. Check mock status
via `GET /api/health/ready` — it reports `arc.mock`, `llm.mock`,
`embedding.mock`, `gateway.mock`, and `ipfs.configured`.

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
