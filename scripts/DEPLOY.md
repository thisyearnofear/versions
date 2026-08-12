# Production deploy — VERSIONS

**Single path:** git push → `git pull --ff-only` on the server → `docker compose up -d --build`.

Do **not** scp/rsync application source into the server checkout. That causes drift from `origin/master` and makes rollbacks unreliable.

## From your laptop

```bash
# 1. Commit + push to origin/master
git push origin master

# 2. Deploy (runs preflight + remote pull + rebuild + health checks)
chmod +x scripts/deploy-remote.sh scripts/deploy.sh
./scripts/deploy-remote.sh
```

Default SSH host: `nuncio-vultr`. Override:

```bash
./scripts/deploy-remote.sh my-vps-host
VERSIONS_REMOTE_DIR=/home/linuxuser/versions ./scripts/deploy-remote.sh
```

## On the server directly

```bash
cd /home/linuxuser/versions
./scripts/deploy.sh
```

## What the deploy script checks

| Step | Purpose |
|------|---------|
| `.env` exists | Runtime secrets present (never in git) |
| Clean working tree | Fails if server has uncommitted edits (unless `DEPLOY_ALLOW_DIRTY=1`) |
| `git fetch` + `pull --ff-only` | No merge commits; refuses diverged history |
| `docker compose up -d --build` | Rebuild image from pulled commit |
| `/api/health/live` | Process up (poll up to 90s) |
| `/api/health/ready` | Providers OK; warns if Arc degraded |

## Secrets hygiene

- **Server only:** `/home/linuxuser/versions/.env` (gitignored, loaded by `docker compose`)
- **Local only:** `.env.local` / `.env` (gitignored)
- **Never:** commit keys, docker build-args for secrets, or scp `.env` into git-tracked paths

Rotate keys in OpenRouter / wallet providers in `.env` on the server, then:

```bash
docker compose up -d --force-recreate app
```

No rebuild required for env-only changes.

## Post-deploy smoke

```bash
curl -sf https://versions.persidian.com/api/health/ready | jq .data.providers
curl -sf https://versions.persidian.com/api/v1/embeddings/backfill
```

## Monitoring

`scripts/monitor-versions.sh` — cron-friendly; restarts container after 3 failed `/api/health/live` checks. Install on the server:

```bash
* * * * * bash $HOME/versions/scripts/monitor-versions.sh
```

## Rollback

```bash
cd /home/linuxuser/versions
git log -3 --oneline
git checkout <previous-sha>
./scripts/deploy.sh   # DEPLOY_ALLOW_DIRTY=1 if you had to reset dirty scp state
git checkout master   # return to branch tip when ready
```

Prefer `git revert` on master + `./scripts/deploy-remote.sh` for auditable rollbacks.
