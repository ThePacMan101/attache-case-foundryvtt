/**
 * Alternative item images, on CoC7, Delta Green and clean dnd5e, with a GM and a Player client at the
 * same time. Real mouse and keyboard; `page.evaluate` only for fixtures and assertions. Images are core
 * `icons/...` files plus one path that does not exist.
 * Screenshots: dev/artifacts/<world>-art-*.png, light and dark.
 * Run: dev/e2e/run.sh art.spec.mjs [-g "<world>.*<test>"]
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { WORLDS, DND5E_WORLDS, ARTIFACTS_DIR, moduleErrors } from "./helpers.mjs";
import {
  session, resetWorld, makeActor, caseSel, openCase, closeAll, tilePoint, cellPoint, chipPoint,
  pointerDrag, itemFlags, waitForFlags, clearNotifications, clickMenu, setScheme
} from "./qa.mjs";

const ART_WORLDS = { ...WORLDS, "attache-dnd5e": DND5E_WORLDS["attache-dnd5e"] };

const ICON = "icons/svg/coins.svg"; // what fixture() gives every item (Delta Green replaces core's default icon on create)
const DEFAULT_ICON = "icons/svg/item-bag.svg";
const CHOSEN = "icons/weapons/swords/greatsword-blue.webp";
const OTHER = "icons/svg/sword.svg";
const WIDE = "icons/fvtt.png"; // 100x50
const MISSING = "icons/no-such-folder/missing-art.webp";

const MENU = "Change Image";
const artDialog = (page) => page.locator(".application.attache-art-config");
const artInput = (page) => artDialog(page).locator('file-picker[name="art"] input');
const artPreview = (page) => artDialog(page).locator(".attache-art-preview img");
const tile = (root, id) => root.locator(`.attache-tile[data-item-id="${id}"]`);
const tileArt = (root, id) => tile(root, id).locator("img.attache-tile-art");
const chipArt = (root, id) => root.locator(`.attache-chip[data-item-id="${id}"] img.attache-chip-img`);
/** The image really decoded (a broken one has naturalWidth 0). */
const loaded = (img) => img.evaluate((el) => el.complete && el.naturalWidth > 0);

/** makeActor, with every item on a known image of its own. */
const fixture = (page, spec) => makeActor(page, { ...spec, items: spec.items?.map((it) => ({ img: ICON, ...it })) });

async function typePath(page, value) {
  const input = artInput(page);
  await input.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  if (value) await page.keyboard.type(value);
}

async function openFromTile(page, root, id) {
  await tile(root, id).click({ button: "right" });
  await clickMenu(page, MENU);
  await expect(artDialog(page)).toBeVisible();
}

async function save(page) {
  await artDialog(page).locator('button[type="submit"]').click();
}

