#!/usr/bin/env bash
# versions-monitor.sh — uptime/health monitor for the `versions` container.
#
# The container joins the Coolify/Traefik `coolify` network with NO published
# host port, so it is probed via `docker exec` (the Alpine image ships busybox
# wget). After `THRESHOLD` consecutive failed checks it restarts the container
# and (optionally) fires an ntfy.sh alert.
#
# Install (run as the deploy user, e.g. linuxuser):
#   crontab add:  * * * * * bash $HOME/versions/scripts/monitor-versions.sh
#
# Tunables (env):
#   NTFY_URL                     e.g. https://ntfy.sh/your-topic for alerts
#   VERSIONS_MONITOR_LOG         log path (default $HOME/versions-monitor.log)
#   VERSIONS_MONITOR_STATE       consecutive-failure state file (default ...state)
set -u

CONTAINER=versions
URL=http://127.0.0.1:3000/api/health/live
ATTEMPTS=3
THRESHOLD=3
LOG="${VERSIONS_MONITOR_LOG:-${HOME:-/home/linuxuser}/versions-monitor.log}"
STATE="${VERSIONS_MONITOR_STATE:-${HOME:-/home/linuxuser}/versions-monitor.state}"

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "$(ts) $*" >>"$LOG"; }

# read current consecutive-failure count (sanitise)
cur=0
[ -f "$STATE" ] && cur="$(cat "$STATE" 2>/dev/null || echo 0)"
case "$cur" in (*[!0-9]*|'') cur=0 ;; esac
cur="$(printf '%d' "$cur" 2>/dev/null || echo 0)"

healthy=0
for _ in $(seq 1 "$ATTEMPTS"); do
  if docker exec "$CONTAINER" wget -qO- "$URL" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

if [ "$healthy" -eq 1 ]; then
  if [ "$cur" -ne 0 ]; then
    echo 0 >"$STATE" 2>/dev/null || true
    log "healthy again (was down after $cur failures)"
  fi
  exit 0
fi

cur=$((cur + 1))
echo "$cur" >"$STATE" 2>/dev/null || true
log "unhealthy check ($cur/$THRESHOLD consecutive failures)"

if [ "$cur" -ge "$THRESHOLD" ]; then
  echo 0 >"$STATE" 2>/dev/null || true
  log "restarting $CONTAINER after $cur consecutive failures"
  docker restart "$CONTAINER" >>"$LOG" 2>&1
  if [ -n "${NTFY_URL:-}" ]; then
    curl -fsS -m 10 -H "Priority: high" \
      -d "$CONTAINER restarted after $cur consecutive failed health checks" \
      "$NTFY_URL" >>"$LOG" 2>&1 || true
  fi
fi
exit 0