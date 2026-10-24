/**
 * Idempotent world provisioning for the dev server (called by dev/setup.sh inside the e2e container).
 * For every world in WORLDS: create it if missing, launch it, log in as Gamemaster, enable
 * `attache-case`, ensure a "Player" user and a Player-owned character that carries a few compendium
 * weapons and armor. Leaves the server on the setup screen.
 */

import fs from "node:fs";
import { chromium } from "@playwright/test";
import {
  FOUNDRY_URL, WORLDS, SEED_FLAG, waitForServer, ensureSetupAccess, postAction, launchWorld,
  loginAs, waitForGameReady, shutdownWorld, waitFor, collectConsoleErrors
} from "./helpers.mjs";

const WORLDS_DIR = "/work/dev/data/Data/worlds";

/**
 * Create `worldId` through the setup API unless its world.json already exists.
 * @param {import("@playwright/test").Page} page
 */
async function ensureWorld(page, worldId, { system, title }) {
  if (fs.existsSync(`${WORLDS_DIR}/${worldId}/world.json`)) {
    console.log(`[setup] world ${worldId} exists`);
    return;
  }
  await ensureSetupAccess(page);
  // v14 serves world creation from the /create view, not /setup.
  const res = await postAction(page, "/create", {
    action: "createWorld", id: worldId, title, system, description: "Attaché Case dev/test world."
  });
  if (res.status >= 400) throw new Error(`createWorld ${worldId}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  await waitFor(async () => fs.existsSync(`${WORLDS_DIR}/${worldId}/world.json`), 30_000, `${worldId}/world.json`);
  console.log(`[setup] created world ${worldId} (${system})`);
}

/** Runs in the browser as GM: enable our module. Returns true when a reload is needed. */
async function enableModule(page) {
  return page.evaluate(async () => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration") ?? {});
    if (cfg["attache-case"] === true) return false;
    cfg["attache-case"] = true;
    await game.settings.set("core", "moduleConfiguration", cfg);
    return true;
  });
}

/** Runs in the browser as GM: users + seeded character. */
async function seed(page, actorType) {
  return page.evaluate(async ({ actorType, flag }) => {
    const report = {};
    let player = game.users.getName("Player");
    if (!player) {
      player = await User.create({ name: "Player", role: CONST.USER_ROLES.PLAYER });
      report.createdPlayer = true;
    }
    let actor = game.actors.find((a) => a.getFlag(flag.scope, flag.key));
    if (!actor) {
      const name = actorType === "agent" ? "Agent Test" : "Investigator Test";
      actor = await Actor.create({
        name, type: actorType,
        ownership: { default: 0, [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        flags: { [flag.scope]: { [flag.key]: true } }
      });
      report.createdActor = actor.name;
    }
    if (player.character?.id !== actor.id) await player.update({ character: actor.id });

    if (!actor.items.some((i) => ["weapon", "armor"].includes(i.type))) {
      const packs = game.packs.filter((p) => p.documentName === "Item" && p.metadata.packageType === "system");
      const entries = [];
      for (const pack of packs) {
        const index = await pack.getIndex({ fields: ["type"] });
        for (const e of index) entries.push({ pack, e });
      }
      const notUnarmed = ({ e }) => !/unarmed|brawl/i.test(e.name);
      const weapons = entries.filter(({ e }) => e.type === "weapon").filter(notUnarmed);
      const armor = entries.filter(({ e }) => e.type === "armor");
      const preferred = [/revolver/i, /knife/i, /shotgun|rifle/i];
      const picks = [];
      for (const re of preferred) {
        const hit = weapons.find((w) => re.test(w.e.name) && !picks.includes(w));
        if (hit) picks.push(hit);
      }
      for (const w of weapons) if (picks.length < 3 && !picks.includes(w)) picks.push(w);
      picks.push(...armor.slice(0, 2));
      const data = [];
      for (const { pack, e } of picks) {
        const doc = await pack.getDocument(e._id);
        data.push(game.items.fromCompendium(doc));
      }
      if (!armor.length) data.push({ name: "Leather Jacket", type: "armor" });
      const created = await actor.createEmbeddedDocuments("Item", data);
      report.items = created.map((i) => `${i.type}: ${i.name}`);
    }
    report.actor = { id: actor.id, name: actor.name, items: actor.items.size };
    report.users = game.users.map((u) => `${u.name} (role ${u.role})`);
    return report;
  }, { actorType, flag: SEED_FLAG });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = collectConsoleErrors(page);
let failed = false;
try {
  await waitForServer();
  console.log(`[setup] Foundry answering at ${FOUNDRY_URL}`);
  await shutdownWorld(page);
  for (const [worldId, meta] of Object.entries(WORLDS)) await ensureWorld(page, worldId, meta);
  for (const [worldId, meta] of Object.entries(WORLDS)) {
    await launchWorld(page, worldId);
    await loginAs(page, "Gamemaster");
    if (await enableModule(page)) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForGameReady(page);
    }
    const active = await page.evaluate(() => game.modules.get("attache-case")?.active === true);
    if (!active) throw new Error(`attache-case is not active in ${worldId}`);
    const report = await seed(page, meta.actorType);
    console.log(`[setup] ${worldId}: system=${await page.evaluate(() => `${game.system.id} ${game.system.version}`)}`
      + ` module active; ${JSON.stringify(report)}`);
  }
  await shutdownWorld(page);
  console.log("[setup] done; server is back on the setup screen");
} catch (err) {
  failed = true;
  console.error(`[setup] FAILED at ${page.url()}: ${err.stack ?? err}`);
  await page.screenshot({ path: "/work/dev/artifacts/setup-failure.png" }).catch(() => {});
  if (errors.length) console.error("[setup] browser console errors:\n" + errors.map((e) => `  ${e.text}`).join("\n"));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
