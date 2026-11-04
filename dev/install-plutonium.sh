#!/bin/bash
# Copies Plutonium and libWrapper from the owner's Foundry install into the gitignored dev data dir,
# so the dnd5e world can run real imports. Plutonium is unlicensed paid content: it must never reach
# a tracked file, a fixture or the release.
#
# The source is only ever bind-mounted read-only, so this cannot write to it. Any destination under
# /mnt/c is refused, whichever way the path gets there. Without the source (CI) this is a no-op and
# everything that needs Plutonium skips. Idempotent: a module whose copied version equals the source
# is left alone, which keeps its writable state (storage/, LevelDB packs).
# Usage: dev/install-plutonium.sh
# Testing only: ATTACHE_MODULES_SRC and ATTACHE_MODULES_DEST override the two folders.
set -o errexit -o nounset -o pipefail
cd "$(dirname "$0")/.."

SRC="${ATTACHE_MODULES_SRC:-/mnt/c/Users/User/AppData/Local/FoundryVTT/Data/modules}"
DEST="${ATTACHE_MODULES_DEST:-$PWD/dev/data/Data/modules}"
IMAGE=felddy/foundryvtt:14.369
MODULES=(plutonium lib-wrapper)

log() { printf '[plutonium] %s\n' "$*"; }

# Resolve symlinks first, so a link into the owner's install cannot slip past the check.
dest_real=$(realpath -m -- "$DEST")
case "${dest_real,,}/" in
  /mnt/c/*)
    log "REFUSED: destination $dest_real is under /mnt/c; nothing was written." >&2
    exit 3
    ;;
esac

if [ ! -d "$SRC" ]; then
  log "source $SRC is absent: skipping (Plutonium specs will skip)."
  exit 0
fi
src_real=$(realpath -- "$SRC")
case "$dest_real/" in
  "$src_real"/*)
    log "REFUSED: destination $dest_real is inside the source $src_real; nothing was written." >&2
    exit 3
    ;;
esac

# Runs as root in Docker because dev/data belongs to uid 1000. Copies into a temp folder first, so an
# interrupted run never looks installed.
# shellcheck disable=SC2016 # expanded inside the container
docker run --rm --user root --entrypoint sh \
  -v "$src_real:/src:ro" -v "$dest_real:/dest" "$IMAGE" -c '
    set -eu
    [ "$(stat -c %u /dest)" = 1000 ] || chown 1000:1000 /dest
    for id in "$@"; do
      if [ ! -f "/src/$id/module.json" ]; then
        echo "[plutonium] $id is not in the source: skipping"
        continue
      fi
      version=$(jq -r .version "/src/$id/module.json")
      if [ "$(cat "/dest/$id/.attache-copied-version" 2>/dev/null)" = "$version" ]; then
        echo "[plutonium] $id $version already copied"
        continue
      fi
      echo "[plutonium] copying $id $version"
      rm -rf "/dest/$id.partial"
      cp -R "/src/$id" "/dest/$id.partial"
      echo "$version" > "/dest/$id.partial/.attache-copied-version"
      chown -R 1000:1000 "/dest/$id.partial"
      rm -rf "/dest/$id"
      mv "/dest/$id.partial" "/dest/$id"
    done' sh "${MODULES[@]}"

# The copy must never be committable.
if [ -z "${ATTACHE_MODULES_DEST:-}" ] && command -v git >/dev/null; then
  for id in "${MODULES[@]}"; do
    [ -e "dev/data/Data/modules/$id" ] || continue
    if ! git check-ignore -q "dev/data/Data/modules/$id/module.json"; then
      log "ERROR: dev/data/Data/modules/$id is NOT gitignored; fix .gitignore before going on." >&2
      exit 4
    fi
    log "git check-ignore: dev/data/Data/modules/$id is ignored"
  done
fi
