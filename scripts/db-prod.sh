#!/usr/bin/env bash
# Safe production database operations for VERSIONS.
#
# Usage (on the VPS, from the repository root):
#   ./scripts/db-prod.sh status
#   ./scripts/db-prod.sh backup
#   ./scripts/db-prod.sh restore-drill /absolute/path/to/backup.dump
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

server_major() {
  load_database_url
  require_psql

  local server_version_num
  server_version_num="$(psql "$DATABASE_URL" -XAtc 'SHOW server_version_num' 2>/dev/null)" || fail "could not connect to DATABASE_URL"
  [[ "$server_version_num" =~ ^[0-9]+$ ]] || fail "unexpected PostgreSQL server version: ${server_version_num}"
  printf '%s\n' "$((server_version_num / 10000))"
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

  local major backup_parent stamp file backup
  major="$(server_major)"
  backup_parent="$(dirname "$BACKUP_DIR")"
  [ -d "$backup_parent" ] || fail "backup parent does not exist: ${backup_parent}"
  umask 077
  mkdir -p "$BACKUP_DIR"

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="versions-before-schema-${stamp}.dump"
  backup="${BACKUP_DIR}/${file}"

  log "Creating a PostgreSQL ${major} custom-format backup"
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -e DATABASE_URL="$DATABASE_URL" \
    -v "${BACKUP_DIR}:/backup" \
    "postgres:${major}" \
    pg_dump --format=custom --no-owner --no-acl --file="/backup/${file}" "$DATABASE_URL"

  test -s "$backup" || fail "backup was not created: ${backup}"
  docker run --rm --user "$(id -u):$(id -g)" \
    -v "${BACKUP_DIR}:/backup:ro" \
    "postgres:${major}" \
    pg_restore --list "/backup/${file}" >/dev/null

  printf 'backup=%s\n' "$backup"
  printf 'bytes='
  wc -c < "$backup"
}

restore_drill() {
  [ "$#" -eq 1 ] || fail "restore-drill requires one absolute backup path"
  command -v docker >/dev/null 2>&1 || fail "docker is required for an isolated restore drill"
  command -v openssl >/dev/null 2>&1 || fail "openssl is required to generate an isolated database password"

  local backup="$1" backup_dir backup_file major image name password container_id ready extension
  local source_schema source_constraints source_counts restored_schema restored_constraints restored_counts
  [[ "$backup" = /* ]] || fail "restore-drill requires an absolute backup path"
  test -s "$backup" || fail "backup is missing or empty: ${backup}"
  backup_dir="$(dirname "$backup")"
  backup_file="$(basename "$backup")"
  major="$(server_major)"
  image="pgvector/pgvector:pg${major}"
  name="versions-restore-drill-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  password="$(openssl rand -hex 24)"
  container_id=""

  # Compare the recovery target to the live source without outputting either
  # database URL or application data. These checks make a stale partial archive
  # fail the drill instead of reporting a misleading pass.
  source_schema="$(psql "$DATABASE_URL" -XAtc "SELECT COALESCE(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, E'\\n' ORDER BY table_name, ordinal_position), '') FROM information_schema.columns WHERE table_schema = 'public';")"
  source_constraints="$(psql "$DATABASE_URL" -XAtc "SELECT COALESCE(string_agg(conrelid::regclass::text || ':' || contype || ':' || pg_get_constraintdef(oid), E'\\n' ORDER BY conrelid::regclass::text, conname), '') FROM pg_constraint WHERE connamespace = 'public'::regnamespace;")"
  source_counts="$(psql "$DATABASE_URL" -XAtc "SELECT (SELECT count(*) FROM licenses)::text || '|' || (SELECT count(*) FROM published_versions)::text || '|' || (SELECT count(*) FROM match_feedback)::text;")"

  cleanup() {
    [ -n "$container_id" ] && docker rm -f "$container_id" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  log "Starting network-isolated PostgreSQL ${major} + pgvector restore drill"
  container_id="$(docker run -d --rm --network none --name "$name" \
    -e POSTGRES_USER=restore \
    -e POSTGRES_PASSWORD="$password" \
    -e POSTGRES_DB=versions_restore \
    "$image")"

  ready=0
  for _ in $(seq 1 60); do
    if docker exec "$container_id" pg_isready -U restore -d versions_restore >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  [ "$ready" -eq 1 ] || { docker logs "$container_id" >&2; fail "temporary restore database did not become ready"; }

  docker run --rm --network "container:${container_id}" \
    -e PGPASSWORD="$password" \
    -v "${backup_dir}:/backup:ro" \
    "$image" \
    pg_restore --exit-on-error --no-owner --no-acl \
      -h 127.0.0.1 -U restore -d versions_restore "/backup/${backup_file}"

  extension="$(docker exec -e PGPASSWORD="$password" "$container_id" \
    psql -U restore -d versions_restore -XAtc "SELECT extversion FROM pg_extension WHERE extname = 'vector'")"
  [ -n "$extension" ] || fail "restore completed but pgvector is missing from the isolated database"
  restored_schema="$(docker exec -e PGPASSWORD="$password" "$container_id" \
    psql -U restore -d versions_restore -XAtc "SELECT COALESCE(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, E'\\n' ORDER BY table_name, ordinal_position), '') FROM information_schema.columns WHERE table_schema = 'public';")"
  restored_constraints="$(docker exec -e PGPASSWORD="$password" "$container_id" \
    psql -U restore -d versions_restore -XAtc "SELECT COALESCE(string_agg(conrelid::regclass::text || ':' || contype || ':' || pg_get_constraintdef(oid), E'\\n' ORDER BY conrelid::regclass::text, conname), '') FROM pg_constraint WHERE connamespace = 'public'::regnamespace;")"
  restored_counts="$(docker exec -e PGPASSWORD="$password" "$container_id" \
    psql -U restore -d versions_restore -XAtc "SELECT (SELECT count(*) FROM licenses)::text || '|' || (SELECT count(*) FROM published_versions)::text || '|' || (SELECT count(*) FROM match_feedback)::text;")"

  [ "$source_schema" = "$restored_schema" ] || fail "restored public schema does not match the live source"
  [ "$source_constraints" = "$restored_constraints" ] || fail "restored public constraints do not match the live source"
  [ "$source_counts" = "$restored_counts" ] || fail "restored key row counts do not match the live source"

  docker stop "$container_id" >/dev/null
  trap - EXIT
  printf 'restore-drill=passed\n'
  printf 'backup=%s\n' "$backup"
  printf 'pgvector=%s\n' "$extension"
  printf 'key-row-counts=%s\n' "$restored_counts"
  printf 'temporary-container-removed=%s\n' "$name"
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
  restore-drill)
    shift
    restore_drill "$@"
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
  ./scripts/db-prod.sh restore-drill /absolute/path/to/backup.dump
  VERSIONS_DB_APPLY=1 ./scripts/db-prod.sh push [drizzle-kit push flags]

`status` is read-only. `backup` creates and verifies a custom-format dump using
an official PostgreSQL client image matching the database server's major
version. `restore-drill` restores an explicit archive into a network-isolated
PostgreSQL + pgvector container, compares schema/constraints/key row counts to
the live source, and removes the temporary container. `push` is interactive
and prints SQL before applying it.
USAGE
    ;;
  *)
    fail "unknown command: $1"
    ;;
esac
