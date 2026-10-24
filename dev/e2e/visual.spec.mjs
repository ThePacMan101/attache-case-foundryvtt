/**
 * Visual pass: a realistic "showcase" actor (real system compendium items, a backpack, worn armor,
 * an unstowed item) rendered in dark and light themes, next to the system's own actor sheet.
 * Writes dev/artifacts/<world>-visual-*.png; with SAVE_DOCS=1 also docs/screenshot-{dark,light}.png
 * (cropped to the window) from the CoC7 world.
 * Run: dev/e2e/run.sh visual.spec.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { WORLDS, ARTIFACTS_DIR, moduleErrors } from "./helpers.mjs";
import { session, resetWorld, caseSel, closeAll } from "./qa.mjs";

const DOCS_DIR = path.resolve(ARTIFACTS_DIR, "..", "..", "docs");

/** Item picks per system: [regex on name, required type]. */
const PICKS = {
  CoC7: [[/^\.38 Revolver|^\.45 Revolver/, "weapon"], [/^\.30-06 Bolt-Action Rifle/, "weapon"], [/^Knife, Medium/, "weapon"],
    [/^12-gauge Shotgun \(2B\)|^12-gauge Shotgun/, "weapon"], [/^Thompson/, "weapon"], [/^Dynamite/, "weapon"], [/^Machete|^Large Knife/, "weapon"]],
  deltagreen: [[/^Pistol \(Medium\)|^Medium Pistol/, "weapon"], [/^Rifle \(Light\)|^Carbine/, "weapon"], [/^Knife/, "weapon"],
    [/^Shotgun/, "weapon"], [/^Submachine Gun/, "weapon"], [/^Flashlight/, "weapon"], [/^Kevlar Vest/, "armor"], [/^Helmet/, "armor"]]
};

/** Build the showcase actor as GM; returns its id. */
async function showcase(page, system) {
  return page.evaluate(async ({ picks, system }) => {
    const sources = picks.map(([re, type]) => [new RegExp(re.source ?? re), type]);
    const packs = game.packs.filter((p) => p.documentName === "Item" && p.metadata.packageType === "system");
    const data = [];
    for (const [re, type] of sources) {
      let found = null;
      for (const p of packs) {
        const e = (await p.getIndex({ fields: ["type"] })).find((x) => x.type === type && re.test(x.name));
        if (e) { found = await p.getDocument(e._id); break; }
      }
      if (found) data.push(game.items.fromCompendium(found));
    }
    const type = system === "CoC7" ? "character" : "agent";
    const player = game.users.getName("Player");
    const actor = await Actor.create({
      name: system === "CoC7" ? "Harvey Walters" : "Agent Ramirez", type,
      img: system === "CoC7" ? "icons/svg/mystery-man.svg" : "icons/svg/mystery-man.svg",
      ownership: { default: 0, [player.id]: 3 },
      flags: { world: { attacheQA: true }, "attache-case": { body: { cols: 6, rows: 3 } } }
    });
    const inv = await import("/modules/attache-case/scripts/foundry/inventory.mjs");
    await inv.addPresetContainer(actor, "satchel");
    await actor.createEmbeddedDocuments("Item", data);
    // A few generic belongings with core icons.
    const gear = system === "CoC7" ? "item" : "gear";
    await actor.createEmbeddedDocuments("Item", [
      { name: "Field Journal", type: system === "CoC7" ? "book" : gear, img: "icons/sundries/books/book-worn-brown.webp" },
      { name: "Oil Lantern", type: gear, img: "icons/sundries/lights/lantern-iron-yellow.webp", flags: { "attache-case": { size: { w: 2, h: 2 } } } },
      { name: "Rope (15 m)", type: gear, img: "icons/sundries/survival/rope-wrapped-brown.webp", flags: { "attache-case": { size: { w: 2, h: 2 } } } },
      { name: "Lockpicks", type: gear, img: "icons/tools/hand/lockpicks-steel-grey.webp" },
      ...(system === "CoC7" ? [{ name: "Heavy Leather Jacket", type: "armor", img: "icons/equipment/chest/breastplate-collared-leather-brown.webp" }] : []),
      { name: "Whiskey Flask", type: gear, img: "icons/consumables/drinks/alcohol-spirits-bottle-blue.webp", flags: { "attache-case": { size: { w: 1, h: 2 } } } }
    ]);
    // Wear the smallest armor piece (if the system had one in the picks), then pack everything.
    const armor = actor.items.filter((i) => i.type === "armor").sort((a, b) => a.name.localeCompare(b.name)).at(0);
    if (armor) await inv.wearItem(actor, armor.id);
    await inv.autoArrange(actor);
    return actor.id;
  }, { picks: PICKS[system].map(([re, t]) => [{ source: re.source }, t]), system });
}

