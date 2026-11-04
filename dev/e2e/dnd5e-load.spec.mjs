/**
 * dnd5e smoke. Both worlds load with the module active and no console error that mentions it, for GM and
 * Player. On the clean world, the case opens from the sheet kebab, the Actor Directory menu and the `I`
 * key, for GM and Player, by real clicks; group and encounter actors have no entry; the item sheets have
 * ours. Sizing, bags and Worn are tested elsewhere (M3, M4).
 */

import { test, expect } from "@playwright/test";
import {
  DND5E_WORLDS, FIVE_E_TOOLS, launchWorld, loginAs, collectConsoleErrors, moduleErrors, plutoniumInstalled,
  waitForPlutonium, SEED_FLAG
} from "./helpers.mjs";
import { session, resetWorld, makeActor, caseSel, closeAll, clickMenu, clearNotifications, QA_FLAG } from "./qa.mjs";

for (const [worldId, meta] of Object.entries(DND5E_WORLDS)) {
  const wantsPlutonium = meta.modules.includes("plutonium");
  for (const user of ["Gamemaster", "Player"]) {
    test(`loads ${worldId} as ${user}`, async ({ browser }) => {
      test.skip(wantsPlutonium && !plutoniumInstalled(), "no Plutonium copy on this machine");
      const ctx = await browser.newContext();
      await ctx.route(FIVE_E_TOOLS, (route) => route.abort());
      const page = await ctx.newPage();
      const errors = collectConsoleErrors(page);
      await launchWorld(page, worldId);
      await loginAs(page, user);
      if (wantsPlutonium) await waitForPlutonium(page);

      const info = await page.evaluate(() => ({
        system: game.system.id,
        systemVersion: game.system.version,
        served: game.modules.has("attache-case"),
        enabled: game.settings.get("core", "moduleConfiguration")["attache-case"] === true,
        ours: game.modules.get("attache-case")?.active === true,
        api: typeof game.modules.get("attache-case")?.api?.open,
        plutonium: game.modules.get("plutonium")?.active === true,
        libWrapper: game.modules.get("lib-wrapper")?.active === true
      }));
      console.log(`[load] ${worldId} ${user}: ${JSON.stringify(info)}`);
      await ctx.close();
      expect(info.system).toBe("dnd5e");
      expect(info.systemVersion).toBe("5.3.3");
      expect(info.enabled, "attache-case enabled in the world").toBe(true);
      expect(info.served, "the server sends the module").toBe(true);
      expect(info.ours, "attache-case active").toBe(true);
      expect(info.api).toBe("function");
      expect(info.plutonium).toBe(wantsPlutonium);
      expect(info.libWrapper).toBe(wantsPlutonium);
      expect(moduleErrors(errors), "console errors from attache-case").toEqual([]);
    });
  }
}

