#!/bin/bash

set -euo pipefail

SERVER_URL="${SERVER_URL:-http://localhost:8080}"
SKIP_HTTP=false
REQUIRE_AUDIO_STACK=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-http)
      SKIP_HTTP=true
      shift
      ;;
    --url)
      SERVER_URL="$2"
      shift 2
      ;;
    --no-require-audio)
      REQUIRE_AUDIO_STACK=false
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: ./scripts/doctor.sh [--skip-http] [--url <server-url>] [--no-require-audio]"
      exit 1
      ;;
  esac
done

pass() { echo "✅ $1"; }
warn() { echo "⚠️  $1"; }
fail() { echo "❌ $1"; }

echo "🩺 VERSIONS Proxy Doctor"
echo "========================"
echo "Target: ${SERVER_URL}"
echo ""

MISSING=0

check_required_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    fail "$name is missing"
    MISSING=$((MISSING + 1))
  else
    pass "$name is set"
  fi
}

check_optional_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    warn "$name is not set"
  else
    pass "$name is set"
  fi
}

echo "🔐 Environment checks"
if [[ "$REQUIRE_AUDIO_STACK" == "true" ]]; then
  check_required_env "TURBOPUFFER_API_KEY"
  check_required_env "ELEVENLABS_API_KEY"
else
  check_optional_env "TURBOPUFFER_API_KEY"
  check_optional_env "ELEVENLABS_API_KEY"
fi

check_optional_env "AUDIUS_API_KEY"
check_optional_env "HELIUS_API_KEY"
echo ""

if [[ "$MISSING" -gt 0 ]]; then
  fail "Required environment checks failed (${MISSING} missing)."
  exit 1
fi

if [[ "$SKIP_HTTP" == "true" ]]; then
  pass "HTTP checks skipped"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  fail "curl is required for HTTP checks"
  exit 1
fi

echo "🌐 HTTP checks"

http_get() {
  local path="$1"
  local url="${SERVER_URL}${path}"
  local response

  if ! response=$(curl -sS --max-time 5 "$url"); then
    fail "Request failed: $path"
    return 1
  fi

  if command -v jq >/dev/null 2>&1; then
    local success
    success=$(echo "$response" | jq -r '.success // empty')
    local status
    status=$(echo "$response" | jq -r '.data.status // empty')
    if [[ "$success" != "true" ]]; then
      fail "$path returned non-success payload"
      echo "$response" | jq '.'
      return 1
    fi
    pass "$path OK${status:+ (status=${status})}"
  else
    if [[ "$response" == *'"success":true'* ]]; then
      pass "$path OK"
    else
      fail "$path returned non-success payload"
      echo "$response"
      return 1
    fi
  fi
}

http_get "/api/v1/health/live"
http_get "/api/v1/health/ready"
http_get "/api/v1/providers"

echo ""
pass "Doctor checks complete"

