/**
 * Build every compendium source folder packs-src/<name>/ into a LevelDB pack at packs/<name>/.
 * Run in Docker: docker compose -f dev/docker-compose.yml run --rm node npm run build:packs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "packs-src");
const outRoot = path.join(root, "packs");

const packs = fs.readdirSync(srcRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (!packs.length) {
  console.error(`No pack sources found in ${srcRoot}`);
  process.exit(1);
}

for (const name of packs) {
  const src = path.join(srcRoot, name);
  const dest = path.join(outRoot, name);
  const count = fs.readdirSync(src).filter((f) => f.endsWith(".json")).length;
  await compilePack(src, dest, { recursive: true });
  console.log(`Built ${name}: ${count} documents -> ${path.relative(root, dest)}`);
}
