#!/usr/bin/env bash
# Safe production database operations for VERSIONS.
#
# Usage (on the VPS, from the repository root):
#   ./scripts/db-prod.sh status
#   ./scripts/db-prod.sh backup
#   VERSIONS_DB_APPLY=1 ./scripts/db-prod.sh push
#
# The production database predates Drizzle's migration ledger. Do NOT use
# drizzle-kit migrate against it: use the guarded, interactive `push` command
# after a verified backup instead. This script never prints DATABASE_URL.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CONTAINER="${VERSIONS_DB_CONTAINER:-versions}"
BACKUP_DIR="${VERSIONS_DB_BACKUP_DIR:-${HOME:-/home/linuxuser}/backups/versions}"

log() { printf '→ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

load_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    return
  fi

  command -v docker >/dev/null 2>&1 || fail "DATABASE_URL is unset and docker is unavailable"
  DATABASE_URL="$({
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" \
      | awk -F= '/^DATABASE_URL=/{sub(/^[^=]*=/, ""); print; exit}'
  } || true)"
  [ -n "$DATABASE_URL" ] || fail "DATABASE_URL is unset and was not found in container ${CONTAINER}"
  export DATABASE_URL
}

require_psql() {
  command -v psql >/dev/null 2>&1 || fail "psql is required"
}

status() {
  load_database_url
  require_psql

  local server_version client_version ledger applied
  server_version="$(psql "$DATABASE_URL" -XAtc 'SHOW server_version' 2>/dev/null)" || fail "could not connect to DATABASE_URL"
  client_version="$(psql --version)"
  ledger="$(psql "$DATABASE_URL" -XAtc "SELECT COALESCE(to_regclass('public.__drizzle_migrations')::text, 'absent')")"

  printf 'database-server=%s\n' "$server_version"
  printf 'database-client=%s\n' "$client_version"
  printf 'drizzle-ledger=%s\n' "$ledger"

  if [ "$ledger" = "absent" ]; then
    log "WARNING: no Drizzle migration ledger; db:migrate is unsafe for this database"
  else
    applied="$(psql "$DATABASE_URL" -XAtc 'SELECT count(*) FROM public.__drizzle_migrations')"
    printf 'drizzle-ledger-entries=%s\n' "$applied"
  fi
}

backup() {
  load_database_url
  require_psql
  command -v docker >/dev/null 2>&1 || fail "docker is required for a version-matched pg_dump client"

  local server_version_num server_major backup_parent stamp file backup
  server_version_num="$(psql "$DATABASE_URL" -XAtc 'SHOW server_version_num' 2>/dev/null)" || fail "could not connect to DATABASE_URL"
  [[ "$server_version_num" =~ ^[0-9]+$ ]] || fail "unexpected PostgreSQL server version: ${server_version_num}"
  server_major="$((server_version_num / 10000))"

  backup_parent="$(dirname "$BACKUP_DIR")"
  [ -d "$backup_parent" ] || fail "backup parent does not exist: ${backup_parent}"
  umask 077
  mkdir -p "$BACKUP_DIR"

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="versions-before-schema-${stamp}.dump"
  backup="${BACKUP_DIR}/${file}"

  log "Creating a PostgreSQL ${server_major} custom-format backup"
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -e DATABASE_URL="$DATABASE_URL" \
    -v "${BACKUP_DIR}:/backup" \
    "postgres:${server_major}" \
    pg_dump --format=custom --no-owner --no-acl --file="/backup/${file}" "$DATABASE_URL"

  test -s "$backup" || fail "backup was not created: ${backup}"
  docker run --rm --user "$(id -u):$(id -g)" \
    -v "${BACKUP_DIR}:/backup:ro" \
    "postgres:${server_major}" \
    pg_restore --list "/backup/${file}" >/dev/null

  printf 'backup=%s\n' "$backup"
  printf 'bytes='
  wc -c < "$backup"
}

push_schema() {
  if [ "${VERSIONS_DB_APPLY:-}" != "1" ]; then
    fail "refusing schema change: rerun with VERSIONS_DB_APPLY=1 after status and backup"
  fi
  load_database_url

  log "Running interactive Drizzle push with verbose SQL; never use --force in production"
  exec npx drizzle-kit push --strict --verbose "$@"
}

case "${1:-}" in
  status)
    [ "$#" -eq 1 ] || fail "status takes no arguments"
    status
    ;;
  backup)
    [ "$#" -eq 1 ] || fail "backup takes no arguments"
    backup
    ;;
  push)
    shift
    push_schema "$@"
    ;;
  -h|--help|help|'')
    cat <<'USAGE'
Usage:
  ./scripts/db-prod.sh status
  ./scripts/db-prod.sh backup
  VERSIONS_DB_APPLY=1 ./scripts/db-prod.sh push [drizzle-kit push flags]

`status` is read-only. `backup` creates and verifies a custom-format dump using
an official PostgreSQL client image matching the database server's major
version. `push` is interactive and prints SQL before applying it.
USAGE
    ;;
  *)
    fail "unknown command: $1"
    ;;
esac
