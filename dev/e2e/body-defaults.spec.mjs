/**
 * Default inventory size per system and the GM reset, on CoC7, Delta Green and clean dnd5e, with a GM
 * and a Player client. Real mouse and keyboard; `page.evaluate` only for fixtures and assertions.
 * Screenshots: dev/artifacts/<world>-reset-*.png, light and dark.
 * Run: dev/e2e/run.sh body-defaults.spec.mjs [-g "<world>"]
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { WORLDS, DND5E_WORLDS, ARTIFACTS_DIR, moduleErrors, waitForGameReady } from "./helpers.mjs";
import { session, resetWorld, makeActor, openCase, closeAll, layout, clearNotifications, setScheme, QA_FLAG } from "./qa.mjs";

const SIZE_WORLDS = { ...WORLDS, "attache-dnd5e": DND5E_WORLDS["attache-dnd5e"] };
const WANT = { CoC7: { cols: 5, rows: 3 }, deltagreen: { cols: 5, rows: 3 }, dnd5e: { cols: 8, rows: 5 } };

const RESET_BUTTON = '[data-action="openSubmenu"][data-key="attache-case.resetBodies"]';

/** Remove the saved values, as in a world where the GM never touched them. */
async function forgetSaved(page) {
  await page.evaluate(async () => {
    const world = game.settings.storage.get("world");
    for (const key of ["defaultBodyCols", "defaultBodyRows"]) await world.getSetting(`attache-case.${key}`)?.delete();
  });
}

async function reload(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForGameReady(page);
}

async function openSettings(page) {
  // Opening the window is setup; everything inside it is clicked.
  await page.evaluate(() => new foundry.applications.settings.SettingsConfig().render({ force: true }));
  const sc = page.locator(".application#settings-config, .application.settings-config").first();
  await expect(sc).toBeVisible();
  await sc.locator('[data-tab="attache-case"], [data-category="attache-case"]').first().click();
  return sc;
}

const bodyPanel = (root) => root.locator(".attache-panel.is-body");
const stored = (page, actorId) => page.evaluate((id) => game.actors.get(id).flags["attache-case"]?.body ?? null, actorId);

