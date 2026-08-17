#!/usr/bin/env bash
# Deploy VERSIONS on the VPS — git pull + docker rebuild only.
#
# Hygiene rules (do NOT bypass):
#   - Never scp/rsync source into the repo on the server; always pull from origin.
#   - Secrets live only in .env on the server (gitignored); never bake into the image.
#   - Run from the server checkout: ./scripts/deploy.sh
#   - Or from your laptop: ./scripts/deploy-remote.sh
#
# Optional env:
#   DEPLOY_ALLOW_DIRTY=1   allow deploy with uncommitted server changes (emergency only)
#   DEPLOY_BRANCH=master   branch to deploy (default: current branch)
#   DEPLOY_HEALTH_URL      override health base (default: http://127.0.0.1:3000)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY_BRANCH="${DEPLOY_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
HEALTH_BASE="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3000}"
MAX_WAIT="${DEPLOY_HEALTH_WAIT_SEC:-90}"

log() { printf '→ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────
command -v docker >/dev/null 2>&1 || fail "docker not found"
command -v git >/dev/null 2>&1 || fail "git not found"
[ -f docker-compose.yml ] || fail "run from repo root (missing docker-compose.yml)"
[ -f .env ] || fail ".env missing — copy from .env.example and configure secrets on the server"

if [ -n "$(git status --porcelain)" ]; then
  if [ "${DEPLOY_ALLOW_DIRTY:-}" = "1" ]; then
    log "WARNING: working tree has local changes (DEPLOY_ALLOW_DIRTY=1)"
    git status --short
  else
    fail "working tree dirty — commit or stash server-local edits, or set DEPLOY_ALLOW_DIRTY=1 for emergency deploy"
  fi
fi

BEFORE="$(git rev-parse --short HEAD)"
log "Deploying branch ${DEPLOY_BRANCH} @ ${BEFORE}"

log "Fetching origin..."
git fetch origin "$DEPLOY_BRANCH"

log "Pulling latest (ff-only)..."
git pull --ff-only origin "$DEPLOY_BRANCH"

# ── Uploads dir must be writable by container uid 1001 (bind mount) ──
# Host dir ownership can drift (fresh clone, reinstall); fix idempotently.
mkdir -p data/uploads
sudo -n chown -R 1001:1001 data/uploads 2>/dev/null \
  || chmod -R a+rwX data/uploads 2>/dev/null \
  || log "WARNING: could not fix data/uploads ownership — uploads may EACCES"

AFTER="$(git rev-parse --short HEAD)"
AFTER_FULL="$(git rev-parse HEAD)"
log "Now at ${AFTER} ($(git log -1 --format='%s'))"

# ── Build + restart ─────────────────────────────────────
log "Rebuilding container..."
docker compose up -d --build --remove-orphans

# ── Health: live then ready ─────────────────────────────
probe() {
  local path="$1"
  if docker exec versions wget -qO- "${HEALTH_BASE}${path}" 2>/dev/null; then
    return 0
  fi
  curl -sf "${HEALTH_BASE}${path}" 2>/dev/null
}

log "Waiting for /api/health/live (up to ${MAX_WAIT}s)..."
deadline=$((SECONDS + MAX_WAIT))
until probe /api/health/live >/dev/null; do
  [ "$SECONDS" -ge "$deadline" ] && fail "timed out waiting for /api/health/live"
  sleep 2
done
log "Live ✓"

READY_JSON="$(probe /api/health/ready || true)"
if [ -z "$READY_JSON" ]; then
  fail "/api/health/ready unreachable after live passed — check: docker logs versions --tail 30"
fi

STATUS="$(printf '%s' "$READY_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null || echo "")"
if [ "$STATUS" = "degraded" ]; then
  log "WARNING: health/ready reports degraded (Arc may be unreachable)"
elif [ "$STATUS" != "ready" ]; then
  fail "health/ready status=${STATUS:-unknown}"
fi
log "Ready ✓ (status=${STATUS:-ready})"

# Surface inference mode when jq/python available
printf '%s' "$READY_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {}).get('providers', {})
llm = d.get('llm', {})
emb = d.get('embedding', {})
print(f\"  llm: mock={llm.get('mock')} provider={llm.get('provider', 'n/a')} model={llm.get('model', 'n/a')}\")
print(f\"  embedding: mock={emb.get('mock')} provider={emb.get('provider', 'n/a')}\")
" 2>/dev/null || true

log "Deployed ${AFTER_FULL} (${AFTER})"
echo "✓ Deploy complete."
