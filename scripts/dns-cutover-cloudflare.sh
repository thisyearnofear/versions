#!/usr/bin/env bash
# Apply Cloudflare DNS for the Netlify UI + box API split.
#
# Requires: CLOUDFLARE_API_TOKEN with Zone.DNS Edit on persidian.com
# Optional:  CLOUDFLARE_ZONE_ID (looked up by name if unset)
#
# Records:
#   api.versions  A      → 144.202.117.160          (DNS only / grey cloud)
#   versions      CNAME  → versions-persidian.netlify.app  (DNS only)
#
# After this propagates:
#   1. netlify env:set NEXT_PUBLIC_API_URL https://api.versions.persidian.com
#   2. netlify env:set INTERNAL_API_URL https://api.versions.persidian.com
#   3. netlify deploy --build --prod
#   4. On the box, drop the Traefik Host(versions.persidian.com) labels

set -euo pipefail

ZONE_NAME="${CLOUDFLARE_ZONE_NAME:-persidian.com}"
VPS_IP="${VERSIONS_VPS_IP:-144.202.117.160}"
NETLIFY_TARGET="${VERSIONS_NETLIFY_CNAME:-versions-persidian.netlify.app}"
API_NAME="api.versions"
UI_NAME="versions"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (Zone.DNS Edit on ${ZONE_NAME})}"

api() {
  local method=$1 path=$2 data=${3:-}
  if [[ -n "$data" ]]; then
    curl -sfS -X "$method" "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$data"
  else
    curl -sfS -X "$method" "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
if [[ -z "$ZONE_ID" ]]; then
  ZONE_ID=$(api GET "/zones?name=${ZONE_NAME}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
zs = d.get('result') or []
if not zs:
  raise SystemExit('No zone found for ${ZONE_NAME} — token missing Zone access?')
print(zs[0]['id'])
")
fi
echo "Zone ${ZONE_NAME} → ${ZONE_ID}"

upsert() {
  local type=$1 name=$2 content=$3
  local fqdn="${name}.${ZONE_NAME}"
  local existing id
  existing=$(api GET "/zones/${ZONE_ID}/dns_records?name=${fqdn}&type=${type}")
  id=$(printf '%s' "$existing" | python3 -c "
import sys, json
r = (json.load(sys.stdin).get('result') or [])
print(r[0]['id'] if r else '')
")
  local body
  body=$(python3 -c "
import json
print(json.dumps({
  'type': '${type}',
  'name': '${name}',
  'content': '${content}',
  'ttl': 300,
  'proxied': False,
}))
")
  if [[ -n "$id" ]]; then
    echo "Update ${type} ${fqdn} → ${content}"
    api PUT "/zones/${ZONE_ID}/dns_records/${id}" "$body" >/dev/null
  else
    echo "Create ${type} ${fqdn} → ${content}"
    api POST "/zones/${ZONE_ID}/dns_records" "$body" >/dev/null
  fi
}

upsert A "${API_NAME}" "${VPS_IP}"
upsert CNAME "${UI_NAME}" "${NETLIFY_TARGET}"

echo "Done. Verify:"
echo "  dig +short api.versions.persidian.com A"
echo "  dig +short versions.persidian.com CNAME"
echo "  curl -sf https://api.versions.persidian.com/api/health/live"
echo "  curl -sI https://versions.persidian.com/discover | head -5"
