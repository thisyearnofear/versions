# Production deploy

Live: [versions.persidian.com](https://versions.persidian.com)  
Host: `nuncio-vultr` · `/home/linuxuser/versions`

**Only path:** `git push origin master` → `./scripts/deploy-remote.sh`

Never `scp` / `rsync` source onto the server. Secrets stay in gitignored
`.env` files.

## Laptop

```bash
git push origin master
./scripts/deploy-remote.sh
```

Override host/dir: `./scripts/deploy-remote.sh my-host` or
`VERSIONS_REMOTE_DIR=/path ./scripts/deploy-remote.sh`.

## Server

```bash
cd /home/linuxuser/versions && ./scripts/deploy.sh
```

`deploy.sh` requires a clean tree and `.env`, pulls `--ff-only`, rebuilds,
then gates on `/api/health/live` and `/api/health/ready`. It deliberately does
**not** modify the database schema. Emergency: `DEPLOY_ALLOW_DIRTY=1`. Prefer
`git reset --hard origin/master` instead.

## Database schema (production)

Production predates Drizzle's `__drizzle_migrations` ledger. It also contained
a historically partial application of release migration `0003`; the missing
catalog-provenance and settlement-lease changes were completed and verified on
2026-08-12. **Do not run `npm run db:migrate` against production.** Without a
verified ledger baseline, it would replay the full historical chain and can
fail on existing columns or leave another partial schema change.

Run these commands on `nuncio-vultr` from `/home/linuxuser/versions` in a
maintenance window. They never print `DATABASE_URL`; when it is not exported,
the helper reads it only in-process from the running `versions` container.

```bash
# 1. Read-only: confirms database connectivity and whether a Drizzle ledger exists.
npm run db:prod:status

# 2. Creates and validates a timestamped custom-format dump in
#    /home/linuxuser/backups/versions using a pg_dump client matching the server.
npm run db:prod:backup

# 3. Shows every SQL statement and requires an interactive confirmation.
#    Review the diff; never pass --force in production.
VERSIONS_DB_APPLY=1 npm run db:prod:push

# 4. Verify schema state and runtime readiness after the confirmed change.
npm run db:prod:status
curl -sf http://127.0.0.1:3000/api/health/ready
curl -sf https://versions.persidian.com/api/health/ready
```

### Applied schema changes — `0008_nasty_calypso.sql` and `0009_furry_colonel_america.sql`

These additive changes were applied in production on 2026-08-17 after the
pre-change backup `versions-before-schema-20260817T002054Z.dump` was verified:

```sql
ALTER TABLE "agent_reviews" ADD COLUMN "detail" jsonb;      -- AgentDetail block
ALTER TABLE "agent_reviews" ADD COLUMN "fit_score" integer; -- 1-10 sync-fit per agent

CREATE TABLE "outbox_events" (
  "id" text PRIMARY KEY NOT NULL,
  "topic" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "processed_at" timestamp
);
CREATE INDEX "idx_outbox_unprocessed" ON "outbox_events" USING btree ("processed_at","created_at");
```

The `agent_reviews` columns are nullable, so existing rows were unaffected and
no backfill was required. `outbox_events` is the replayable copy of the
canonical settlement/tip/play receipt stream; cron and SSE reconnect drains
replay receipts produced while a client was offline, with consumer deduplication.

During the same reconciliation, production's existing `ar_playlist_tracks` data
was checked (7 rows, no duplicate `(playlist_id, version_id)` pairs) and the
code-defined constraint was added without truncating data:

```sql
ALTER TABLE "ar_playlist_tracks"
  ADD CONSTRAINT "uq_playlist_track" UNIQUE ("playlist_id", "version_id");
```

Post-change verification passed: `npm run db:prod:status`, the local and public
`/api/health/ready` checks, both `agent_reviews` columns, the `outbox_events`
table, and its index. The Drizzle migration ledger remains intentionally absent;
do not run `npm run db:migrate` against production. A post-change recovery drill
is still required against a new post-change backup (see below).

`db:prod:push` always passes `--strict --verbose`; it refuses to run until
`VERSIONS_DB_APPLY=1` is explicitly set. A server/client PostgreSQL-major
mismatch makes `pg_dump` unusable, so the backup helper uses the official
`postgres:<server-major>` client image and verifies the dump with `pg_restore`.

## Recovery drill

Archive readability is not a recovery test. After every schema change and at
least monthly, restore the newest post-change archive into an isolated,
disposable PostgreSQL + pgvector container:

```bash
# Use the exact archive printed by db:prod:backup.
npm run db:prod:restore-drill -- /home/linuxuser/backups/versions/<backup>.dump
```

The drill never gives the temporary database network access or connects it to
the application network. It restores with `--exit-on-error`, verifies
`pgvector`, compares the restored public schema and constraints plus key
license/catalog row counts against the live source, then removes the temporary
container. The first successful post-schema drill ran on 2026-08-12 against
`versions-before-schema-20260812T172055Z.dump` (91,548 bytes), restoring the
expected 8 release columns, 2 provenance constraints, and the then-current
3/7/2 license/published-version/feedback row counts. The earlier
pre-release archive also restored, but is not a current-schema recovery point.

Do not fabricate rows in `__drizzle_migrations`. Establishing a ledger baseline
requires a separately reviewed, hash-verified migration plan. Until then, keep
using the guarded status → backup → strict push workflow above.

**Drizzle-orm 1.0.0-rc.4 + drizzle-kit 1.0.0-rc.4 (2026-08-17).**
Both packages are pinned to the same RC tag — the rc needs the
matching drizzle-orm (the `1.0` series is a coordinated dual release).
`push --explain` against the live DB reports `No changes detected`
for our schema, so the upgrade is **net-zero** for prod: no
DDL is proposed, no migration-table upgrade is needed, and the
`0.31.10` introspection bugs (unique-constraint column order,
FK-identifier truncation) are gone. The previous column-order
workarounds in `schema.ts` were reverted; the constraint column
order in the file now matches what Postgres stores.

The rc.4 `drizzle()` API dropped the `schema` init arg:
```ts
// before: drizzle(pool, { schema })
// after:  drizzle({ client: pool })
```
Both `src/lib/db.ts` (node-postgres) and `tests/helpers/db.ts`
(PGlite) follow this. Per-query `.from(table)` keeps working
unchanged — the schema namespace was only needed at init for
RQB v1 (`db.query.*`), which we do not use.

**Migration table upgrade is intentionally deferred.** Our prod
`drizzle.__drizzle_migrations` still has the v0 columns
(`id, hash, created_at`); the v1 upgrade adds `name, applied_at`
and backfills existing rows. We only use `push`, which works
against either format, so the upgrade can wait. When we adopt
`generate` / `migrate` later, run `drizzle-kit up` on a non-prod
DB to validate the upgrade before applying it on prod.

### Post-deploy verification — 2026-08-17 @ `14dde36e`

The dual pre-release upgrade shipped to prod at `14dde36e`
(`revert(schema): restore unique-constraint column order after rc.4
upgrade`). Prod verification, run against
`https://versions.persidian.com`:

| Probe | Result |
|-------|--------|
| `GET /api/health/ready` | 200 `ready`; live (non-mock): `arc` (chain `0x4cef52`, signer configured, platform balance 18 060 200 micro-USDC), `llm` (openrouter / `gpt-oss-20b:free`), `embedding` (openrouter), `gateway`, `erc8183` (`0x0747…4583`). Mock/unset: `erc8004` (registry address set, adapter mock), `ipfs` (not configured), `ccmixter` (not configured) |
| `POST /api/cron/sweep` (with `x-cron-secret`) | 200; retention report clean, outbox 0 unprocessed |
| `POST /api/cron/sweep` (without secret) | 401 — auth guard live |
| `GET /api/v1/discover/brief?brief=warm piano vibraphone instrumental` | 200; 17 results (incl. Speck — "Lost Roamin'") — real-mode brief-search path (pg Pool + drizzle rc.4 + semantic ranking) exercised end-to-end |
| `GET /`, `/discover`, `/api/v1/feed`, `/api/v1/vitals` | all 200 |

Final state:

| Item | State |
|------|-------|
| drizzle-orm / drizzle-kit | `1.0.0-rc.4`, pinned exact (coordinated dual release) |
| Migration format | v3 folders (`drizzle/<ts>_<name>/{migration.sql,snapshot.json}`) |
| `push --explain` against prod | "No changes detected" ✅ |
| Schema workarounds | Reverted — column orders in `schema.ts` match prod exactly |
| FK-rename churn | None — the 0.31.10 identifier-truncation bug is gone in rc.4 |
| Unique-constraint phantom | None — rc.4 preserves declared column order |
| Prod schema | Untouched (pure code change, no DDL applied) |

The `0.31.10` column-order and FK-truncation bugs that drove the
prior workaround commits (`305a761`, `f4011ad`) are fixed in
`1.0.0-rc.4`. The pre-change backup
`versions-before-schema-20260817T002054Z.dump` remains the safe
restore point if anything ever drifts.

**Open items (carried forward, not regressions):**

- `SENTRY_DSN` — paste it when error reporting should go live; empty stays inert.
- Migration table v0→v1 upgrade — intentionally deferred; we only use `push`, which works against either format. Run `drizzle-kit up` on a non-prod DB when we adopt `generate` / `migrate`.
- `ar_playlist_tracks` drift — resolved in the earlier session (constraint enforced, rows distinct).

**Demo note (Arc Demos & Meetup, 2026-08).** The money path works
end-to-end on prod and the catalog now holds real licensable tracks:
two ElevenLabs-generated instrumentals (*Warm Keys at Dusk*,
*Redline Pursuit*) were ingested live via `npm run ingest:tracks`
(reviews by Venice, published `live`, embeddings backfilled), and a
full license → ERC-8183 job → USDC settlement cycle was verified
on-chain. The guided-demo ccMixter takes (`catalogSource: "demo"`)
still return `license_availability.status: "demo_preview"` and cannot
create a binding license. Licensing requires a signed-in wallet
session — guests can search and record verdicts, nothing more.
Test artifacts (smoke-test and settle-test submissions) were purged
from the DB and uploads dir after verification.

## Operational constraints

**Single instance — do not scale out horizontally.** The in-process
EventBus (SSE fan-out), TTL cache, in-memory rate limiter, outbox drain
mutex, and the settlement sweeper are all per-process. Running two app
containers would split the live event stream and double the sweep ticks.
To scale out, first move the bus to a broker (Upstash pub/sub or Redis),
the cache/limiter to Upstash Redis (env already supported by the limiter),
and the outbox claim into the DB (`claimed_at` column or
`pg_advisory_xact_lock`).

**Database.** The app uses a real `pg` Pool (`src/lib/db.ts`), not the
Neon HTTP driver — persistent pooled connections, real
`db.transaction()` blocks, no 1000-row result cap. Point `DATABASE_URL`
at the Neon **pooler** endpoint (`…:6432`) rather than the direct
endpoint for best throughput; tune `DB_POOL_MAX` (default 10) if you see
`connectionTimeoutMillis` (10s) failures under load.

**Sweep cron (retention + outbox).** `POST /api/cron/sweep` drives the
settlement sweeper, the authoritative outbox drain, and retention pruning
(at most once per 30 min). Retention windows are env-overridable days:
`RETENTION_OUTBOX_DAYS` (14, processed rows only),
`RETENTION_TELEMETRY_DAYS` (30), `RETENTION_SEARCHES_DAYS` (90),
`RETENTION_AUDIT_DAYS` (365 — x402 proofs, play/listen events). Money
state (`settlement_legs`, `licenses`, unprocessed outbox rows) is never
pruned.

**Protect the sweep endpoint.** Set `CRON_SECRET` in the server `.env` and
have the cron job send it as the `x-cron-secret` header:

```bash
curl -sf -X POST -H "x-cron-secret: $CRON_SECRET" \
  https://versions.persidian.com/api/cron/sweep
```

Until `CRON_SECRET` is set the route fails open (with a startup warning) so
an existing crontab keeps ticking; the moment it is set, requests without
the matching header are rejected 401. After setting it, update the crontab
line to include the header — otherwise the sweep silently stops.

**Error monitoring.** Sentry is env-gated: set `SENTRY_DSN` in the server
`.env` to enable (`instrumentation.ts` inits the SDK; wallet addresses are
redacted from events before they leave the process). Empty = inert.
`SENTRY_ORG`/`SENTRY_PROJECT` only if the build should upload source maps.

**CC demo catalog (optional).** Free Music Archive's API is shut down;
ccMixter's Query API 2.0 is the live, keyless, CC-licensed source. Ingest
real CC-BY tracks into the demo catalog (illustrative only, never
licensable):

```bash
CCMIXTER_API_URL=https://ccmixter.org/api/query \
  npx tsx scripts/ingest-ccmixter.ts 10
```

Without `CCMIXTER_API_URL` the script runs in deterministic mock mode
(no network). Files are Referer-protected, so they are downloaded
server-side (with a ccMixter referer) into the uploads dir; browsers
cannot stream them cross-origin. Idempotent: re-runs skip existing tracks
and backfill missing `version_embeddings` rows (same adapter resolution as
the server registry) so the tracks are searchable via the semantic
(pgvector) path, not just the structured-tag fallback. Adapter status
(`mock`/`configured`) is reported under `providers.ccmixter` in
`GET /api/health/ready`.

**Admin vitals.** `/admin/vitals` (API: `GET /api/v1/vitals?hours=24`) shows
the money-path vitals: supervisor search latency p50/p95 (client-observed,
sampled from logged brief searches — signed-in and guest device-id),
outbox depth + oldest backlog age, sweeper tick health, and the last
retention report. Aggregates only — no wallets or briefs.

**Demo prep — Arc Demos & Meetup (2026-08).** Three gates blocked a
live on-chain license/settlement demo on prod: (1) the only catalog was
guided-demo ccMixter ingest (`catalogSource: 'demo'` → `409
DEMO_CATALOG_ONLY` on license creation); (2) licensing requires a
signed-in supervisor wallet (guests 401); (3) the platform treasury
held ~18 USDC while license fees were $75–250. Fixes shipped:

- **License fees → $1.00** across all usage types (`src/lib/pricing.ts`,
  testnet demo pricing; revert for production economics).
- **Demo faucet** `POST /api/v1/demo/faucet {address}` — sends a fixed
  1.00 USDC from the platform treasury to fund a throwaway artist
  wallet (fee + gas). Rate-limited via `generalLimiter`; amount is a
  server constant, not caller-controlled.
- **LiveDemoButton live mode** — the homepage one-button loop now
  detects live Arc (`/api/v1/arc/info` → `mock: false`), funds the
  throwaway wallet via the faucet, pays the real submission fee
  on-chain (viem ERC-20 transfer → platform wallet), waits for
  confirmation, and verifies with the real tx hash. Mock mode keeps
  the synthetic-hash path. Review-polling timeout raised 60 s → 180 s
  for live LLM agents.
- **Helper scripts**: `npm run demo:signin` (pre-authenticate a
  supervisor session via NextAuth credentials; saves cookie to
  `.demo/cookies.txt`, wallet key to `.demo/wallet.json` — both
  gitignored) and `npm run ingest:tracks` (bulk-ingest local audio
  through the real artist pipeline: submit → faucet-fund → pay fee →
  agent review → publish as `live` catalogSource → embedding
  backfill). Real artist submissions publish with the schema default
  `catalogSource: 'live'` and are licensable; only cc-catalog/seed
  ingests are `'demo'`.
- **LLM provider fallback chain** — agent reviews walk an ordered
  chain (Venice → HF Qwen → TokenRouter → OpenRouter) before ever
  falling back to mock, after OpenRouter's free tier (50 req/day)
  silently mocked every review. `resolveLlmChain()` builds the chain
  from env (`VENICE_API_KEY`, `HF_QWEN_API_URL`, `TOKENROUTER_API_KEY`
  + `TOKENROUTER_API_URL`, `OPENROUTER_API_KEY`); each failed provider
  is logged with its error. Venice is the configured primary; Qwen's
  keyless public endpoint and the free-tier OpenRouter model stay as
  backups, so OpenRouter never needs funding.
- **ERC-8183 settle race fixed** — `setBudget`/`approve` were
  fire-and-forget, so `fund` ran before the allowance was mined,
  reverted silently, and the job stuck in `Open` until `submit`
  reverted and the route mock-fell-back. Every step now waits for a
  mined receipt and throws on on-chain revert; the settle route logs
  the failure instead of swallowing it. Verified live: job `180457`
  reached on-chain `Completed` with real create/complete/payment txs.

Pre-demo checklist: deploy these changes (`git push origin master &&
./scripts/deploy-remote.sh`), ingest 2–3 real tracks
(`npm run ingest:tracks -- --dir <folder>`), pre-auth
(`npm run demo:signin`), and verify `/api/v1/demo/faucet` + the
LiveDemoButton live path on prod. Treasury math at $1: as of
`ba14093b` the platform wallet holds ~5.5 USDC (18 USDC minus the
verification settlements + faucet grants), covering ~5 demo license
settle cycles — top up from the Arc testnet faucet before a long
demo run.

### Post-deploy verification — 2026-08-17 @ `1d1bd517`

LLM fallback chain + ERC-8183 settle fix shipped. Verification
against `https://versions.persidian.com`:

| Probe | Result |
|-------|--------|
| `GET /api/health/ready` | `llm: provider=venice, model=venice-uncensored, fallbacks=[hfqwen, openrouter]`; arc/erc8183/gateway live; embedding still openrouter (vector space unchanged) |
| Venice JSON compliance | all three agent prompts return parseable reviews incl. full `placement_brief` shape; market-agent test verified locally before deploy |
| Fallback walk | broken primary URL → chain advances to next provider (verified locally); only when every provider fails does it mock, with all errors logged |
| Fresh ingest | `scripts/ingest-my-tracks.ts` → submit → faucet → fee → 3 Venice reviews → published `live` in ~7 s |
| License + settle | license `be26cd07…` (job `180457`): create/fund/submit/complete all mined (`0x1`), job status on-chain `Completed`, royalty USDC transfer confirmed on-chain, `payment_mock: false` |

Env additions (server `.env`): `VENICE_API_KEY`, `HF_QWEN_API_URL`,
`TOKENROUTER_API_KEY` (TokenRouter activates once `TOKENROUTER_API_URL`
is also set — its base URL is service-specific and was not published).

**Open items:** TokenRouter base URL (DeepSeek backup stays dormant
until it is supplied); rotate the Venice/TokenRouter keys after the
demo (they passed through chat); CI lockfile is out of sync
(`zod@3.25.76` missing from `package-lock.json` after the drizzle
rc.4 / Circle App Kit bumps) — `npm ci` fails on GitHub while local
`npm install` reports up-to-date; deploys are unaffected.

## Secrets

| Where | File |
|-------|------|
| Laptop | `.env.local` |
| Server | `/home/linuxuser/versions/.env` (`docker compose` `env_file`) |

Env-only (no code): edit server `.env`, then
`docker compose up -d --force-recreate app`.

## Smoke

```bash
curl -sf https://versions.persidian.com/api/health/ready
curl -sf -X POST https://versions.persidian.com/api/v1/embeddings/backfill
```

Monitor: `scripts/monitor-versions.sh` (cron). Rollback: `git revert` on
master, then `./scripts/deploy-remote.sh`.