async function setScheme(page, scheme) {
  await page.evaluate(async (scheme) => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
    cfg.colorScheme = { applications: scheme, interface: scheme };
    await game.settings.set("core", "uiConfig", cfg);
    game.configureUI(cfg);
  }, scheme);
  await page.waitForTimeout(500);
}

for (const [worldId, meta] of Object.entries(WORLDS)) {
  test(`visual ${worldId}`, async ({ browser }) => {
    test.setTimeout(400_000);
    const gm = await session(browser, worldId, "Gamemaster");
    const page = gm.page;
    try {
      await resetWorld(page);
      const actorId = await showcase(page, meta.system);
      const root = page.locator(caseSel(actorId));
      for (const scheme of ["dark", "light"]) {
        await setScheme(page, scheme);
        await closeAll(page);
        // The system sheet on the left, the case on the right: does it look like it belongs?
        await page.evaluate(async (id) => {
          const actor = game.actors.get(id);
          await actor.sheet.render({ force: true });
          actor.sheet.setPosition({ left: 20, top: 20 });
          const app = game.modules.get("attache-case").api.open(actor);
          await new Promise((r) => setTimeout(r, 600));
          app.setPosition({ left: 760, top: 20 });
        }, actorId);
        await expect(root).toBeVisible();
        await page.evaluate(() => ui.notifications.clear());
        await page.waitForTimeout(800);
        await page.mouse.move(5, 990);
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${worldId}-visual-${scheme}-full.png`) });
        await root.screenshot({ path: path.join(ARTIFACTS_DIR, `${worldId}-visual-${scheme}.png`) });
        if (process.env.SAVE_DOCS && worldId === "attache-coc7") {
          // Alone on the scene: core windows are translucent and headless Chromium does not blur them.
          await page.evaluate((id) => game.actors.get(id).sheet.close({ animate: false }), actorId);
          await page.waitForTimeout(500);
          fs.mkdirSync(DOCS_DIR, { recursive: true });
          await root.screenshot({ path: path.join(DOCS_DIR, `screenshot-${scheme}.png`) });
        }
        // Dialogs.
        await root.locator("[data-action=configure]").click();
        const cfg = page.locator(`[id="attache-config-Actor-${actorId}"]`);
        await expect(cfg).toBeVisible();
        await page.waitForTimeout(400);
        await cfg.screenshot({ path: path.join(ARTIFACTS_DIR, `${worldId}-visual-${scheme}-config.png`) });
        const tile = root.locator(".attache-tile").first();
        await tile.click({ button: "right" });
        await page.locator("#context-menu .context-item", { hasText: "Inventory Size" }).click();
        const size = page.locator(".application.attache-size-config");
        await expect(size).toBeVisible();
        await page.waitForTimeout(400);
        await size.screenshot({ path: path.join(ARTIFACTS_DIR, `${worldId}-visual-${scheme}-size.png`) });
      }
      await setScheme(page, "dark");
    } finally {
      fs.writeFileSync(path.join(ARTIFACTS_DIR, `${worldId}-visual-console.json`), JSON.stringify(gm.errors, null, 2));
      await gm.ctx.close();
    }
    expect(moduleErrors(gm.errors)).toEqual([]);
  });
}
