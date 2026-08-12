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

The production standard is an explicit, reviewed `drizzle-kit push` operation.
It is intentionally separate from the app deploy so a schema diff is never
applied as a side effect of rebuilding the container.

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
