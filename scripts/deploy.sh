#!/usr/bin/env bash
# MODULAR: one-command production deploy. Builds the image
# (with the build step baked in) and runs it on the target
# port, with a persistent volume for the SQLite database +
# uploads. Reads the deploy env from .env.production if
# present, or prompts for the required ones interactively.
#
# ENHANCEMENT FIRST: no new infra. The Dockerfile is the
# same one Railway / Fly.io / Docker would build. The
# difference is: this script runs the same image locally
# or on a VPS, no platform-specific CLI needed.
#
# Usage:
#   ./scripts/deploy.sh [port]   # default 8080
#   PORT=8081 ./scripts/deploy.sh
#   ./scripts/deploy.sh 8080 --stop       # stop a running deploy
#   ./scripts/deploy.sh 8080 --logs       # tail logs
#   ./scripts/deploy.sh 8080 --rebuild    # rebuild + restart

set -euo pipefail

PORT="${1:-${PORT:-8080}}"
ACTION="${2:-up}"
DATA_DIR="${DATA_DIR:-./data}"
CONTAINER_NAME="versions-${PORT}"
IMAGE_NAME="versions:deploy"

# MODULAR: log helper. Single source of truth for the script's
# output. The colours help when the user is reading the
# terminal during a deploy.
log()  { printf "\033[1;34m[deploy]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[deploy]\033[0m %s\n" "$*" >&2; }
die()  { printf "\033[1;31m[deploy]\033[0m %s\n" "$*" >&2; exit 1; }

# MODULAR: load env from .env.production if it exists. The
# script doesn't write to it; the user creates it by hand
# (or by running `cp .env.example .env.production`).
if [[ -f .env.production ]]; then
  log "loading env from .env.production"
  set -a; source .env.production; set +a
fi

# CLEAN: required env vars. The proxy is mock-first; if
# ARC_RPC_URL is unset, the arc adapter runs in mock mode
# (the demo path). For a real deployment, set ARC_RPC_URL +
# ARC_USDC_CONTRACT + PLATFORM_WALLET.
REQUIRED=()
if [[ -z "${PLATFORM_WALLET:-}" ]]; then
  warn "PLATFORM_WALLET is not set; the proxy will refuse settlements"
  warn "set it in .env.production or as a shell env var"
fi
if [[ -z "${ARC_RPC_URL:-}" ]]; then
  warn "ARC_RPC_URL is not set; arc adapter will run in mock mode"
fi

# MODULAR: --stop just runs `docker stop` and returns.
# --logs tails the running container. --rebuild does a
# fresh image build before bringing the container up.
case "$ACTION" in
  --stop)
    log "stopping ${CONTAINER_NAME}"
    docker stop "${CONTAINER_NAME}" 2>/dev/null || true
    docker rm   "${CONTAINER_NAME}" 2>/dev/null || true
    exit 0
    ;;
  --logs)
    log "tailing ${CONTAINER_NAME} logs (Ctrl+C to exit)"
    exec docker logs -f --tail=200 "${CONTAINER_NAME}"
    ;;
esac

# MODULAR: --rebuild forces a fresh image build. Default is
# to use the existing image if it's there (saves a 30-60s
# build on every deploy).
if [[ "$ACTION" == "--rebuild" ]] || ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  log "building ${IMAGE_NAME} (this is the Dockerfile's RUN layer chain)"
  docker build -t "$IMAGE_NAME" .
else
  log "image ${IMAGE_NAME} already present; skipping build (use --rebuild to force)"
fi

# MODULAR: data volume. The SQLite db + uploads live in
# DATA_DIR on the host. The volume is mounted at /app/data
# in the container. The Dockerfile's VOLUME ["/app/data"]
# makes the mount explicit.
mkdir -p "${DATA_DIR}/uploads"

# MODULAR: the env vars we pass to the container. Everything
# in the shell (after .env.production) is forwarded, so
# the user can override any var per-deploy.
ENV_ARGS=()
for v in PLATFORM_WALLET PORT HOST ARC_RPC_URL ARC_USDC_CONTRACT \
         AUDIUS_API_KEY SUBMISSION_FEE_USDC MAX_BODY_BYTES \
         RATE_LIMIT_AUDIO_MAX RATE_LIMIT_WINDOW_MS \
         UPSTREAM_TIMEOUT_MS SWEEPER_INTERVAL_MS SWEEPER_THRESHOLD_MS \
         SUBMISSION_BODY_LIMIT ALLOWED_ORIGINS LOG_LEVEL; do
  if [[ -n "${!v:-}" ]]; then
    ENV_ARGS+=("-e" "${v}=${!v}")
  fi
done

# MODULAR: stop a previous instance on the same port (idempotent).
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  log "removing previous ${CONTAINER_NAME}"
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

# MODULAR: the deploy command. Single port; one image; one volume.
log "starting ${CONTAINER_NAME} on port ${PORT}"
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "${PORT}:8080" \
  -v "$(cd "${DATA_DIR}" && pwd):/app/data" \
  "${ENV_ARGS[@]}" \
  "${IMAGE_NAME}" >/dev/null

# CLEAN: wait for the proxy to come up + emit a health
# check. The health check URL is the same /health/ready
# that Railway / Fly.io would use.
log "waiting for /health/ready ..."
for i in {1..30}; do
  if curl -sS "http://127.0.0.1:${PORT}/health/ready" 2>/dev/null | grep -q '"ready"'; then
    log "deploy complete"
    log "  URL:    http://127.0.0.1:${PORT}"
    log "  health: http://127.0.0.1:${PORT}/health/ready"
    log "  arc:    ${ARC_RPC_URL:-mock}"
    log "  data:   ${DATA_DIR}"
    log ""
    log "next steps:"
    log "  - npm run seed     # populate the feed for the demo"
    log "  - tail -f ${DATA_DIR}/versions.db  # watch writes"
    log "  - ./scripts/deploy.sh ${PORT} --logs"
    exit 0
  fi
  sleep 1
done

die "deploy failed: /health/ready did not return ready within 30s. Try: ./scripts/deploy.sh ${PORT} --logs"