async function shot(page, name) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.evaluate(() => ui.notifications.clear());
  await page.mouse.move(5, 990);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`) });
}

async function setFlag(page, actorId, itemId, art) {
  await page.evaluate(({ actorId, itemId, art }) => game.actors.get(actorId).items.get(itemId).update({ "flags.attache-case.art": art }), { actorId, itemId, art });
}

for (const [worldId, meta] of Object.entries(ART_WORLDS)) {
  test.describe.serial(`${worldId} art`, () => {
    let gm;
    let pl;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(400_000);
      gm = await session(browser, worldId, "Gamemaster", { canvas: false });
      await resetWorld(gm.page);
      pl = await session(browser, worldId, "Player", { canvas: false });
    });

    test.afterEach(async () => {
      for (const s of [gm, pl]) if (s) await closeAll(s.page).catch(() => {});
    });

    test.afterAll(async () => {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
      fs.writeFileSync(path.join(ARTIFACTS_DIR, `${worldId}-art-console.json`),
        JSON.stringify({ gm: gm?.errors ?? [], player: pl?.errors ?? [] }, null, 2));
      await gm?.ctx.close();
      await pl?.ctx.close();
    });

    test("01 no art: the tile and the chip show the item's own image", async () => {
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Default", body: { cols: 6, rows: 3 },
        items: [
          { key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, img: CHOSEN, pos: { c: "body", x: 0, y: 0 } },
          { key: "b", name: "Trinket", w: 1, h: 1, img: OTHER }
        ]
      });
      for (const s of [gm, pl]) {
        const root = await openCase(s.page, actorId);
        await expect(tileArt(root, ids.a)).toHaveAttribute("src", CHOSEN);
        await expect(chipArt(root, ids.b)).toHaveAttribute("src", OTHER);
        expect(await loaded(tileArt(root, ids.a))).toBe(true);
      }
      expect((await itemFlags(gm.page, actorId, ids.a)).art).toBeUndefined();
      for (const scheme of ["light", "dark"]) {
        await setScheme(pl.page, scheme);
        await shot(pl.page, `${worldId}-art-default-${scheme}`);
      }
    });

    test("02 owner Player without browse permission sets and resets through the text field", async () => {
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Player",
        items: [
          { key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, pos: { c: "body", x: 0, y: 0 } },
          { key: "b", name: "Trinket", w: 1, h: 1 }
        ]
      });
      const page = pl.page;
      expect(await page.evaluate(() => game.user.can("FILES_BROWSE"))).toBe(false);
      const root = await openCase(page, actorId);
      const gmRoot = await openCase(gm.page, actorId);

      await openFromTile(page, root, ids.a);
      await expect(artDialog(page).locator("file-picker button")).toHaveCount(0);
      await expect(artPreview(page)).toHaveAttribute("src", ICON);
      await typePath(page, CHOSEN);
      await expect(artPreview(page), "the preview follows the field").toHaveAttribute("src", CHOSEN);
      for (const scheme of ["light", "dark"]) {
        await setScheme(page, scheme);
        await shot(page, `${worldId}-art-dialog-player-${scheme}`);
      }
      await save(page);
      await expect(artDialog(page)).toHaveCount(0);

      await waitForFlags(page, actorId, ids.a, (f) => f.art === CHOSEN);
      await expect(tileArt(root, ids.a)).toHaveAttribute("src", CHOSEN);
      await expect(tileArt(gmRoot, ids.a), "the GM sees it without reloading").toHaveAttribute("src", CHOSEN);
      expect(await page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).img, { a: actorId, i: ids.a }), "item.img untouched").toBe(ICON);

      // An unstowed chip goes through the same route.
      await root.locator(`.attache-chip[data-item-id="${ids.b}"]`).click({ button: "right" });
      await clickMenu(page, MENU);
      await typePath(page, OTHER);
      await save(page);
      await expect(chipArt(root, ids.b)).toHaveAttribute("src", OTHER);

      // Reset fills nothing in by itself: it empties the field, the preview shows the item's image, Save writes.
      await openFromTile(page, root, ids.a);
      await expect(artInput(page)).toHaveValue(CHOSEN);
      await artDialog(page).locator("[data-action=resetArt]").click();
      await expect(artInput(page)).toHaveValue("");
      await expect(artPreview(page)).toHaveAttribute("src", ICON);
      expect((await itemFlags(page, actorId, ids.a)).art, "nothing written before Save").toBe(CHOSEN);
      await save(page);
      await waitForFlags(page, actorId, ids.a, (f) => f.art === undefined);
      await expect(tileArt(root, ids.a)).toHaveAttribute("src", ICON);
      await expect(tileArt(gmRoot, ids.a)).toHaveAttribute("src", ICON);
    });

    test("03 a non-owner gets no entry, on the tile or the item sheet", async () => {
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Observed", owner: null, defaultLevel: 2,
        items: [{ key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, img: ICON, pos: { c: "body", x: 0, y: 0 } }]
      });
      const page = pl.page;
      const root = await openCase(page, actorId);
      await tile(root, ids.a).click({ button: "right" });
      await expect(page.locator("#context-menu .context-item").first()).toBeVisible();
      await expect(page.locator("#context-menu .context-item", { hasText: MENU })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.mouse.click(5, 500);
      await tile(root, ids.a).dblclick();
      const sheetId = await page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).sheet.id, { a: actorId, i: ids.a });
      await expect(page.locator(`[id="${sheetId}"]`)).toBeVisible();
      await page.locator(`[id="${sheetId}"] [data-action=toggleControls]`).first().click();
      await page.waitForTimeout(300);
      await expect(page.locator("#context-menu .context-item", { hasText: MENU })).toHaveCount(0);
      await page.mouse.click(5, 500);
      // Reached anyway, nothing opens and nothing is written.
      const opened = await page.evaluate(async ({ a, i }) => {
        const { ItemArtConfig } = await import("/modules/attache-case/scripts/apps/item-art-config.mjs");
        return ItemArtConfig.open(game.actors.get(a).items.get(i)) !== null;
      }, { a: actorId, i: ids.a });
      expect(opened).toBe(false);
      await expect(artDialog(page)).toHaveCount(0);
      expect((await itemFlags(gm.page, actorId, ids.a)).art).toBeUndefined();
    });

    test("04 the item sheet menu opens the same dialog, for an owner Player and the GM", async () => {
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Sheet",
        items: [{ key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, pos: { c: "body", x: 0, y: 0 } }]
      });
      for (const s of [pl, gm]) {
        const page = s.page;
        const root = await openCase(page, actorId);
        await tile(root, ids.a).dblclick();
        const sheetId = await page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).sheet.id, { a: actorId, i: ids.a });
        await expect(page.locator(`[id="${sheetId}"]`)).toBeVisible();
        await page.locator(`[id="${sheetId}"] [data-action=toggleControls]`).first().click();
        await clickMenu(page, MENU);
        await expect(artDialog(page)).toBeVisible();
        await closeAll(page);
      }
    });

    test("05 GM: real file picker", async () => {
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Picker",
        items: [{ key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, pos: { c: "body", x: 0, y: 0 } }]
      });
      const page = gm.page;
      const root = await openCase(page, actorId);
      await openFromTile(page, root, ids.a);
      await typePath(page, OTHER); // the picker opens where the field points
      await artDialog(page).locator("file-picker button").click();
      const picker = page.locator(".application:has([data-files])");
      await expect(picker).toBeVisible();
      const file = picker.locator('li.file[data-path$="icons/svg/shield.svg"]');
      await file.scrollIntoViewIfNeeded();
      await file.click();
      await picker.locator('button[type="submit"]').click();
      await expect(artInput(page)).toHaveValue("icons/svg/shield.svg");
      await expect(artPreview(page)).toHaveAttribute("src", "icons/svg/shield.svg");
      for (const scheme of ["light", "dark"]) {
        await setScheme(page, scheme);
        await shot(page, `${worldId}-art-dialog-gm-${scheme}`);
      }
      await save(page);
      await waitForFlags(page, actorId, ids.a, (f) => f.art === "icons/svg/shield.svg");
      await expect(tileArt(root, ids.a)).toHaveAttribute("src", "icons/svg/shield.svg");
      await expect.poll(() => loaded(tileArt(root, ids.a))).toBe(true);
    });

    test("06 a wide image rotates with the tile, and the ghost carries it", async () => {
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Wide", body: { cols: 6, rows: 4 },
        items: [{ key: "a", name: "Long Thing", kind: "weapon", w: 4, h: 2, pos: { c: "body", x: 0, y: 0 } }]
      });
      await setFlag(gm.page, actorId, ids.a, WIDE);
      const page = pl.page;
      const root = await openCase(page, actorId);
      const art = tileArt(root, ids.a);
      await expect(art).toHaveAttribute("src", WIDE);
      await expect.poll(() => loaded(art)).toBe(true);
      const size = await art.evaluate((el) => [el.naturalWidth, el.naturalHeight]);
      expect(size[0], "the chosen image really is wide").toBeGreaterThan(size[1]);

      const flat = await art.boundingBox();
      for (const scheme of ["light", "dark"]) {
        await setScheme(page, scheme);
        await shot(page, `${worldId}-art-wide-flat-${scheme}`);
      }

      const p = await tilePoint(page, actorId, ids.a);
      await page.mouse.move(p.x, p.y);
      await page.keyboard.press("KeyR");
      await waitForFlags(page, actorId, ids.a, (f) => f.pos?.r === true);
      await expect(tile(root, ids.a)).toHaveClass(/is-rotated/);
      await page.waitForTimeout(400);
      const matrix = await art.evaluate((el) => getComputedStyle(el).transform);
      const [a, b] = matrix.match(/matrix\(([^)]+)\)/)[1].split(",").map(Number);
      expect(Math.round(a), matrix).toBe(0);
      expect(Math.round(b), matrix).toBe(1);
      const turned = await art.boundingBox();
      expect(Math.round(turned.width), "turned 90 degrees on screen").toBe(Math.round(flat.height));
      expect(Math.round(turned.height)).toBe(Math.round(flat.width));
      expect(await art.getAttribute("src")).toBe(WIDE);
      for (const scheme of ["light", "dark"]) {
        await setScheme(page, scheme);
        await shot(page, `${worldId}-art-wide-rotated-${scheme}`);
      }

      // Ghost: art, rotated with the drag; Escape cancels and leaves nothing behind.
      const from = await tilePoint(page, actorId, ids.a);
      const to = await cellPoint(page, actorId, "body", 4, 1);
      await pointerDrag(page, from, to, { release: false });
      const ghost = page.locator(".attache-ghost");
      await expect(ghost.locator("img")).toHaveAttribute("src", WIDE);
      await expect(ghost).toHaveClass(/is-rotated/);
      await page.keyboard.press("KeyR");
      await expect(ghost).not.toHaveClass(/is-rotated/);
      await shot(page, `${worldId}-art-ghost-dark`);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(ghost).toHaveCount(0);
      expect((await itemFlags(page, actorId, ids.a)).pos).toMatchObject({ x: 0, y: 0, r: true });
    });

    test("07 a missing file falls back everywhere, without a console error from us", async () => {
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Missing", body: { cols: 6, rows: 3 },
        containers: [{ key: "bag", name: "Satchel", cols: 3, rows: 3 }],
        items: [
          { key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, pos: { c: "body", x: 0, y: 0 } },
          { key: "b", name: "Trinket", w: 1, h: 1 }
        ]
      });
      for (const id of [ids.a, ids.b, ids.bag]) await setFlag(gm.page, actorId, id, MISSING);
      const page = gm.page;
      const root = await openCase(page, actorId);
      await expect.poll(() => tileArt(root, ids.a).getAttribute("src")).toBe(ICON);
      await expect.poll(() => loaded(tileArt(root, ids.a))).toBe(true);
      await expect.poll(() => chipArt(root, ids.b).getAttribute("src")).toBe(ICON);
      const panelIcon = root.locator(`.attache-panel-header[data-container-id="${ids.bag}"] img.attache-panel-icon`);
      await expect.poll(() => panelIcon.getAttribute("src")).toBe("icons/svg/chest.svg");
      expect((await itemFlags(page, actorId, ids.a)).art, "the flag is not rewritten").toBe(MISSING);

      // Ghost.
      const from = await tilePoint(page, actorId, ids.a);
      await pointerDrag(page, from, await cellPoint(page, actorId, "body", 2, 2), { release: false });
      const ghostImg = page.locator(".attache-ghost img");
      await expect.poll(() => ghostImg.getAttribute("src")).toBe(ICON);
      await expect.poll(() => loaded(ghostImg)).toBe(true);
      await page.keyboard.press("Escape");
      await page.mouse.up();

      // Size dialog preview, GM.
      await tile(root, ids.a).click({ button: "right" });
      await clickMenu(page, "Inventory Size");
      const preview = page.locator(".application.attache-size-config .attache-preview-grid img");
      await expect.poll(() => preview.getAttribute("src")).toBe(ICON);
      await closeAll(page);

      // Art dialog preview: the same chain, and the path stays in the field so it can be fixed.
      const again = await openCase(page, actorId);
      await openFromTile(page, again, ids.a);
      await expect(artInput(page)).toHaveValue(MISSING);
      await expect.poll(() => artPreview(page).getAttribute("src")).toBe(ICON);
      await closeAll(page);

      // The item's own image missing too: the default icon, end of the chain.
      await page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ img: "icons/no-such-folder/also-missing.webp" }), { a: actorId, i: ids.a });
      const last = await openCase(page, actorId);
      await expect.poll(() => tileArt(last, ids.a).getAttribute("src")).toBe(DEFAULT_ICON);
      await expect.poll(() => loaded(tileArt(last, ids.a))).toBe(true);
    });

    test("08 bag panel icon and size dialog preview use the art", async () => {
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Bag", body: { cols: 6, rows: 3 },
        containers: [{ key: "bag", name: "Satchel", cols: 3, rows: 3 }],
        items: [{ key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, pos: { c: "body", x: 0, y: 0 } }]
      });
      const page = gm.page;
      const root = await openCase(page, actorId);
      const panelIcon = root.locator(`.attache-panel-header[data-container-id="${ids.bag}"] img.attache-panel-icon`);
      await expect(panelIcon).toHaveAttribute("src", "icons/svg/chest.svg");

      // A bag has no tile: its art is chosen from its item sheet.
      await root.locator(`.attache-panel-header[data-container-id="${ids.bag}"]`).click({ button: "right" });
      await clickMenu(page, "Open Sheet");
      const sheetId = await page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).sheet.id, { a: actorId, i: ids.bag });
      await page.locator(`[id="${sheetId}"] [data-action=toggleControls]`).first().click();
      await clickMenu(page, MENU);
      await typePath(page, CHOSEN);
      await save(page);
      await expect(panelIcon).toHaveAttribute("src", CHOSEN);

      await setFlag(page, actorId, ids.a, OTHER);
      await expect(tileArt(root, ids.a)).toHaveAttribute("src", OTHER);
      await tile(root, ids.a).click({ button: "right" });
      await clickMenu(page, "Inventory Size");
      const preview = page.locator(".application.attache-size-config .attache-preview-grid img");
      await expect(preview).toHaveAttribute("src", OTHER);
      for (const scheme of ["light", "dark"]) {
        await setScheme(page, scheme);
        await shot(page, `${worldId}-art-bag-size-${scheme}`);
      }
    });

    test("09 give keeps it: owned, and relayed through the GM", async () => {
      await gm.page.evaluate(async () => {
        if (!game.users.getName("Player2")) await User.create({ name: "Player2", role: CONST.USER_ROLES.PLAYER });
      });
      const src = await fixture(gm.page, {
        name: "QA Art Source",
        items: [
          { key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, pos: { c: "body", x: 0, y: 0 } },
          { key: "b", name: "Trinket", w: 1, h: 1, pos: { c: "body", x: 0, y: 1 } }
        ]
      });
      const mine = await fixture(gm.page, { name: "QA Art Mine" });
      const theirs = await fixture(gm.page, { name: "QA Art Theirs", owner: "Player2" });
      await setFlag(gm.page, src.actorId, src.ids.a, CHOSEN);
      await setFlag(gm.page, src.actorId, src.ids.b, OTHER);
      const page = pl.page;
      await openCase(page, src.actorId);
      const give = async (id, targetName) => {
        const root = page.locator(caseSel(src.actorId));
        await tile(root, id).click({ button: "right" });
        await clickMenu(page, "Give");
        const dlg = page.locator(".application.attache-give");
        await dlg.locator(".attache-give-option", { hasText: targetName }).click();
        await dlg.locator("button[data-action=give]").click();
      };
      const artOf = (p, actorId, name) => p.evaluate(({ actorId, name }) => {
        const i = game.actors.get(actorId).items.find((x) => x.name === name);
        return i ? { art: i.flags["attache-case"]?.art ?? null, id: i.id } : null;
      }, { actorId, name });

      await give(src.ids.a, "QA Art Mine");
      await expect.poll(() => artOf(page, mine.actorId, "Blade")).toMatchObject({ art: CHOSEN });
      expect(await artOf(page, src.actorId, "Blade")).toBeNull();
      const { id: givenId } = await artOf(page, mine.actorId, "Blade");
      const mineRoot = await openCase(page, mine.actorId);
      await expect(tileArt(mineRoot, givenId)).toHaveAttribute("src", CHOSEN);
      await closeAll(page); // that window covers the source's
      await openCase(page, src.actorId);

      await give(src.ids.b, "QA Art Theirs");
      await expect.poll(() => artOf(gm.page, theirs.actorId, "Trinket")).toMatchObject({ art: OTHER });
      expect(await artOf(gm.page, src.actorId, "Trinket")).toBeNull();
    });

    test("10 bad input is refused and cannot inject HTML", async () => {
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Bad",
        items: [{ key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, pos: { c: "body", x: 0, y: 0 } }]
      });
      const page = pl.page;
      const root = await openCase(page, actorId);
      await clearNotifications(page);
      await openFromTile(page, root, ids.a);
      const INJECT = '"><img src=x onerror="window.__attachePwned=1">';
      for (const bad of ["javascript:alert(1)", INJECT]) {
        await typePath(page, bad);
        await expect(artPreview(page), "the preview ignores it").toHaveAttribute("src", ICON);
        await save(page);
        await expect(page.locator("#notifications .notification", { hasText: "not a valid image" }).first()).toBeVisible();
        await expect(artDialog(page), "stays open to correct the path").toBeVisible();
        expect((await itemFlags(gm.page, actorId, ids.a)).art).toBeUndefined();
      }
      // Empty on an item with no art: closes, writes nothing, stores no empty string.
      await typePath(page, "");
      await save(page);
      await expect(artDialog(page)).toHaveCount(0);
      expect("art" in (await itemFlags(gm.page, actorId, ids.a))).toBe(false);

      // A flag written behind our back never reaches the DOM as markup, for anyone.
      await setFlag(gm.page, actorId, ids.a, INJECT);
      const gmRoot = await openCase(gm.page, actorId);
      for (const [p, r] of [[page, root], [gm.page, gmRoot]]) {
        await expect(tileArt(r, ids.a)).toHaveAttribute("src", ICON);
        await p.waitForTimeout(300);
        expect(await p.evaluate(() => [window.__attachePwned ?? null, document.querySelectorAll('img[src="x"]').length])).toEqual([null, 0]);
      }
      await openFromTile(page, root, ids.a);
      await expect(artInput(page), "not offered back as a value").toHaveValue("");
      expect(await page.evaluate(() => [window.__attachePwned ?? null, document.querySelectorAll('img[src="x"]').length])).toEqual([null, 0]);
    });

    test("11 dnd5e: a Player does not see the art of an unidentified item", async () => {
      test.skip(meta.system !== "dnd5e", "the guard is a dnd5e profile member");
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Unidentified",
        items: [{ key: "a", name: "Blade", kind: "weapon", w: 3, h: 1, img: OTHER, pos: { c: "body", x: 0, y: 0 } }]
      });
      await gm.page.evaluate(({ a, i, art }) => game.actors.get(a).items.get(i).update({
        "flags.attache-case.art": art, "system.identified": false, "system.unidentified.name": "Strange Blade"
      }), { a: actorId, i: ids.a, art: CHOSEN });
      const root = await openCase(pl.page, actorId);
      const gmRoot = await openCase(gm.page, actorId);
      await expect(tileArt(root, ids.a), "Player: the item's own image").toHaveAttribute("src", OTHER);
      await expect(tileArt(gmRoot, ids.a), "GM: the chosen image").toHaveAttribute("src", CHOSEN);

      // Neither the entry nor the path is offered to the Player, and the ghost follows the same rule.
      await tile(root, ids.a).click({ button: "right" });
      await expect(pl.page.locator("#context-menu .context-item").first()).toBeVisible();
      await expect(pl.page.locator("#context-menu .context-item", { hasText: MENU })).toHaveCount(0);
      await pl.page.keyboard.press("Escape");
      await pl.page.mouse.click(5, 500);
      await pointerDrag(pl.page, await tilePoint(pl.page, actorId, ids.a), await cellPoint(pl.page, actorId, "body", 3, 2), { release: false });
      await expect(pl.page.locator(".attache-ghost img")).toHaveAttribute("src", OTHER);
      await pl.page.keyboard.press("Escape");
      await pl.page.mouse.up();
      await expect(pl.page.locator(".attache-ghost")).toHaveCount(0);

      // Identifying it reveals the art on the Player's open window, with no reload.
      await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ "system.identified": true }), { a: actorId, i: ids.a });
      await expect(tileArt(root, ids.a)).toHaveAttribute("src", CHOSEN);
      await expect(tileArt(gmRoot, ids.a)).toHaveAttribute("src", CHOSEN);
    });

    test("12 Worn chip shows the art (CoC7 and Delta Green)", async () => {
      test.skip(meta.system === "dnd5e", "Worn has no dnd5e armor types before M4");
      const { actorId, ids } = await fixture(gm.page, {
        name: "QA Art Worn",
        items: [{ key: "v", name: "Coat", kind: "armor", w: 2, h: 2, worn: true }]
      });
      await setFlag(gm.page, actorId, ids.v, CHOSEN);
      const root = await openCase(pl.page, actorId);
      await expect(chipArt(root, ids.v)).toHaveAttribute("src", CHOSEN);
      const p = await chipPoint(pl.page, actorId, ids.v);
      await pointerDrag(pl.page, p, await cellPoint(pl.page, actorId, "body", 0, 0), { release: false });
      await expect(pl.page.locator(".attache-ghost img")).toHaveAttribute("src", CHOSEN);
      await pl.page.keyboard.press("Escape");
      await pl.page.mouse.up();
    });

    test("99 console: no errors or warnings from attache-case", async () => {
      expect(moduleErrors(gm.errors), "GM").toEqual([]);
      expect(moduleErrors(pl.errors), "Player").toEqual([]);
    });
  });
}
