#!/bin/bash
# Rebuilds every compendium from packs-src and gives Foundry a fresh writable copy of them.
# Foundry must be stopped meanwhile: LevelDB holds a lock on the copy it has open.
# Usage: dev/rebuild-packs.sh
set -o errexit -o nounset -o pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f dev/docker-compose.yml)
PORT="${FOUNDRY_HOST_PORT:-30000}"

"${COMPOSE[@]}" stop foundry >/dev/null 2>&1 || true
"${COMPOSE[@]}" run --rm -T node npm run -s build:packs
dev/setup.sh --packs-only
"${COMPOSE[@]}" up -d foundry
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/status" 2>/dev/null; then
    echo "[rebuild-packs] packs rebuilt; foundry answering on http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 3
done
echo "[rebuild-packs] ERROR: foundry did not answer within 3 minutes" >&2
exit 1
