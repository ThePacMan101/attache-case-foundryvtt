#!/bin/bash
# Fresh install check: builds the release zip, unpacks it as the only copy of this module in a clean
# Foundry data folder, creates new worlds and runs the smoke spec in each of them.
# Systems (and Plutonium, when this machine has it) come from dev/data, so run dev/setup.sh once first.
# The normal stack is stopped and left stopped. Takes over 6 minutes: run it in the background.
# Usage: dev/zip-check.sh
set -o errexit -o nounset -o pipefail
cd "$(dirname "$0")/.."
dev/guard-mnt-c.sh dev/data dev/data-zip dev/cache

BASE=(docker compose -f dev/docker-compose.yml)
ZIP=(docker compose -f dev/docker-compose.yml -f dev/docker-compose.zip.yml)
IMAGE=felddy/foundryvtt:14.369

for id in CoC7 deltagreen dnd5e; do
  [ -f "dev/data/Data/systems/$id/system.json" ] || { echo "[zip-check] missing system $id: run dev/setup.sh" >&2; exit 2; }
done

"${BASE[@]}" run --rm -T node sh -c "apk add --no-cache zip >/dev/null && sh dev/package.sh"
[ -s dist/module.zip ] || { echo "[zip-check] dist/module.zip was not built" >&2; exit 1; }
"${BASE[@]}" stop foundry >/dev/null 2>&1 || true

docker run --rm --user root --entrypoint sh -v "$PWD:/w" -w /w "$IMAGE" -c '
  set -eu
  rm -rf dev/data-zip
  mkdir -p dev/data-zip/Data/systems dev/data-zip/Data/worlds dev/data-zip/Data/modules/attache-case
  unzip -q dist/module.zip -d dev/data-zip/Data/modules/attache-case
  cp -R dev/data/Data/systems/CoC7 dev/data/Data/systems/deltagreen dev/data/Data/systems/dnd5e dev/data-zip/Data/systems/
  for id in plutonium lib-wrapper; do
    if [ -f "dev/data/Data/modules/$id/module.json" ]; then cp -R "dev/data/Data/modules/$id" dev/data-zip/Data/modules/; fi
  done
  chown -R 1000:1000 dev/data-zip'

"${ZIP[@]}" up -d foundry
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:${FOUNDRY_HOST_PORT:-30000}/api/status" 2>/dev/null && break
  sleep 3
done

status=0
"${ZIP[@]}" run --rm -T e2e bash -c '
  cmp -s package-lock.json node_modules/.lock-stamp || { npm ci --no-audit --no-fund >/dev/null && cp package-lock.json node_modules/.lock-stamp; }
  node setup-worlds.mjs && npx playwright test smoke.spec.mjs' || status=$?
"${ZIP[@]}" stop foundry >/dev/null 2>&1 || true
echo "[zip-check] finished with status $status"
exit $status
