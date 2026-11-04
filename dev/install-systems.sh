#!/bin/bash
# Installs (or updates) the game systems into /data/Data/systems. Runs INSIDE the felddy/foundryvtt
# image (has curl, jq, unzip), as the foundry user, so file ownership matches the server.
# Idempotent: a system already at the wanted version is skipped. Zips are kept in /cache/systems.
#   MANIFESTS: follow the latest release manifest.
#   PINNED:    exactly this version. A failed download is an error, never another version: the module
#              targets the version the owner runs, and other dnd5e majors have different APIs.
# Usage (from the host): docker compose -f dev/docker-compose.yml run --rm --no-deps \
#   --entrypoint bash foundry /work/dev/install-systems.sh
set -o errexit -o nounset -o pipefail

SYSTEMS_DIR=/data/Data/systems
CACHE_DIR=/cache/systems
MANIFESTS=(
  "CoC7|https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT/releases/latest/download/system.json"
  "deltagreen|https://github.com/deltagreen-foundryvtt/delta-green-foundry-vtt-system/releases/latest/download/system.json"
)
PINNED=(
  "dnd5e|5.3.3|https://github.com/foundryvtt/dnd5e/releases/download/release-5.3.3/dnd5e-release-5.3.3.zip"
)

mkdir -p "$SYSTEMS_DIR" "$CACHE_DIR"

# Version of an installed system, empty when it is not installed.
installed_version() {
  if [ -f "$SYSTEMS_DIR/$1/system.json" ]; then jq -r .version "$SYSTEMS_DIR/$1/system.json"; fi
}

# install_archive <id> <zip> <previous version> [required version]
install_archive() {
  local id="$1" zip="$2" previous="$3" required="${4:-}" tmp manifest_path src got_id got_version
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
  got_version=$(jq -r .version "$manifest_path")
  if [ "$got_id" != "$id" ]; then
    echo "[systems] ERROR: expected id $id, archive has $got_id" >&2
    exit 1
  fi
  if [ -n "$required" ] && [ "$got_version" != "$required" ]; then
    echo "[systems] ERROR: $id must be $required, archive has $got_version; nothing installed" >&2
    exit 1
  fi
  rm -rf "${SYSTEMS_DIR:?}/$id"
  mv "$src" "$SYSTEMS_DIR/$id"
  chmod 755 "$SYSTEMS_DIR/$id"
  rm -rf "$tmp"
  echo "[systems] installed $id $got_version (was: ${previous:-none})"
}

for entry in "${MANIFESTS[@]}"; do
  id="${entry%%|*}"
  url="${entry#*|}"
  manifest=$(curl -fsSL --retry 3 "$url")
  version=$(jq -r .version <<< "$manifest")
  download=$(jq -r .download <<< "$manifest")
  installed=$(installed_version "$id")
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
  install_archive "$id" "$zip" "$installed"
done

for entry in "${PINNED[@]}"; do
  IFS='|' read -r id version download <<< "$entry"
  installed=$(installed_version "$id")
  if [ "$installed" = "$version" ]; then
    echo "[systems] $id $version already installed (pinned)"
    continue
  fi
  zip="$CACHE_DIR/$id-$version.zip"
  if [ ! -s "$zip" ]; then
    echo "[systems] downloading $id $version (pinned)"
    if ! curl -fsSL --retry 3 -o "$zip.part" "$download"; then
      rm -f "$zip.part"
      echo "[systems] ERROR: could not download $id $version from $download; no other version is used" >&2
      exit 1
    fi
    mv "$zip.part" "$zip"
  fi
  install_archive "$id" "$zip" "$installed" "$version"
done
