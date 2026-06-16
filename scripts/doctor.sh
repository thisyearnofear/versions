#!/bin/bash
# VERSIONS — environment + readiness check.
# MODULAR: each check is a single bash function with a clear pass/warn/fail.
# CLEAN: the env-var list is the same one ENVIRONMENT_VARIABLES.md documents.

set -euo pipefail

SERVER_URL="${SERVER_URL:-http://localhost:8080}"
REQUIRE_ARC=false
REQUIRE_HF=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)           SERVER_URL="$2"; shift 2;;
    --require-arc)   REQUIRE_ARC=true; shift;;
    --require-hf)    REQUIRE_HF=true; shift;;
    *) echo "Unknown arg: $1"; echo "Usage: ./scripts/doctor.sh [--url <url>] [--require-arc] [--require-hf]"; exit 1;;
  esac
done

pass() { echo "✅ $1"; }
warn() { echo "⚠️  $1"; }
fail() { echo "❌ $1"; }

echo "🩺 VERSIONS — proxy doctor"
echo "=========================="
echo "Target: ${SERVER_URL}"
echo ""

# MODULAR: every variable the proxy reads is checked here. Group by
# requirement level.
echo "🔐 Environment"

if [[ "$REQUIRE_ARC" == "true" ]]; then
  for v in ARC_RPC_URL ARC_USDC_CONTRACT PLATFORM_WALLET; do
    if [[ -z "${!v:-}" ]]; then fail "$v is missing (required)"; MISSING=1; else pass "$v is set"; fi
  done
else
  for v in ARC_RPC_URL ARC_USDC_CONTRACT PLATFORM_WALLET; do
    if [[ -z "${!v:-}" ]]; then warn "$v is not set (mock mode)"; else pass "$v is set"; fi
  done
fi

# Optional env vars: just report.
for v in AUDIUS_API_KEY MOCK_ARC; do
  if [[ -n "${!v:-}" ]]; then pass "$v is set"; else warn "$v is not set"; fi
done

echo ""

if [[ "${MISSING:-0}" -gt 0 ]]; then
  fail "Required env vars missing."
  exit 1
fi

# MODULAR: HTTP checks. Use curl with a short timeout so the doctor
# never hangs.
if ! command -v curl >/dev/null 2>&1; then
  fail "curl is required"
  exit 1
fi

echo "🌐 HTTP checks"

http_get() {
  local path="$1"
  local url="${SERVER_URL}${path}"
  local response
  if ! response=$(curl -sS --max-time 5 "$url"); then
    fail "GET $path failed (curl)"
    return 1
  fi
  if command -v jq >/dev/null 2>&1; then
    local success
    success=$(echo "$response" | jq -r '.success // empty')
    if [[ "$success" != "true" ]]; then
      fail "GET $path returned non-success"
      echo "$response" | jq '.'
      return 1
    fi
    pass "GET $path ok"
  else
    if [[ "$response" == *'"success":true'* ]]; then pass "GET $path ok"; else fail "GET $path bad response"; echo "$response"; return 1; fi
  fi
}

http_get "/health/live" || true
http_get "/health/ready" || true
http_get "/api/v1/arc/info" || true

echo ""
pass "Doctor checks complete"
