#!/bin/bash
# Run Playwright inside the e2e container (Foundry must be up: dev/setup.sh).
#   dev/e2e/run.sh                      -> all specs
#   dev/e2e/run.sh smoke.spec.mjs -g dg -> playwright test args
#   dev/e2e/run.sh node shot.mjs ...    -> any command in dev/e2e (node scripts)
set -o errexit -o nounset -o pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "node" ] || [ "${1:-}" = "npx" ] || [ "${1:-}" = "bash" ]; then
  cmd=("$@")
else
  cmd=(npx playwright test "$@")
fi
mkdir -p artifacts
# Idempotent: make sure the server container is running.
docker compose -f docker-compose.yml up -d foundry >/dev/null 2>&1
# Install the pinned @playwright/test into the named volume once (re-run when the lockfile changes).
exec docker compose -f docker-compose.yml run --rm -T e2e bash -c '
  if ! cmp -s package-lock.json node_modules/.lock-stamp; then
    npm ci --no-audit --no-fund >/dev/null && cp package-lock.json node_modules/.lock-stamp
  fi
  exec "$@"' bash "${cmd[@]}"