for (const [worldId, meta] of Object.entries(SIZE_WORLDS)) {
  const want = WANT[meta.system];
  const wantStyle = new RegExp(`--cols: ${want.cols}; --rows: ${want.rows}`);

  test.describe.serial(`${worldId} body defaults`, () => {
    let gm;
    let pl;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(400_000);
      gm = await session(browser, worldId, "Gamemaster", { canvas: false });
      await resetWorld(gm.page);
      await gm.page.evaluate(async (flag) => {
        const scenes = game.scenes.filter((s) => s.getFlag(flag.scope, flag.key));
        if (scenes.length) await Scene.deleteDocuments(scenes.map((s) => s.id));
      }, QA_FLAG);
      pl = await session(browser, worldId, "Player", { canvas: false });
    });

    test.afterEach(async () => {
      for (const s of [gm, pl]) if (s) await closeAll(s.page).catch(() => {});
    });

    test.afterAll(async () => {
      if (gm) await gm.page.evaluate(async (flag) => {
        const scenes = game.scenes.filter((s) => s.getFlag(flag.scope, flag.key));
        if (scenes.length) await Scene.deleteDocuments(scenes.map((s) => s.id));
      }, QA_FLAG).catch(() => {});
      await gm?.ctx.close();
      await pl?.ctx.close();
    });

    test(`01 a world with nothing saved gives ${want.cols}x${want.rows}`, async () => {
      await forgetSaved(gm.page);
      await reload(gm.page);
      await reload(pl.page);
      const { actorId } = await makeActor(gm.page, { name: "QA Default" });
      for (const s of [gm, pl]) {
        const root = await openCase(s.page, actorId);
        await expect(bodyPanel(root)).toHaveAttribute("style", wantStyle);
        expect((await layout(s.page, actorId)).containers[0]).toMatchObject(want);
        expect(await s.page.evaluate(() => [game.settings.get("attache-case", "defaultBodyCols"), game.settings.get("attache-case", "defaultBodyRows")])).toEqual([want.cols, want.rows]);
      }
    });

    test("02 a value the GM saved survives a reload, and an actor's own size still wins", async () => {
      const page = gm.page;
      const sc = await openSettings(page);
      for (const [key, value] of [["defaultBodyCols", "7"], ["defaultBodyRows", "4"]]) {
        // A NumberField with min, max and step renders as <range-picker>, around a number input.
        const input = sc.locator(`[name="attache-case.${key}"] input[type="number"]`).first();
        await expect(input).toHaveValue(key === "defaultBodyCols" ? String(want.cols) : String(want.rows));
        await input.click();
        await page.keyboard.press("Control+A");
        await page.keyboard.type(value);
        await page.keyboard.press("Tab");
      }
      await sc.locator('button[type="submit"]').click();
      await expect.poll(() => page.evaluate(() => game.settings.get("attache-case", "defaultBodyCols"))).toBe(7);
      await reload(page);
      await reload(pl.page);
      const { actorId } = await makeActor(page, { name: "QA Saved" });
      const own = await makeActor(page, { name: "QA Own Size", body: { cols: 3, rows: 2 } });
      for (const s of [gm, pl]) {
        expect(await s.page.evaluate(() => [game.settings.get("attache-case", "defaultBodyCols"), game.settings.get("attache-case", "defaultBodyRows")])).toEqual([7, 4]);
        await expect(bodyPanel(await openCase(s.page, actorId))).toHaveAttribute("style", /--cols: 7; --rows: 4/);
        await expect(bodyPanel(await openCase(s.page, own.actorId))).toHaveAttribute("style", /--cols: 3; --rows: 2/);
        await closeAll(s.page);
      }
      await forgetSaved(page);
      await reload(page);
      await reload(pl.page);
      await resetWorld(page);
      await forgetSaved(page);
    });

    test("03 a Player has no reset button", async () => {
      // The module tab exists for a Player because of the client settings.
      const sc = await openSettings(pl.page);
      await expect(sc.locator('[name="attache-case.cellSize"]').first()).toBeVisible();
      await expect(sc.locator(RESET_BUTTON)).toHaveCount(0);
    });

    test("04 reset: nothing to do, then count, Cancel, Confirm", async () => {
      const page = gm.page;
      await clearNotifications(page);
      let sc = await openSettings(page);
      await sc.locator(RESET_BUTTON).click();
      await expect(page.locator("#notifications .notification", { hasText: "No actor has a custom" })).toBeVisible();
      await expect(page.locator(".application.attache-dialog")).toHaveCount(0);
      await closeAll(page);

      const inherited = await makeActor(page, { name: "QA Base With Size", body: { cols: 2, rows: 2 } });
      const second = await makeActor(page, { name: "QA Second With Size", body: { cols: 9, rows: 1 } });
      const plain = await makeActor(page, { name: "QA Plain" });
      const tokens = await page.evaluate(async ({ flag, a, b }) => {
        const scene = await Scene.create({ name: "QA Reset", flags: { [flag.scope]: { [flag.key]: true } } });
        const mk = (actorId, actorLink, name) => ({ name, actorId, actorLink, x: 0, y: 0 });
        const created = await scene.createEmbeddedDocuments("Token", [
          mk(a, false, "inherits"), mk(b, false, "override"), mk(a, true, "linked")
        ]);
        const byName = (n) => created.find((t) => t.name === n);
        await byName("override").actor.update({ "flags.attache-case.body": { cols: 3, rows: 7 } });
        return { scene: scene.id, inherits: byName("inherits").id, override: byName("override").id };
      }, { flag: QA_FLAG, a: inherited.actorId, b: plain.actorId });
      const tokenBody = (name) => page.evaluate(({ s, t }) => {
        const token = game.scenes.get(s).tokens.get(t);
        return { own: token.delta?.flags?.["attache-case"]?.body ?? null, read: token.actor.getFlag("attache-case", "body") ?? null };
      }, { s: tokens.scene, t: tokens[name] });
      expect(await tokenBody("inherits")).toEqual({ own: null, read: { cols: 2, rows: 2 } });
      expect(await tokenBody("override")).toEqual({ own: { cols: 3, rows: 7 }, read: { cols: 3, rows: 7 } });

      // The Player keeps a window open: it must follow the reset with no action of theirs.
      const plRoot = await openCase(pl.page, second.actorId);
      await expect(bodyPanel(plRoot)).toHaveAttribute("style", /--cols: 9; --rows: 1/);

      sc = await openSettings(page);
      for (const scheme of ["light", "dark"]) {
        await setScheme(page, scheme);
        await page.mouse.move(5, 990);
        await page.waitForTimeout(300);
        fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${worldId}-reset-menu-${scheme}.png`) });
      }
      await sc.locator(RESET_BUTTON).click();
      const dialog = page.locator(".application.attache-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog, "two world actors plus one token with its own size").toContainText("3");
      for (const scheme of ["light", "dark"]) {
        await setScheme(page, scheme);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${worldId}-reset-confirm-${scheme}.png`) });
      }

      // Cancel writes nothing.
      await dialog.locator('button[data-action="no"]').click();
      await expect(dialog).toHaveCount(0);
      await page.waitForTimeout(300);
      expect(await stored(page, inherited.actorId)).toEqual({ cols: 2, rows: 2 });
      expect(await stored(page, second.actorId)).toEqual({ cols: 9, rows: 1 });
      expect(await tokenBody("override")).toEqual({ own: { cols: 3, rows: 7 }, read: { cols: 3, rows: 7 } });

      // Confirm clears everything in one action.
      await clearNotifications(page);
      await sc.locator(RESET_BUTTON).click();
      await expect(dialog).toBeVisible();
      await dialog.locator('button[data-action="yes"]').click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => stored(page, inherited.actorId)).toBeNull();
      await expect.poll(() => stored(page, second.actorId)).toBeNull();
      await expect.poll(() => tokenBody("override")).toEqual({ own: null, read: null });
      await expect.poll(() => tokenBody("inherits")).toEqual({ own: null, read: null });
      await expect(page.locator("#notifications .notification", { hasText: "cleared" }).first()).toContainText("3");
      expect(await stored(page, plain.actorId)).toBeNull();

      // Everybody now reads the world default, including an open window on the Player's client.
      await expect(bodyPanel(plRoot)).toHaveAttribute("style", wantStyle);
      await expect.poll(async () => (await layout(pl.page, second.actorId)).containers[0]).toMatchObject(want);
      const tokenDims = await page.evaluate(({ s, t }) => {
        const c = game.modules.get("attache-case").api.getLayout(game.scenes.get(s).tokens.get(t).actor).containers[0];
        return { cols: c.cols, rows: c.rows };
      }, { s: tokens.scene, t: tokens.override });
      expect(tokenDims).toEqual(want);

      // And now there is nothing left to do.
      await closeAll(page);
      await clearNotifications(page);
      sc = await openSettings(page);
      await sc.locator(RESET_BUTTON).click();
      await expect(page.locator("#notifications .notification", { hasText: "No actor has a custom" })).toBeVisible();
    });

    test("99 console: no errors or warnings from attache-case", async () => {
      expect(moduleErrors(gm.errors), "GM").toEqual([]);
      expect(moduleErrors(pl.errors), "Player").toEqual([]);
    });
  });
}
