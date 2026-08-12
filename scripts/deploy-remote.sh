#!/usr/bin/env bash
# Deploy VERSIONS to the remote VPS from your laptop.
#
# Ensures local master is pushed, then runs scripts/deploy.sh on the server
# via git pull (never scp source files).
#
# Usage:
#   ./scripts/deploy-remote.sh              # default host: nuncio-vultr
#   ./scripts/deploy-remote.sh my-host
#   VERSIONS_REMOTE_DIR=/path ./scripts/deploy-remote.sh
#
# Requires: ssh alias/host, remote repo at VERSIONS_REMOTE_DIR with origin set.

set -euo pipefail

HOST="${1:-nuncio-vultr}"
REMOTE_DIR="${VERSIONS_REMOTE_DIR:-/home/linuxuser/versions}"
BRANCH="${DEPLOY_BRANCH:-master}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '→ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

[ -d .git ] || fail "not a git repo"

log "Local preflight: branch ${BRANCH}"
git fetch origin "$BRANCH"

LOCAL="$(git rev-parse "$BRANCH" 2>/dev/null || git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/${BRANCH}")"

if [ "$LOCAL" != "$REMOTE" ]; then
  fail "origin/${BRANCH} (${REMOTE:0:7}) != local ${BRANCH} (${LOCAL:0:7}) — push first: git push origin ${BRANCH}"
fi

log "Pushed commit ${LOCAL:0:7} — $(git log -1 --format='%s')"
log "Remote deploy on ${HOST}:${REMOTE_DIR}"

ssh "$HOST" "cd '$REMOTE_DIR' && DEPLOY_BRANCH='$BRANCH' ./scripts/deploy.sh"

log "Remote deploy finished."
