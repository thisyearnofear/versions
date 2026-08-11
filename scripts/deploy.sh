#!/bin/bash
# Deploy VERSIONS to the VPS via git pull + docker rebuild.
# Usage: ./scripts/deploy.sh
# Or:    ssh nuncio-vultr "cd /home/linuxuser/versions && ./scripts/deploy.sh"

set -e

cd "$(dirname "$0")/.."

echo "→ Pulling latest..."
git pull --ff-only

echo "→ Rebuilding container..."
docker compose up -d --build

echo "→ Waiting for health check..."
sleep 3

if docker exec versions wget -qO- http://localhost:3000/api/health/live > /dev/null 2>&1; then
  echo "✓ Healthy"
elif curl -sf http://localhost:3000/api/health/live > /dev/null 2>&1; then
  echo "✓ Healthy"
else
  echo "⚠ Health check inconclusive — check: docker logs versions --tail 10"
fi

echo "✓ Deployed."
