#!/usr/bin/env bash
# Deploy VERSIONS API host — git pull + docker pull (image built in CI).
#
# Hygiene rules (do NOT bypass):
#   - Never scp/rsync source into the repo on the server; always pull from origin.
#   - Secrets live only in .env on the server (gitignored); never bake into the image.
#   - Run from the server checkout: ./scripts/deploy.sh
#   - Or from your laptop: ./scripts/deploy-remote.sh
#
# Optional env:
#   DEPLOY_ALLOW_DIRTY=1     allow dirty server tree (emergency)
#   DEPLOY_BRANCH=master
#   DEPLOY_HEALTH_URL        default http://127.0.0.1:3000 (via docker exec)
#   DEPLOY_BUILD_ON_BOX=1    emergency: docker compose build on the VPS
#   VERSIONS_IMAGE           override image ref (default ghcr.io/.../versions:<sha>)
#   DEPLOY_PULL_WAIT_SEC     how long to wait for GHCR tag (default 900)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY_BRANCH="${DEPLOY_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
HEALTH_BASE="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3000}"
MAX_WAIT="${DEPLOY_HEALTH_WAIT_SEC:-90}"
PULL_WAIT="${DEPLOY_PULL_WAIT_SEC:-900}"
REGISTRY_IMAGE="${VERSIONS_IMAGE_REPO:-ghcr.io/thisyearnofear/versions}"

log() { printf '→ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

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

mkdir -p data/uploads
sudo -n chown -R 1001:1001 data/uploads 2>/dev/null \
  || chmod -R a+rwX data/uploads 2>/dev/null \
  || log "WARNING: could not fix data/uploads ownership — uploads may EACCES"

AFTER="$(git rev-parse --short HEAD)"
AFTER_FULL="$(git rev-parse HEAD)"
log "Now at ${AFTER} ($(git log -1 --format='%s'))"

# Prefer the sha tag matching this commit; fall back to :latest if overridden.
if [ -n "${VERSIONS_IMAGE:-}" ]; then
  IMAGE_REF="$VERSIONS_IMAGE"
else
  IMAGE_REF="${REGISTRY_IMAGE}:${AFTER_FULL}"
fi
export VERSIONS_IMAGE="$IMAGE_REF"
log "Image ${VERSIONS_IMAGE}"

if [ "${DEPLOY_BUILD_ON_BOX:-}" = "1" ]; then
  log "WARNING: DEPLOY_BUILD_ON_BOX=1 — building on the VPS (disk spike)"
  docker compose build --build-arg VERSIONS_ROLE=api
  docker compose up -d --remove-orphans
else
  # Optional GHCR login when the package is private (public packages need none)
  GHCR_TOKEN_VAL="${GHCR_TOKEN:-}"
  GHCR_USER_VAL="${GHCR_USER:-thisyearnofear}"
  if [ -z "$GHCR_TOKEN_VAL" ] && [ -f .env ]; then
    GHCR_TOKEN_VAL="$(grep -E '^GHCR_TOKEN=' .env | head -1 | cut -d= -f2- || true)"
    GHCR_USER_VAL="$(grep -E '^GHCR_USER=' .env | head -1 | cut -d= -f2- || true)"
    GHCR_USER_VAL="${GHCR_USER_VAL:-thisyearnofear}"
  fi
  if [ -n "$GHCR_TOKEN_VAL" ]; then
    log "Logging in to ghcr.io..."
    printf '%s' "$GHCR_TOKEN_VAL" | docker login ghcr.io -u "$GHCR_USER_VAL" --password-stdin
  fi

  log "Pulling image (wait up to ${PULL_WAIT}s for CI)..."
  deadline=$((SECONDS + PULL_WAIT))
  until docker pull "$IMAGE_REF"; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      fail "timed out pulling ${IMAGE_REF} — is the Docker image workflow green for this sha?"
    fi
    log "Image not ready yet — retry in 20s..."
    sleep 20
  done

  # Also tag as :latest locally so compose fallbacks stay coherent
  docker tag "$IMAGE_REF" "${REGISTRY_IMAGE}:latest" 2>/dev/null || true

  log "Recreating container from pulled image..."
  docker compose up -d --remove-orphans --force-recreate
fi

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

printf '%s' "$READY_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {}).get('providers', {})
llm = d.get('llm', {})
emb = d.get('embedding', {})
print(f\"  llm: mock={llm.get('mock')} provider={llm.get('provider', 'n/a')} model={llm.get('model', 'n/a')}\")
print(f\"  embedding: mock={emb.get('mock')} provider={emb.get('provider', 'n/a')}\")
" 2>/dev/null || true

# Pull-only deploys: prune dangling images (no builder cache growth)
log "Pruning unused Docker images..."
docker image prune -f >/dev/null 2>&1 || log "WARNING: docker image prune failed"

log "Deployed ${AFTER_FULL} (${AFTER}) image=${IMAGE_REF}"
echo "✓ Deploy complete."
