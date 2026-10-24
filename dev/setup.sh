#!/bin/bash
# One-command, idempotent Foundry VTT v14 dev environment (everything runs in Docker):
#   1. checks .env has usable credentials (never prints them)
#   2. prepares dev/data + dev/cache (owned by the container user, uid 1000)
#   3. installs/updates the CoC7 and Delta Green systems (dev/install-systems.sh)
#   4. starts the foundry service and waits for it
#   5. copies the Foundry client/common source to dev/cache/foundry-src (for API research)
#   6. creates/updates the worlds attache-coc7 + attache-dg (dev/e2e/setup-worlds.mjs)
# Usage: dev/setup.sh
set -o errexit -o nounset -o pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f dev/docker-compose.yml)
IMAGE=felddy/foundryvtt:14.369
VERSION=14.369
PORT="${FOUNDRY_HOST_PORT:-30000}"

log() { printf '\033[1m[setup]\033[0m %s\n' "$*"; }

# True when KEY has a non-empty value in .env (value is never printed).
env_set() { [ -f .env ] && grep -qE "^$1=.+" .env; }

# --- 1. credentials -------------------------------------------------------------------------------
if [ -f .env ] && grep -vqE '^\s*(#.*)?$|^[A-Za-z_][A-Za-z0-9_]*=' .env; then
  log "ERROR: .env has lines that are not KEY=value (see .env.example)."; exit 2
fi
have_zip=false
[ -s "dev/cache/foundry/foundryvtt-$VERSION.zip" ] && have_zip=true
installed=false
[ -f dev/data/Config/license.json ] && installed=true
if ! { env_set FOUNDRY_USERNAME && env_set FOUNDRY_PASSWORD; } && ! env_set FOUNDRY_RELEASE_URL \
   && ! { $have_zip && { $installed || env_set FOUNDRY_LICENSE_KEY; }; }; then
  log "BLOCKED: .env needs FOUNDRY_USERNAME + FOUNDRY_PASSWORD, or FOUNDRY_RELEASE_URL"
  log "(or a cached dev/cache/foundry/foundryvtt-$VERSION.zip plus FOUNDRY_LICENSE_KEY). See .env.example."
  exit 2
fi
env_set FOUNDRY_ADMIN_KEY || log "note: FOUNDRY_ADMIN_KEY is empty, the setup screen will have no admin password"

# --- 2. directories -------------------------------------------------------------------------------
# The module mountpoint must exist before compose bind-mounts the repo into it, otherwise Docker
# creates Data/ and Data/modules as root and Foundry (uid 1000) cannot write there.
mkdir -p dev/data dev/cache dev/artifacts
docker run --rm --user root --entrypoint sh -v "$PWD/dev/data:/data" -v "$PWD/dev/cache:/cache" "$IMAGE" -c '
  mkdir -p /data/Data/modules/attache-case /data/Data/systems /data/Data/worlds /cache/foundry /cache/systems
  for d in /data /data/Data /data/Data/modules /data/Data/modules/attache-case /data/Data/systems \
           /data/Data/worlds /cache /cache/foundry /cache/systems; do
    [ "$(stat -c %u "$d")" = 1000 ] || chown 1000:1000 "$d"
  done'

# Writable copy of the compendium packs for Foundry (the repo mount is read-only, LevelDB is not).
# Refreshed when the repo packs change (e.g. after `npm run build:packs`); Foundry must not hold
# them open meanwhile, so it is stopped first and started again below.
stamp=$(cd packs && find . -type f ! -name 'LOCK' ! -name 'LOG*' -exec sha256sum {} + | sort | sha256sum | cut -c1-64)
if [ "$(cat dev/data/module-packs/.stamp 2>/dev/null)" != "$stamp" ]; then
  log "refreshing the writable pack copy dev/data/module-packs"
  "${COMPOSE[@]}" stop foundry >/dev/null 2>&1 || true
  docker run --rm --user root --entrypoint sh -v "$PWD/dev/data:/data" -v "$PWD/packs:/packs:ro" "$IMAGE" -c "
    rm -rf /data/module-packs && mkdir -p /data/module-packs && cp -a /packs/. /data/module-packs/ &&
    echo $stamp > /data/module-packs/.stamp && chown -R 1000:1000 /data/module-packs"
fi

# --- 3. systems -----------------------------------------------------------------------------------
log "installing game systems"
"${COMPOSE[@]}" run --rm --no-deps -T --entrypoint bash foundry /work/dev/install-systems.sh

# --- 4. foundry -----------------------------------------------------------------------------------
log "starting foundry (first run downloads Foundry $VERSION into dev/cache/foundry)"
"${COMPOSE[@]}" up -d foundry
for i in $(seq 1 120); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/status" 2>/dev/null; then break; fi
  if [ -z "$("${COMPOSE[@]}" ps -q --status running foundry)" ]; then
    log "ERROR: foundry container stopped. Last log lines:"
    "${COMPOSE[@]}" logs --no-log-prefix --tail 25 foundry
    exit 1
  fi
  [ "$i" = 120 ] && { log "ERROR: foundry did not answer within 10 minutes"; exit 1; }
  sleep 5
done
log "foundry answering on http://127.0.0.1:$PORT"

# --- 5. source for API research -------------------------------------------------------------------
SRC=dev/cache/foundry-src
if [ "$(cat "$SRC/VERSION" 2>/dev/null)" != "$VERSION" ]; then
  log "copying Foundry client source to $SRC"
  rm -rf "$SRC" && mkdir -p "$SRC"
  # shellcheck disable=SC2016 # expanded inside the container
  "${COMPOSE[@]}" exec -T foundry sh -c \
    'cd resources/app && tar -cf - $(for d in client common public/scripts; do [ -e "$d" ] && echo "$d"; done)' \
    | tar -C "$SRC" -xf -
  echo "$VERSION" > "$SRC/VERSION"
fi

# --- 6. worlds ------------------------------------------------------------------------------------
log "provisioning worlds"
dev/e2e/run.sh node setup-worlds.mjs
log "ready. Smoke test: dev/e2e/run.sh smoke.spec.mjs"
