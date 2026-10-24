#!/bin/sh
# Builds the distributable module: dist/module.json + dist/module.zip.
# Used by .github/workflows/release.yml and runnable locally (dry run) in Docker:
#   docker compose -f dev/docker-compose.yml run --rm node sh -c "apk add --no-cache zip >/dev/null && sh dev/package.sh"
#
# Optional environment (set by the release workflow):
#   TAG   release tag, e.g. v1.2.3 -> module.json "version" becomes 1.2.3
#   REPO  GitHub "owner/repo"      -> url / manifest / download point at that repository
# Without them the repository module.json is packaged unchanged (handy for a dry run).
# Expects packs/ to be built already (npm run build:packs). Never modifies tracked files.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST="$ROOT/dist"
STAGE="$DIST/stage"

# The only things that ship. Everything else (dev/, tests/, packs-src/, .llm/, node_modules/...) stays out.
RUNTIME_DIRS="scripts templates styles lang packs"
RUNTIME_FILES="module.json README.md LICENSE CHANGELOG.md"

cd "$ROOT"
for f in $RUNTIME_FILES; do [ -f "$f" ] || { echo "package.sh: missing $f" >&2; exit 1; }; done
for d in $RUNTIME_DIRS; do [ -d "$d" ] || { echo "package.sh: missing directory $d/" >&2; exit 1; }; done

rm -rf "$DIST"
mkdir -p "$STAGE"
# shellcheck disable=SC2086 # the lists are meant to be split
cp -R $RUNTIME_DIRS $RUNTIME_FILES "$STAGE/"

# LevelDB housekeeping files are recreated when Foundry opens a pack; NNNNNN.log (data) must stay.
find "$STAGE/packs" \( -name LOCK -o -name LOG -o -name LOG.old \) -type f -delete
find "$STAGE" \( -name .DS_Store -o -name Thumbs.db -o -name '.gitkeep' \) -type f -delete

# Rewrite and validate the staged manifest. Node is available both in CI and in the dev container.
TAG="${TAG:-}" REPO="${REPO:-}" node --input-type=module - "$STAGE" <<'EOF'
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const stage = process.argv[2];
const file = join(stage, "module.json");
const manifest = JSON.parse(readFileSync(file, "utf8"));
const { TAG, REPO } = process.env;
const fail = (msg) => { console.error(`package.sh: ${msg}`); process.exit(1); };

if (TAG) {
  const m = /^v(\d+\.\d+\.\d+)$/.exec(TAG);
  if (!m) fail(`tag "${TAG}" must look like v1.2.3`);
  manifest.version = m[1];
}
if (REPO) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) fail(`REPO "${REPO}" must look like owner/repo`);
  const base = `https://github.com/${REPO}`;
  // Replace the placeholder everywhere (bugs, readme, changelog...), then set the release URLs exactly.
  const swap = (v) => typeof v === "string" ? v.replace(/https:\/\/github\.com\/OWNER\/[\w.-]+/g, base)
    : Array.isArray(v) ? v.map(swap)
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v;
  Object.assign(manifest, swap(manifest));
  manifest.url = base;
  manifest.manifest = `${base}/releases/latest/download/module.json`;
  manifest.download = `${base}/releases/download/v${manifest.version}/module.zip`;
}

for (const key of ["id", "title", "version", "compatibility"]) if (!manifest[key]) fail(`module.json lacks "${key}"`);
if (manifest.id !== "attache-case") fail(`unexpected id "${manifest.id}"`);
// Only the URL placeholder: "OWNER" is also a legitimate value (packs[].ownership).
if (REPO && JSON.stringify(manifest).includes("github.com/OWNER/")) fail("OWNER placeholder left in module.json");

// Every path the manifest references must be inside the zip.
const paths = [
  ...(manifest.esmodules ?? []), ...(manifest.scripts ?? []), ...(manifest.styles ?? []),
  ...(manifest.languages ?? []).map((l) => l.path), ...(manifest.packs ?? []).map((p) => p.path)
];
const missing = paths.filter((p) => p && !existsSync(join(stage, p)));
if (missing.length) fail(`module.json references missing files: ${missing.join(", ")}`);

writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`module.json: ${manifest.id} ${manifest.version}`);
console.log(`  manifest: ${manifest.manifest ?? "(none)"}`);
console.log(`  download: ${manifest.download ?? "(none)"}`);
EOF

if [ -n "${REPO:-}" ]; then
  # Same placeholder in the shipped docs (README install URL, CHANGELOG links).
  sed -i "s#https://github.com/OWNER/[A-Za-z0-9._-]*#https://github.com/$REPO#g" \
    "$STAGE/README.md" "$STAGE/CHANGELOG.md"
fi

cp "$STAGE/module.json" "$DIST/module.json"
# -X: no extra file attributes, so the archive does not depend on who built it.
(cd "$STAGE" && zip -r -X -q "$DIST/module.zip" .)
rm -rf "$STAGE"

echo "Built $DIST/module.zip:"
unzip -l "$DIST/module.zip"
