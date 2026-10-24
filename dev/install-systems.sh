#!/bin/bash
# Installs (or updates) the game systems into /data/Data/systems from their release manifests.
# Runs INSIDE the felddy/foundryvtt image (has curl, jq, unzip), as the foundry user, so file
# ownership matches the server. Idempotent: a system whose installed version equals the manifest
# version is skipped. Downloaded zips are kept in /cache/systems.
# Usage (from the host): docker compose -f dev/docker-compose.yml run --rm --no-deps \
#   --entrypoint bash foundry /work/dev/install-systems.sh
set -o errexit -o nounset -o pipefail

SYSTEMS_DIR=/data/Data/systems
CACHE_DIR=/cache/systems
MANIFESTS=(
  "CoC7|https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT/releases/latest/download/system.json"
  "deltagreen|https://github.com/deltagreen-foundryvtt/delta-green-foundry-vtt-system/releases/latest/download/system.json"
)

mkdir -p "$SYSTEMS_DIR" "$CACHE_DIR"

for entry in "${MANIFESTS[@]}"; do
  id="${entry%%|*}"
  url="${entry#*|}"
  manifest=$(curl -fsSL --retry 3 "$url")
  version=$(jq -r .version <<< "$manifest")
  download=$(jq -r .download <<< "$manifest")
  installed=""
  if [ -f "$SYSTEMS_DIR/$id/system.json" ]; then
    installed=$(jq -r .version "$SYSTEMS_DIR/$id/system.json")
  fi
  if [ "$installed" = "$version" ]; then
    echo "[systems] $id $version already installed"
    continue
  fi
  zip="$CACHE_DIR/$id-$version.zip"
  if [ ! -s "$zip" ]; then
    echo "[systems] downloading $id $version"
    curl -fsSL --retry 3 -o "$zip.part" "$download"
    mv "$zip.part" "$zip"
  fi
  tmp=$(mktemp -d)
  unzip -q "$zip" -d "$tmp"
  # The archive may hold system.json at its root or inside one top-level folder.
  manifest_path=$(find "$tmp" -maxdepth 2 -name system.json | head -n 1)
  if [ -z "$manifest_path" ]; then
    echo "[systems] ERROR: no system.json in $zip" >&2
    exit 1
  fi
  src=$(dirname "$manifest_path")
  got_id=$(jq -r .id "$manifest_path")
  if [ "$got_id" != "$id" ]; then
    echo "[systems] ERROR: expected id $id, archive has $got_id" >&2
    exit 1
  fi
  rm -rf "${SYSTEMS_DIR:?}/$id"
  mv "$src" "$SYSTEMS_DIR/$id"
  chmod 755 "$SYSTEMS_DIR/$id"
  rm -rf "$tmp"
  echo "[systems] installed $id $version (was: ${installed:-none})"
done
