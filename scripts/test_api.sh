#!/bin/bash
# VERSIONS — end-to-end API smoke. Hits every Lepton endpoint and
# walks the full submit → curate → publish → feed flow. Requires a
# running proxy on PORT (default 18099).

set -euo pipefail

PORT="${PORT:-18099}"
BASE="http://127.0.0.1:${PORT}"

# MODULAR: requires node + the proxy dependencies installed.
if ! command -v node >/dev/null 2>&1; then
  echo "node is required"
  exit 1
fi

# DRY: delegate to the Node smoke test that already covers every endpoint.
exec node scripts/smoke-day5.js