test.describe.serial("attache-dnd5e opening", () => {
  const WORLD = "attache-dnd5e";
  const ENTRY = "Attaché Case";
  let gm;
  let pl;
  let seed;

  /** Open a document's sheet (setup), then its kebab (click). */
  async function openKebab(page, id) {
    await page.evaluate(async ({ id }) => {
      const doc = await fromUuid(id);
      await doc.sheet.render({ force: true });
    }, { id });
    const sheetId = await page.evaluate(async (id) => (await fromUuid(id)).sheet.id, id);
    const sheet = page.locator(`[id="${sheetId}"]`);
    await expect(sheet).toBeVisible();
    await sheet.locator("[data-action=toggleControls]").first().click();
    await expect(page.locator("#context-menu .context-item").first()).toBeVisible();
  }

  const entries = (page, text) => page.locator("#context-menu .context-item", { hasText: text });

  async function closeMenu(page) {
    await page.mouse.click(5, 500);
    await expect(page.locator("#context-menu")).toHaveCount(0);
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(400_000);
    gm = await session(browser, WORLD, "Gamemaster", { canvas: false });
    await resetWorld(gm.page);
    pl = await session(browser, WORLD, "Player", { canvas: false });
    seed = await gm.page.evaluate((flag) => game.actors.find((a) => a.getFlag(flag.scope, flag.key))?.id, SEED_FLAG);
  });

  test.afterEach(async () => {
    for (const s of [gm, pl]) if (s) await closeAll(s.page).catch(() => {});
  });

  test.afterAll(async () => {
    await gm?.ctx.close();
    await pl?.ctx.close();
  });

  for (const role of ["GM", "Player"]) {
    test(`opens from the kebab, the directory and I as ${role}`, async () => {
      const { page } = role === "GM" ? gm : pl;
      expect(seed, "seeded character exists (run dev/setup.sh)").toBeTruthy();

      await openKebab(page, `Actor.${seed}`);
      await clickMenu(page, ENTRY);
      await expect(page.locator(caseSel(seed))).toBeVisible();
      await expect(page.locator(`${caseSel(seed)} .attache-layout`)).toBeVisible();
      await closeAll(page);

      await page.evaluate(() => ui.actors.activate());
      await page.locator(`#actors .directory-item[data-entry-id="${seed}"]`).click({ button: "right" });
      await clickMenu(page, ENTRY);
      await expect(page.locator(caseSel(seed))).toBeVisible();
      await closeAll(page);

      // The key opens the user's own character, so the GM needs one for this check.
      if (role === "GM") await page.evaluate((id) => game.user.update({ character: id }), seed);
      await page.mouse.click(800, 600);
      await page.keyboard.press("KeyI");
      await expect(page.locator(caseSel(seed))).toBeVisible();
      await page.keyboard.press("KeyI");
      await expect(page.locator(caseSel(seed))).toHaveCount(0);
      if (role === "GM") await page.evaluate(() => game.user.update({ character: null }));
    });
  }

  test("npc and vehicle sheets have the entry", async () => {
    for (const actorType of ["npc", "vehicle"]) {
      const { actorId } = await makeActor(gm.page, { name: `QA ${actorType}`, actorType });
      await openKebab(gm.page, `Actor.${actorId}`);
      await clickMenu(gm.page, ENTRY);
      await expect(gm.page.locator(caseSel(actorId))).toBeVisible();
      await closeAll(gm.page);
      await openKebab(pl.page, `Actor.${actorId}`);
      await clickMenu(pl.page, ENTRY);
      await expect(pl.page.locator(caseSel(actorId))).toBeVisible();
      await closeAll(pl.page);
    }
  });

  test("group and encounter actors have no entry", async () => {
    for (const actorType of ["group", "encounter"]) {
      const { actorId } = await makeActor(gm.page, { name: `QA ${actorType}`, actorType, defaultLevel: 3 });
      for (const { page } of [gm, pl]) {
        await openKebab(page, `Actor.${actorId}`);
        await expect(entries(page, ENTRY)).toHaveCount(0);
        await closeMenu(page);
        await closeAll(page);

        await page.evaluate(() => ui.actors.activate());
        await page.locator(`#actors .directory-item[data-entry-id="${actorId}"]`).click({ button: "right" });
        await expect(page.locator("#context-menu .context-item").first()).toBeVisible();
        await expect(entries(page, ENTRY)).toHaveCount(0);
        await closeMenu(page);

        // The API refuses too, with the normal warning.
        await clearNotifications(page);
        await page.evaluate((id) => game.modules.get("attache-case").api.open(game.actors.get(id)), actorId);
        await expect(page.locator(caseSel(actorId))).toHaveCount(0);
        await expect(page.locator("#notifications .notification", { hasText: "not supported" }).first()).toBeVisible();
      }
    }
  });

  test("the item sheet menu works on item and container sheets", async () => {
    const { actorId, ids } = await makeActor(gm.page, {
      name: "QA Item Sheets",
      items: [{ key: "sword", name: "Zzyzx Blade", kind: "weapon" }]
    });
    const bagId = await gm.page.evaluate(async (id) => {
      const [bag] = await game.actors.get(id).createEmbeddedDocuments("Item", [{ name: "Zzyzx Bag", type: "container" }]);
      return bag.id;
    }, actorId);
    for (const itemId of [ids.sword, bagId]) {
      const uuid = `Actor.${actorId}.Item.${itemId}`;

      await openKebab(gm.page, uuid);
      await expect(entries(gm.page, "Inventory Size")).toHaveCount(1);
      await expect(entries(gm.page, "Change Image")).toHaveCount(1);
      await clickMenu(gm.page, "Inventory Size");
      await expect(gm.page.locator(".application.attache-size-config")).toBeVisible();
      await closeAll(gm.page);

      await openKebab(gm.page, uuid);
      await clickMenu(gm.page, "Change Image");
      await expect(gm.page.locator(".application.attache-art-config")).toBeVisible();
      await closeAll(gm.page);

      await openKebab(pl.page, uuid);
      await expect(entries(pl.page, "Inventory Size"), "needs the Players Edit Sizes setting").toHaveCount(0);
      await clickMenu(pl.page, "Change Image");
      await expect(pl.page.locator(".application.attache-art-config")).toBeVisible();
      await closeAll(pl.page);
    }
  });

  test("presets: only the short list, and a preset adds a dnd5e container", async () => {
    const presets = await gm.page.evaluate(() => game.modules.get("attache-case").api.presets.map((p) => p.key));
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.length).toBeLessThan(12);
    const { actorId } = await makeActor(gm.page, { name: "QA Preset" });
    await gm.page.evaluate((id) => game.modules.get("attache-case").api.open(game.actors.get(id)), actorId);
    const root = gm.page.locator(caseSel(actorId));
    await root.locator("[data-action=configure]").click();
    const config = gm.page.locator(".application.attache-actor-config");
    await expect(config).toBeVisible();
    await expect(config.locator('select[name="preset"] option')).toHaveCount(presets.length);
    await config.locator("[data-action=addContainer]").click();
    await expect(root.locator(".attache-panel")).toHaveCount(2);
    expect(await gm.page.evaluate((id) => game.actors.get(id).items.contents[0].type, actorId)).toBe("container");
  });

  test("console: no errors or warnings from attache-case", async () => {
    expect(moduleErrors(gm.errors), "GM").toEqual([]);
    expect(moduleErrors(pl.errors), "Player").toEqual([]);
    await gm.page.evaluate(async (flag) => {
      const actors = game.actors.filter((a) => a.getFlag(flag.scope, flag.key));
      if (actors.length) await Actor.deleteDocuments(actors.map((a) => a.id));
    }, QA_FLAG);
  });
});
