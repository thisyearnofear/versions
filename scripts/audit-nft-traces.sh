#!/usr/bin/env bash
# Fail if any .nft.json trace file references sensitive paths.
# Run after `next build` in CI or locally.
set -euo pipefail

TRACE_DIR=".next/server"
FORBIDDEN_PATTERNS=(
  '\.git/'
  '\.env'
  'data/uploads/'
  '\.pem$'
  'credentials'
  'secret'
)

if [ ! -d "$TRACE_DIR" ]; then
  echo "ERROR: $TRACE_DIR not found — run 'npm run build' first."
  exit 1
fi

VIOLATIONS=0

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  MATCHES=$(grep -rl "$pattern" "$TRACE_DIR" --include='*.nft.json' 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    echo "FAIL: Pattern '$pattern' found in trace files:"
    for f in $MATCHES; do
      echo "  $f"
      grep -o "\"[^\"]*${pattern}[^\"]*\"" "$f" | head -5 | sed 's/^/    /'
    done
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "ERROR: $VIOLATIONS forbidden pattern(s) leaked into build traces."
  echo "Fix: add paths to outputFileTracingExcludes in next.config.ts"
  echo "     or convert dynamic imports to static top-level imports."
  exit 1
fi

echo "OK: No sensitive paths found in build traces."
