# Production deploy — VERSIONS

Live: [versions.persidian.com](https://versions.persidian.com)  
Host: `nuncio-vultr` · checkout: `/home/linuxuser/versions`

**Single path:** commit → `git push origin master` → `./scripts/deploy-remote.sh`

That script checks local `master` matches `origin/master`, SSHs to the
box, and runs `scripts/deploy.sh` (ff-only pull → docker rebuild →
live + ready health gates).

**Never copy application source onto the server** (`scp`, `rsync`,
editor-over-SSH). That drifted the checkout from `origin/master` and
broke rollbacks. Secrets stay in gitignored `.env` files only.

## From your laptop (default)

```bash
git push origin master
./scripts/deploy-remote.sh
```

SSH host defaults to `nuncio-vultr`. Override:

```bash
./scripts/deploy-remote.sh my-vps-host
VERSIONS_REMOTE_DIR=/home/linuxuser/versions ./scripts/deploy-remote.sh
DEPLOY_BRANCH=master ./scripts/deploy-remote.sh
```

## On the server (same script, no laptop)

```bash
cd /home/linuxuser/versions
./scripts/deploy.sh
```

## What `deploy.sh` checks

| Step | Purpose |
|------|---------|
| `.env` exists | Runtime secrets present (never in git) |
| Clean working tree | Fails if the server has uncommitted edits |
| `git fetch` + `pull --ff-only` | No merge commits; refuses diverged history |
| `docker compose up -d --build` | Image built from the pulled commit |
| `/api/health/live` | Process up (poll up to 90s) |
| `/api/health/ready` | Providers OK; warns if Arc is degraded |

Emergency only: `DEPLOY_ALLOW_DIRTY=1 ./scripts/deploy.sh` — do not
make this the habit. Reset drift with `git fetch && git reset --hard
origin/master && git clean -fd` instead.

## Secrets

| Where | File | Used by |
|-------|------|---------|
| Laptop | `.env.local` (and optionally `.env`) | `next dev` |
| Server | `/home/linuxuser/versions/.env` | `docker compose` `env_file` |

Never commit keys, pass them as Docker build-args, or copy `.env` into
git-tracked paths. `OPENROUTER_API_KEY` and wallet keys live only in
those files.

**Env-only change (no code):** edit the server `.env`, then:

```bash
ssh nuncio-vultr 'cd /home/linuxuser/versions && docker compose up -d --force-recreate app'
```

No image rebuild. Confirm with `/api/health/ready`.

## Post-deploy smoke

```bash
curl -sf https://versions.persidian.com/api/health/ready | jq .data.providers
curl -sf https://versions.persidian.com/api/v1/embeddings/backfill
```

Expect `status: ready`, `llm.provider: openrouter`, `embedding.mock:
false` when inference is configured. After a catalog change, backfill:

```bash
curl -sf -X POST https://versions.persidian.com/api/v1/embeddings/backfill
```

## Monitoring

`scripts/monitor-versions.sh` — cron-friendly; restarts the container
after 3 failed `/api/health/live` checks.

```bash
* * * * * bash $HOME/versions/scripts/monitor-versions.sh
```

## Rollback

Prefer an auditable revert on master, then the normal deploy:

```bash
git revert <sha>
git push origin master
./scripts/deploy-remote.sh
```

Pin the server to a previous commit only as a hotfix:

```bash
ssh nuncio-vultr 'cd /home/linuxuser/versions && git fetch origin && git checkout <sha> && ./scripts/deploy.sh'
# return to tip when the revert is on master:
ssh nuncio-vultr 'cd /home/linuxuser/versions && git checkout master && ./scripts/deploy.sh'
```
