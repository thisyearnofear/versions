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
then gates on `/api/health/live` and `/api/health/ready`. Emergency:
`DEPLOY_ALLOW_DIRTY=1`. Prefer `git reset --hard origin/master` instead.

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
