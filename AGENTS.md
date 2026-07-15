<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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

## Build & test commands

```bash
npm test              # vitest — 333 tests (330 unit + 3 integration)
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
