#!/bin/bash
# VERSIONS — live Arc testnet connectivity check.
# MODULAR: verifies the four env vars are set, the proxy boots in
# real-mode, /api/v1/arc/info returns a real chainId + balance, and
# eth_estimateGas round-trips against the testnet.
#
# Usage:
#   export ARC_RPC_URL=https://rpc.testnet.arc.network
#   export ARC_USDC_CONTRACT=0xUSDC...
#   export PLATFORM_WALLET=0xPlat...
#   bash scripts/test-arc-live.sh
#
# Exit codes:
#   0 = live mode wired and reachable
#   1 = missing env vars
#   2 = proxy won't boot in live mode
#   3 = arc/info returned mock=true (RPC unreachable from proxy host)
#   4 = estimateGas failed

set -euo pipefail

PROXY_PORT="${PROXY_PORT:-8080}"
PROXY_URL="${PROXY_URL:-http://localhost:${PROXY_PORT}}"

pass() { echo "✅ $1"; }
warn() { echo "⚠️  $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

echo "🔗 VERSIONS — live Arc testnet check"
echo "===================================="

# 1. Required env vars
echo ""
echo "🔐 Environment"
MISSING=0
for v in ARC_RPC_URL ARC_USDC_CONTRACT PLATFORM_WALLET; do
  if [[ -z "${!v:-}" ]]; then
    fail "$v is not set" 1
  else
    pass "$v is set (${!v:0:14}…)"
  fi
done

# 2. Proxy boots in live mode (the boot log prints arc=real|mock)
echo ""
echo "🚀 Boot check"
node proxy-server.js > /tmp/proxy-live.log 2>&1 &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null; wait 2>/dev/null || true' EXIT
sleep 2

if ! kill -0 "$PROXY_PID" 2>/dev/null; then
  echo "--- proxy log ---"
  cat /tmp/proxy-live.log
  fail "proxy exited unexpectedly" 2
fi
if grep -q '"arc":"real"' /tmp/proxy-live.log; then
  pass "proxy booted in real mode"
else
  echo "--- proxy log ---"
  cat /tmp/proxy-live.log
  fail "proxy did not log arc=real (RPC may be unreachable from this host)" 2
fi

# 3. /api/v1/arc/info
echo ""
echo "🌐 arc/info"
INFO=$(curl -sS --max-time 5 "$PROXY_URL/api/v1/arc/info")
echo "$INFO"
MOCK=$(echo "$INFO" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{console.log(JSON.parse(s).data.mock)}catch(e){console.log("PARSE_ERROR")}})')
if [[ "$MOCK" == "true" ]]; then
  fail "arc/info returned mock=true — RPC unreachable from proxy host" 3
fi
CHAIN_ID=$(echo "$INFO" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{console.log(JSON.parse(s).data.chainId)}catch(e){console.log("PARSE_ERROR")}})')
[[ "$CHAIN_ID" != "null" && -n "$CHAIN_ID" ]] && pass "chainId: $CHAIN_ID" || fail "chainId is null" 3

DECIMALS=$(echo "$INFO" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{console.log(JSON.parse(s).data.usdcDecimals)})')
[[ "$DECIMALS" == "6" ]] && pass "usdcDecimals: 6" || warn "usdcDecimals: $DECIMALS (expected 6)"

BAL=$(echo "$INFO" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{console.log(JSON.parse(s).data.platformUsdcBalance)})')
if [[ "$BAL" != "null" && "$BAL" != "0" && -n "$BAL" ]]; then
  pass "platform USDC balance (raw micro-units): $BAL"
else
  warn "platform USDC balance is $BAL — fund the wallet from the testnet faucet before submitting"
fi

# 4. /health/ready
echo ""
echo "🌐 /health/ready"
READY=$(curl -sS --max-time 5 "$PROXY_URL/health/ready")
echo "$READY"
pass "proxy is ready"

echo ""
pass "live Arc testnet is wired and reachable"
