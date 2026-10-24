/**
 * Attaché Case regression suite (real Foundry v14, both systems). One serial block per world with a
 * GM and a Player client logged in at the same time. Fixture actors are created per scenario
 * (flag world.attacheQA) with explicit placements, so expected positions are exact.
 * Run: dev/e2e/run.sh scenarios.spec.mjs [-g "<world> .* <scenario>"]
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { WORLDS, SEED_FLAG, ARTIFACTS_DIR, moduleErrors, screenshot } from "./helpers.mjs";
import {
  session, resetWorld, makeActor, caseSel, openCase, closeAll, cellPoint, tilePoint, chipPoint, zonePoint,
  pointerDrag, itemFlags, waitForFlags, layout, clearNotifications, clickMenu, loginAs
} from "./qa.mjs";

const posIs = (c, x, y, r = false) => (f) => f?.pos?.c === c && f.pos.x === x && f.pos.y === y && Boolean(f.pos.r) === r;

for (const [worldId, meta] of Object.entries(WORLDS)) {
  test.describe.serial(`${worldId}`, () => {
    /** @type {{ctx, page, errors}} */
    let gm;
    /** @type {{ctx, page, errors}} */
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
      fs.writeFileSync(path.join(ARTIFACTS_DIR, `${worldId}-scenarios-console.json`),
        JSON.stringify({ gm: gm?.errors ?? [], player: pl?.errors ?? [] }, null, 2));
      await gm?.ctx.close();
      await pl?.ctx.close();
    });

    /* ------------------------------------------------------------------ */

    test("01 open: API, header control, directory, keybinding, observer", async () => {
      const page = gm.page;
      const { actorId } = await makeActor(page, {
        name: "QA Open", items: [{ key: "a", name: "Lantern", w: 2, h: 2, pos: { c: "body", x: 0, y: 0 } }]
      });
      // API, twice: one window per actor.
      await openCase(page, actorId);
      await openCase(page, actorId);
      await expect(page.locator(caseSel(actorId))).toHaveCount(1);
      await closeAll(page);

      // Header control in the sheet's kebab menu.
      const sheetId = await page.evaluate(async (id) => {
        const a = game.actors.get(id);
        await a.sheet.render({ force: true });
        return a.sheet.id;
      }, actorId);
      await page.locator(`[id="${sheetId}"] [data-action=toggleControls]`).first().click();
      await clickMenu(page, "Attaché Case");
      await expect(page.locator(caseSel(actorId))).toBeVisible();
      await closeAll(page);

      // Actor Directory context menu.
      await page.evaluate(() => ui.actors.activate());
      const li = page.locator(`#actors .directory-item[data-entry-id="${actorId}"]`);
      await li.click({ button: "right" });
      await clickMenu(page, "Attaché Case");
      await expect(page.locator(caseSel(actorId))).toBeVisible();
      await closeAll(page);

      // Keybinding I (Player: their assigned character), toggles.
      const seedId = await pl.page.evaluate(() => game.user.character?.id);
      expect(seedId).toBeTruthy();
      await pl.page.mouse.click(800, 600);
      await pl.page.keyboard.press("KeyI");
      await expect(pl.page.locator(caseSel(seedId))).toBeVisible();
      await pl.page.keyboard.press("KeyI");
      await expect(pl.page.locator(caseSel(seedId))).toHaveCount(0);

      // Observer: read-only window, no toolbar actions, drags do nothing.
      const obs = await makeActor(page, {
        name: "QA Observed", owner: null, defaultLevel: 2,
        items: [{ key: "a", name: "Lantern", w: 2, h: 2, pos: { c: "body", x: 0, y: 0 } }]
      });
      const root = await openCase(pl.page, obs.actorId);
      await expect(root).toHaveClass(/is-readonly/);
      await expect(root.locator("[data-action=autoArrange]")).toHaveCount(0);
      await pointerDrag(pl.page, await tilePoint(pl.page, obs.actorId, obs.ids.a), await cellPoint(pl.page, obs.actorId, "body", 3, 1));
      expect((await itemFlags(page, obs.actorId, obs.ids.a)).pos).toEqual({ c: "body", x: 0, y: 0, r: false });
      // None (no permission): the API refuses.
      const none = await makeActor(page, { name: "QA Hidden", owner: null, defaultLevel: 0 });
      await pl.page.evaluate((id) => game.modules.get("attache-case").api.open(game.actors.get(id)), none.actorId).catch(() => {});
      await expect(pl.page.locator(caseSel(none.actorId))).toHaveCount(0);
    });

    test("02 layout: compendium sizes, auto-placement, excluded hidden from players", async () => {
      const page = gm.page;
      const report = await page.evaluate(async (flag) => {
        const inv = await import("/modules/attache-case/scripts/foundry/inventory.mjs");
        const { DEFAULT_REGISTRY } = await import("/modules/attache-case/scripts/data/default-sizes.mjs");
        const a = game.actors.find((x) => x.getFlag(flag.scope, flag.key));
        const sys = game.system.id;
        return a.items.filter((i) => i._stats.compendiumSource).map((i) => {
          const info = inv.itemSize(i);
          const reg = DEFAULT_REGISTRY.byId[sys];
          const key = sys === "CoC7" ? i.flags.CoC7?.cocidFlag?.id : i._stats.compendiumSource;
          return { name: i.name, source: info.source, size: info.size, expected: reg[key] ?? null };
        });
      }, SEED_FLAG);
      console.log(`[02] ${worldId} seeded: ${JSON.stringify(report)}`);
      expect(report.length).toBeGreaterThan(2);
      for (const r of report) {
        expect(r.source, r.name).toBe("id");
        const e = typeof r.expected === "string" ? r.expected.split("x").map(Number) : Array.isArray(r.expected) ? r.expected : [r.expected.w, r.expected.h];
        expect([r.size.w, r.size.h], r.name).toEqual(e);
      }

      // Auto-placement of a compendium weapon created on an empty actor, and the unarmed attack excluded.
      const { actorId } = await makeActor(page, { name: "QA Layout" });
      const created = await page.evaluate(async (id) => {
        const actor = game.actors.get(id);
        const packs = game.packs.filter((p) => p.documentName === "Item" && p.metadata.packageType === "system");
        const find = async (test) => {
          for (const p of packs) {
            const e = (await p.getIndex({ fields: ["flags", "type"] })).find(test);
            if (e) return game.items.fromCompendium(await p.getDocument(e._id));
          }
          return null;
        };
        const knife = await find((e) => e.type === "weapon" && /^knife/i.test(e.name));
        // CoC7: "Punch" (i.weapon.brawl); Delta Green: "Unarmed Attack".
        const unarmed = await find((e) => e.flags?.CoC7?.cocidFlag?.id === "i.weapon.brawl" || /^unarmed/i.test(e.name));
        const docs = await actor.createEmbeddedDocuments("Item", [knife, unarmed].filter(Boolean));
        return docs.map((d) => ({ id: d.id, name: d.name, pos: d.flags["attache-case"]?.pos ?? null }));
      }, actorId);
      console.log(`[02] ${worldId} created: ${JSON.stringify(created)}`);
      expect(created).toHaveLength(2);
      const [knife, unarmed] = created;
      expect(knife.pos).toEqual({ c: "body", x: 0, y: 0, r: false });
      expect(unarmed.pos).toBeNull();
      const l = await layout(page, actorId);
      // Delta Green also adds its own "Unarmed Attack" to new agents: every excluded item is unarmed.
      expect(l.excluded).toContain(unarmed.id);
      const excludedNames = await page.evaluate(({ id, ex }) => ex.map((i) => game.actors.get(id).items.get(i).name), { id: actorId, ex: l.excluded });
      for (const n of excludedNames) expect(n).toMatch(/unarmed|punch/i);
      const gmRoot = await openCase(page, actorId);
      await expect(gmRoot.locator(`.attache-excluded [data-item-id="${unarmed.id}"]`)).toHaveCount(1);
      // Players with access never see it.
      await page.evaluate(async ({ id, user }) => game.actors.get(id).update({ [`ownership.${game.users.getName(user).id}`]: 3 }), { id: actorId, user: "Player" });
      const plRoot = await openCase(pl.page, actorId);
      await expect(plRoot.locator(`[data-item-id="${knife.id}"]`)).toHaveCount(1);
      await expect(plRoot.locator(`[data-item-id="${unarmed.id}"]`)).toHaveCount(0);
      await expect(plRoot.locator(".attache-excluded")).toHaveCount(0);
    });

    test("03 drag & drop: move, containers, unstowed, invalid, rotate (R, wheel, right click), escape, keys", async () => {
      const page = pl.page;
      const fx = await makeActor(gm.page, {
        name: "QA Drag", body: { cols: 6, rows: 4 },
        containers: [{ key: "bag", name: "Satchel", cols: 4, rows: 3 }],
        items: [
          { key: "a", name: "Flashlight", w: 2, h: 1, pos: { c: "body", x: 0, y: 0 } },
          { key: "b", name: "Coin", w: 1, h: 1, pos: { c: "body", x: 3, y: 0 } },
          { key: "c", name: "Revolver", kind: "weapon", w: 3, h: 2, pos: { c: "body", x: 0, y: 1 } },
          { key: "d", name: "Rope", w: 2, h: 2 }
        ]
      });
      const { actorId, ids } = fx;
      await openCase(page, actorId);
      const bag = ids.bag;

      // Move within the body grid.
      await pointerDrag(page, await tilePoint(page, actorId, ids.a), await cellPoint(page, actorId, "body", 4, 3));
      await waitForFlags(page, actorId, ids.a, posIs("body", 4, 3));
      // Into the satchel.
      await pointerDrag(page, await tilePoint(page, actorId, ids.a), await cellPoint(page, actorId, bag, 1, 1));
      await waitForFlags(page, actorId, ids.a, posIs(bag, 1, 1));
      // To Unstowed.
      await pointerDrag(page, await tilePoint(page, actorId, ids.a), await zonePoint(page, actorId, "overflow"));
      await waitForFlags(page, actorId, ids.a, (f) => f.pos === undefined);
      await expect(page.locator(`${caseSel(actorId)} .attache-overflow [data-item-id="${ids.a}"]`)).toBeVisible();
      // Back from Unstowed (a chip is held by the centre of its footprint: cell 0 for a 2x1).
      await pointerDrag(page, await chipPoint(page, actorId, ids.a), await cellPoint(page, actorId, "body", 0, 3));
      await waitForFlags(page, actorId, ids.a, posIs("body", 0, 3));
      // Invalid drop (onto the coin) snaps back, nothing written.
      await pointerDrag(page, await tilePoint(page, actorId, ids.a), await cellPoint(page, actorId, "body", 3, 0));
      await page.waitForTimeout(400);
      expect((await itemFlags(page, actorId, ids.a)).pos).toEqual({ c: "body", x: 0, y: 3, r: false });
      await expect(page.locator(".attache-ghost")).toHaveCount(0);

      // Rotate while dragging with R: a 3x2 held by its top-left cell is held by cell (1,0) once rotated.
      await pointerDrag(page, await tilePoint(page, actorId, ids.c), await cellPoint(page, actorId, "body", 5, 1),
        { mid: () => page.keyboard.press("KeyR") });
      await waitForFlags(page, actorId, ids.c, posIs("body", 4, 1, true));
      // Wheel rotates back (counter-clockwise: held cell (0,0) of the 2x3 becomes (0,1)).
      await pointerDrag(page, await tilePoint(page, actorId, ids.c), await cellPoint(page, actorId, "body", 1, 2),
        { mid: () => page.mouse.wheel(0, 120) });
      await waitForFlags(page, actorId, ids.c, posIs("body", 1, 1, false));
      // Right click rotates.
      await pointerDrag(page, await tilePoint(page, actorId, ids.c), await cellPoint(page, actorId, "body", 5, 1), {
        mid: async () => {
          await page.mouse.down({ button: "right" });
          await page.mouse.up({ button: "right" });
        }
      });
      await waitForFlags(page, actorId, ids.c, posIs("body", 4, 1, true));
      await expect(page.locator("#context-menu")).toHaveCount(0);
      // Escape cancels.
      await pointerDrag(page, await tilePoint(page, actorId, ids.c), await cellPoint(page, actorId, "body", 2, 0),
        { mid: () => page.keyboard.press("Escape") });
      await page.waitForTimeout(500);
      expect((await itemFlags(page, actorId, ids.c)).pos).toEqual({ c: "body", x: 4, y: 1, r: true });
      await expect(page.locator(".attache-ghost")).toHaveCount(0);
      await expect(page.locator(caseSel(actorId))).toBeVisible();

      // R while hovering rotates in place.
      await page.mouse.move(...Object.values(await tilePoint(page, actorId, ids.c)));
      await page.keyboard.press("KeyR");
      const rotated = await waitForFlags(page, actorId, ids.c, (f) => f.pos?.r === false);
      expect(rotated.pos.x + 3).toBeLessThanOrEqual(6);
      // Arrow keys move the focused tile.
      await page.locator(`${caseSel(actorId)} .attache-tile[data-item-id="${ids.b}"]`).focus();
      await page.keyboard.press("ArrowLeft");
      await waitForFlags(page, actorId, ids.b, posIs("body", 2, 0));
      // Enter opens the item sheet.
      await page.keyboard.press("Enter");
      await expect(page.locator(".application.sheet").filter({ hasText: "Coin" }).first()).toBeVisible();
    });

    test("04 worn: armor to the Worn strip and back, non-armor rejected", async () => {
      const page = pl.page;
      const { actorId, ids } = await makeActor(gm.page, {
        name: "QA Worn", body: { cols: 6, rows: 4 },
        items: [
          { key: "vest", name: "Vest", kind: "armor", w: 3, h: 3, pos: { c: "body", x: 0, y: 0 } },
          { key: "coin", name: "Coin", w: 1, h: 1, pos: { c: "body", x: 5, y: 3 } }
        ]
      });
      await openCase(page, actorId);
      await pointerDrag(page, await tilePoint(page, actorId, ids.vest, 1, 1), await zonePoint(page, actorId, "worn"));
      await waitForFlags(page, actorId, ids.vest, (f) => f.worn === true && f.pos === undefined);
      // A 3x3 chip is held by its centre cell (1,1).
      await pointerDrag(page, await chipPoint(page, actorId, ids.vest), await cellPoint(page, actorId, "body", 2, 2));
      await waitForFlags(page, actorId, ids.vest, (f) => f.worn === undefined && posIs("body", 1, 1)(f));
      // Non-armor cannot be worn.
      await pointerDrag(page, await tilePoint(page, actorId, ids.coin), await zonePoint(page, actorId, "worn"));
      await page.waitForTimeout(400);
      expect(await itemFlags(page, actorId, ids.coin)).toEqual({ size: { w: 1, h: 1 }, pos: { c: "body", x: 5, y: 3, r: false } });
      // Context menu Wear / Take Off.
      await page.locator(`${caseSel(actorId)} .attache-tile[data-item-id="${ids.vest}"]`).click({ button: "right" });
      await clickMenu(page, "Wear");
      await waitForFlags(page, actorId, ids.vest, (f) => f.worn === true);
      await page.locator(`${caseSel(actorId)} .attache-worn [data-item-id="${ids.vest}"]`).click({ button: "right" });
      await clickMenu(page, "Take Off");
      await waitForFlags(page, actorId, ids.vest, (f) => f.worn === undefined && f.pos?.c === "body");
      await screenshot(page, `${worldId}-qa-worn`);
    });

    test("05 containers: presets, compendium, resize keeps arrangement, remove repacks", async () => {
      const page = gm.page;
      const types = { CoC7: "item", deltagreen: "gear" };
      const { actorId, ids } = await makeActor(page, {
        name: "QA Containers", body: { cols: 6, rows: 4 },
        items: [
          { key: "p", name: "Pistol", kind: "weapon", w: 3, h: 2, pos: { c: "body", x: 0, y: 0 } },
          { key: "q", name: "Book", w: 2, h: 2 },
          { key: "m", name: "Map", w: 2, h: 1 }
        ]
      });
      const root = await openCase(page, actorId);
      // Preset icons all exist on the server.
      const missing = await page.evaluate(async () => {
        const out = [];
        for (const p of game.modules.get("attache-case").api.presets) if (!(await fetch(p.img, { method: "HEAD" })).ok) out.push(p.img);
        return out;
      });
      expect(missing, "preset icons served by core").toEqual([]);

      // Configure -> add the Backpack preset; the unstowed items are packed into it.
      await root.locator("[data-action=configure]").click();
      const cfg = page.locator(`[id="attache-config-Actor-${actorId}"]`);
      await expect(cfg).toBeVisible();
      // An unsaved body edit survives the re-render caused by adding a container.
      await cfg.locator("input[name='body.cols']").fill("7");
      await cfg.locator("select[name=preset]").selectOption("backpack");
      await cfg.locator("[data-action=addContainer]").click();
      await expect(cfg.locator(".attache-config-container")).toHaveCount(1);
      await expect(cfg.locator("input[name='body.cols']")).toHaveValue("7");
      const pack = await page.evaluate((id) => {
        const box = game.actors.get(id).items.find((i) => i.flags["attache-case"]?.container);
        return { id: box.id, name: box.name, type: box.type, img: box.img, container: box.flags["attache-case"].container };
      }, actorId);
      expect(pack.type).toBe(types[meta.system]);
      expect(pack.container).toEqual({ cols: 8, rows: 6 });
      expect(pack.name).toBe("Backpack");
      await expect(root.locator(`.attache-grid[data-container-id="${pack.id}"]`)).toBeVisible();
      await expect.poll(async () => (await layout(page, actorId)).overflow).toEqual([]);
      // The window grew so the new 8x6 grid is fully visible without scrolling.
      await expect.poll(async () => {
        const win = await root.locator(".attache-main").boundingBox();
        const g = await root.locator(`.attache-grid[data-container-id="${pack.id}"]`).boundingBox();
        return g.x + g.width <= win.x + win.width && g.y + g.height <= win.y + win.height;
      }).toBe(true);
      await page.locator(`[id="attache-config-Actor-${actorId}"] .header-control[data-action=close]`).click();

      // The module compendium opens (LevelDB) and its containers can be dropped onto the case.
      const packId = `attache-case.containers-${meta.system === "CoC7" ? "coc7" : "deltagreen"}`;
      const packInfo = await page.evaluate(async (packId) => {
        const p = game.packs.get(packId);
        const docs = await p.getDocuments();
        await p.render({ force: true });
        return { label: p.metadata.label, count: docs.length, first: docs.find((d) => d.name === "Belt Pouch")?.id };
      }, packId);
      expect(packInfo.count).toBe(12);
      const entry = page.locator(`.application.compendium-directory .directory-item[data-entry-id="${packInfo.first}"]`);
      await expect(entry).toBeVisible();
      await entry.dragTo(root.locator('.attache-grid[data-container-id="body"]'), { targetPosition: { x: 200, y: 100 } });
      await expect.poll(() => page.evaluate((id) => game.actors.get(id).items.filter((i) => i.flags["attache-case"]?.container).length, actorId)).toBe(2);
      const pouchId = await page.evaluate((id) => game.actors.get(id).items.find((i) => i.name === "Belt Pouch")?.id, actorId);
      await expect(root.locator(`.attache-grid[data-container-id="${pouchId}"]`)).toBeVisible();
      await page.evaluate((packId) => game.packs.get(packId).apps?.forEach?.((a) => a.close()), packId).catch(() => {});

      // Put the map in the pouch at (1,1), then shrink the pouch: the map is unstowed but keeps its pos.
      await page.evaluate(({ id, mapId, pouchId }) => game.actors.get(id).items.get(mapId).setFlag("attache-case", "pos", { c: pouchId, x: 1, y: 1, r: false }), { id: actorId, mapId: ids.m, pouchId });
      await expect(root.locator(`.attache-grid[data-container-id="${pouchId}"] [data-item-id="${ids.m}"]`)).toBeVisible();
      await root.locator(`.attache-panel-menu[data-container-id="${pouchId}"]`).click();
      await clickMenu(page, "Resize");
      const dlg = page.locator(".application.dialog").filter({ has: page.locator("input[name=cols]") }).last();
      await dlg.locator("input[name=cols]").fill("2");
      await dlg.locator("input[name=rows]").fill("1");
      await dlg.locator("button[data-action=ok]").click();
      await expect.poll(async () => (await layout(page, actorId)).overflow).toContain(ids.m);
      expect((await itemFlags(page, actorId, ids.m)).pos).toEqual({ c: pouchId, x: 1, y: 1, r: false });
      // Growing it back restores the map.
      await root.locator(`.attache-panel-menu[data-container-id="${pouchId}"]`).click();
      await clickMenu(page, "Resize");
      const dlg2 = page.locator(".application.dialog").filter({ has: page.locator("input[name=cols]") }).last();
      await dlg2.locator("input[name=cols]").fill("3");
      await dlg2.locator("input[name=rows]").fill("2");
      await dlg2.locator("button[data-action=ok]").click();
      await expect.poll(async () => (await layout(page, actorId)).placed[ids.m]?.c).toBe(pouchId);

      // Remove the pouch: its contents are re-packed elsewhere, nothing else is deleted.
      const before = await page.evaluate((id) => game.actors.get(id).items.size, actorId);
      await root.locator("[data-action=configure]").click();
      await cfg.locator(`.attache-config-container[data-container-id="${pouchId}"] [data-action=removeContainer]`).click();
      await page.locator(".application.dialog button[data-action=yes]").last().click();
      await expect.poll(() => page.evaluate((id) => game.actors.get(id).items.size, actorId)).toBe(before - 1);
      const l = await layout(page, actorId);
      expect(l.placed[ids.m]).toBeTruthy();
      expect(l.containers.map((c) => c.id)).toEqual(["body", pack.id]);
      await screenshot(page, `${worldId}-qa-containers`);
    });

    test("06 GM tools: item size dialog, exclude/include, make container, body grid size", async () => {
      const page = gm.page;
      const { actorId, ids } = await makeActor(page, {
        name: "QA GM Tools", body: { cols: 6, rows: 4 },
        items: [
          { key: "p", name: "Pistol", kind: "weapon", w: 3, h: 2, pos: { c: "body", x: 0, y: 0 } },
          { key: "k", name: "Kit", w: 2, h: 2, pos: { c: "body", x: 3, y: 0 } },
          { key: "s", name: "Sack", w: 2, h: 1, pos: { c: "body", x: 0, y: 3 } }
        ]
      });
      const root = await openCase(page, actorId);

      // Inventory Size from the item sheet's header menu: 5x5 does not fit a 6x4 grid -> Unstowed.
      const sheetId = await page.evaluate(async ({ id, itemId }) => {
        const item = game.actors.get(id).items.get(itemId);
        await item.sheet.render({ force: true });
        return item.sheet.id;
      }, { id: actorId, itemId: ids.p });
      await page.locator(`[id="${sheetId}"] [data-action=toggleControls]`).first().click();
      await clickMenu(page, "Inventory Size");
      const dlg = page.locator(`[id="attache-size-Actor-${actorId}-Item-${ids.p}"]`);
      await expect(dlg).toBeVisible();
      await expect(dlg.locator(".attache-default")).toContainText("Default");
      await dlg.locator("input[name=w]").fill("5");
      await dlg.locator("input[name=h]").fill("5");
      await dlg.locator("button[type=submit]").click();
      await expect(dlg).toHaveCount(0);
      await expect.poll(async () => (await layout(page, actorId)).overflow).toContain(ids.p);
      expect((await itemFlags(page, actorId, ids.p)).size).toEqual({ w: 5, h: 5 });
      await page.evaluate((sid) => foundry.applications.instances.get(sid)?.close(), sheetId);

      // Same dialog from the tile context menu; Reset to Default clears the override.
      await root.locator(`.attache-overflow [data-item-id="${ids.p}"]`).click({ button: "right" });
      await clickMenu(page, "Inventory Size");
      await dlg.locator("[data-action=resetSize]").click();
      await dlg.locator("button[type=submit]").click();
      await expect.poll(async () => (await itemFlags(page, actorId, ids.p)).size).toBeUndefined();

      // Exclude / Include.
      await root.locator(`.attache-tile[data-item-id="${ids.k}"]`).click({ button: "right" });
      await clickMenu(page, "Exclude");
      await expect(root.locator(`.attache-excluded [data-item-id="${ids.k}"]`)).toHaveCount(1);
      await root.locator(".attache-excluded > summary").click();
      await root.locator(`.attache-excluded [data-item-id="${ids.k}"]`).click({ button: "right" });
      await clickMenu(page, "Include");
      await expect.poll(async () => (await itemFlags(page, actorId, ids.k)).excluded).toBeUndefined();
      await expect(root.locator(`.attache-excluded [data-item-id="${ids.k}"]`)).toHaveCount(0);

      // Make Container.
      await root.locator(`.attache-tile[data-item-id="${ids.s}"]`).click({ button: "right" });
      await clickMenu(page, "Make Container");
      const sdlg = page.locator(`[id="attache-size-Actor-${actorId}-Item-${ids.s}"]`);
      await expect(sdlg.locator("input[name=isContainer]")).toBeChecked();
      await sdlg.locator("input[name=cols]").fill("3");
      await sdlg.locator("input[name=rows]").fill("2");
      await sdlg.locator("button[type=submit]").click();
      await expect(root.locator(`.attache-grid[data-container-id="${ids.s}"]`)).toBeVisible();
      expect((await itemFlags(page, actorId, ids.s)).pos).toBeUndefined();

      // Body grid 0x0 (no grid), then back to the world default.
      await root.locator("[data-action=configure]").click();
      const cfg = page.locator(`[id="attache-config-Actor-${actorId}"]`);
      await cfg.locator("input[name='body.useDefault']").uncheck();
      await cfg.locator("input[name='body.cols']").fill("0");
      await cfg.locator("input[name='body.rows']").fill("0");
      await cfg.locator("button[type=submit]").click();
      await expect(root.locator('.attache-grid[data-container-id="body"]')).toHaveCount(0);
      await expect.poll(async () => (await layout(page, actorId)).containers.map((c) => c.id)).toEqual([ids.s]);
      await root.locator("[data-action=configure]").click();
      await cfg.locator("input[name='body.useDefault']").check();
      await expect(cfg.locator("input[name='body.cols']")).toBeDisabled();
      await cfg.locator("button[type=submit]").click();
      await expect(root.locator('.attache-grid[data-container-id="body"]')).toBeVisible();
      expect(await page.evaluate((id) => game.actors.get(id).flags["attache-case"]?.body, actorId)).toBeUndefined();
      const body = (await layout(page, actorId)).containers[0];
      expect([body.cols, body.rows]).toEqual([5, 3]);
    });

    test("07 auto-arrange and place unstowed", async () => {
      const page = pl.page;
      const { actorId, ids } = await makeActor(gm.page, {
        name: "QA Arrange", body: { cols: 4, rows: 4 },
        items: [
          { key: "a", name: "Long", w: 4, h: 1, pos: { c: "body", x: 0, y: 1 } },
          { key: "b", name: "Box", w: 2, h: 2, pos: { c: "body", x: 1, y: 2 } },
          { key: "c", name: "Tall", w: 1, h: 3 },
          { key: "d", name: "Small", w: 1, h: 1 }
        ]
      });
      const root = await openCase(page, actorId);
      expect((await layout(page, actorId)).overflow.sort()).toEqual([ids.c, ids.d].sort());
      await root.locator("[data-action=autoArrange]").click();
      await expect.poll(async () => (await layout(page, actorId)).overflow).toEqual([]);
      expect(Object.keys((await layout(page, actorId)).placed)).toHaveLength(4);
      // Place unstowed only fills gaps, never moves placed items.
      await page.evaluate(({ id, itemId }) => game.actors.get(id).items.get(itemId).unsetFlag("attache-case", "pos"), { id: actorId, itemId: ids.d });
      await expect(root.locator(`.attache-overflow [data-item-id="${ids.d}"]`)).toBeVisible();
      const placedBefore = (await layout(page, actorId)).placed;
      await root.locator("[data-action=packUnstowed]").click();
      await expect.poll(async () => (await layout(page, actorId)).overflow).toEqual([]);
      const placedAfter = (await layout(page, actorId)).placed;
      for (const id of [ids.a, ids.b, ids.c]) expect(placedAfter[id]).toEqual(placedBefore[id]);
    });

    test("08 external drops: sidebar item and system compendium item onto a cell", async () => {
      const page = gm.page;
      const { actorId } = await makeActor(page, { name: "QA Drops", body: { cols: 8, rows: 4 } });
      const worldItem = await page.evaluate(async ({ flag, type }) => {
        const it = await Item.create({ name: "QA Lamp", type, img: "icons/svg/light.svg",
          flags: { [flag.scope]: { [flag.key]: true }, "attache-case": { size: { w: 2, h: 2 } } } });
        return it.id;
      }, { flag: { scope: "world", key: "attacheQA" }, type: meta.system === "CoC7" ? "item" : "gear" });
      const root = await openCase(page, actorId);
      await page.evaluate(() => ui.items.activate());
      const grid = root.locator('.attache-grid[data-container-id="body"]');
      const g = await grid.boundingBox();
      const cell = g.width / 8;
      await page.locator(`#items .directory-item[data-entry-id="${worldItem}"]`).dragTo(grid, { targetPosition: { x: cell * 5.5, y: cell * 2.5 } });
      await expect.poll(() => page.evaluate((id) => game.actors.get(id).items.find((i) => i.name === "QA Lamp")?.flags["attache-case"]?.pos, actorId))
        .toEqual({ c: "body", x: 5, y: 2, r: false });
      // A system compendium weapon (identified by id) dropped at (0,0).
      const { packId, entryId, name } = await page.evaluate(async () => {
        const p = game.packs.find((x) => x.documentName === "Item" && x.metadata.packageType === "system" && /weapon|firearm/i.test(x.collection));
        const e = (await p.getIndex({ fields: ["type"] })).find((x) => x.type === "weapon" && /revolver|pistol/i.test(x.name));
        await p.render({ force: true });
        return { packId: p.collection, entryId: e._id, name: e.name };
      });
      // Entries may sit in collapsed folders: filter by name to reveal it.
      await page.locator(".application.compendium-directory input[type=search]").last().fill(name);
      await page.waitForTimeout(800); // the filter is debounced and re-lays the list out
      const entry = page.locator(`.application.compendium-directory .directory-item[data-entry-id="${entryId}"]`);
      await expect(entry).toBeVisible();
      await entry.dragTo(grid, { targetPosition: { x: cell * 0.5, y: cell * 0.5 } });
      const dropped = await expect.poll(() => page.evaluate(({ id, name }) => {
        const it = game.actors.get(id).items.find((i) => i.name === name);
        return it ? { pos: it.flags["attache-case"]?.pos, src: it._stats.compendiumSource } : null;
      }, { id: actorId, name })).toMatchObject({ pos: { c: "body", x: 0, y: 0, r: false } });
      void dropped;
      const src = await page.evaluate(({ id, name }) => game.actors.get(id).items.find((i) => i.name === name)._stats.compendiumSource, { id: actorId, name });
      expect(src).toContain(`Compendium.${packId}.Item.${entryId}`);
      await screenshot(page, `${worldId}-qa-drops`);
    });

    test("09 multi-client: player moves, GM sees it, one writer, no write storm, GM dialog keeps typed values", async () => {
      const { actorId, ids } = await makeActor(gm.page, {
        name: "QA Multi", body: { cols: 6, rows: 4 },
        items: [{ key: "a", name: "Flask", w: 1, h: 2, pos: { c: "body", x: 0, y: 0 } }]
      });
      const playerId = await pl.page.evaluate(() => game.user.id);
      for (const p of [gm.page, pl.page]) {
        await p.evaluate(() => {
          window.__qaUpdates = [];
          Hooks.on("updateItem", (item, _changed, _options, userId) => window.__qaUpdates.push([item.id, userId]));
        });
      }
      await openCase(gm.page, actorId);
      await openCase(pl.page, actorId);
      // The GM types in Configure without saving.
      await gm.page.locator(`${caseSel(actorId)} [data-action=configure]`).click();
      const cfg = gm.page.locator(`[id="attache-config-Actor-${actorId}"]`);
      await cfg.locator("input[name='body.cols']").fill("9");
      // The player moves the flask.
      await pointerDrag(pl.page, await tilePoint(pl.page, actorId, ids.a), await cellPoint(pl.page, actorId, "body", 3, 2));
      await waitForFlags(pl.page, actorId, ids.a, posIs("body", 3, 2));
      const tile = gm.page.locator(`${caseSel(actorId)} .attache-tile[data-item-id="${ids.a}"]`);
      await expect.poll(() => tile.evaluate((el) => [el.style.getPropertyValue("--x").trim(), el.style.getPropertyValue("--y").trim()])).toEqual(["3", "2"]);
      await gm.page.waitForTimeout(2000);
      const seen = await Promise.all([gm.page, pl.page].map((p) => p.evaluate(() => window.__qaUpdates)));
      expect(seen[0], "GM saw exactly one update, written by the player").toEqual([[ids.a, playerId]]);
      expect(seen[1], "player saw exactly one update").toEqual([[ids.a, playerId]]);
      await expect(cfg.locator("input[name='body.cols']")).toHaveValue("9");
    });

    test("10 transfers: give (owned), cross-window drag, GM relay, double give, no GM", async () => {
      const page = pl.page;
      await gm.page.evaluate(async () => {
        if (!game.users.getName("Player2")) await User.create({ name: "Player2", role: CONST.USER_ROLES.PLAYER });
      });
      const src = await makeActor(gm.page, {
        name: "QA Source", body: { cols: 6, rows: 4 },
        items: [
          { key: "a", name: "Wrench", w: 2, h: 1, pos: { c: "body", x: 0, y: 0 } },
          { key: "b", name: "Radio", w: 1, h: 2, pos: { c: "body", x: 2, y: 0 } },
          { key: "c", name: "Badge", w: 1, h: 1, pos: { c: "body", x: 3, y: 0 } },
          { key: "d", name: "Torch", w: 2, h: 1, pos: { c: "body", x: 4, y: 0 } },
          { key: "e", name: "Gloves", w: 1, h: 1, pos: { c: "body", x: 0, y: 3 } }
        ]
      });
      const mine = await makeActor(gm.page, { name: "QA Mine", body: { cols: 6, rows: 4 } });
      const theirs = await makeActor(gm.page, { name: "QA Theirs", owner: "Player2", body: { cols: 6, rows: 4 } });
      const count = (p, actorId, name) => p.evaluate(({ actorId, name }) => game.actors.get(actorId).items.filter((i) => i.name === name).length, { actorId, name });

      // a) Give to an owned actor through the context menu and dialog.
      const root = await openCase(page, src.actorId);
      await root.locator(`.attache-tile[data-item-id="${src.ids.a}"]`).click({ button: "right" });
      await clickMenu(page, "Give");
      const give = page.locator(".application.attache-give");
      await give.locator(".attache-give-option", { hasText: "QA Mine" }).click();
      await give.locator("button[data-action=give]").click();
      await expect.poll(() => count(page, mine.actorId, "Wrench")).toBe(1);
      expect(await count(page, src.actorId, "Wrench")).toBe(0);
      await screenshot(page, `${worldId}-qa-give-dialog`).catch(() => {});

      // b) Cross-window pointer drag onto a specific cell of another case.
      await openCase(page, mine.actorId);
      await page.evaluate(({ a, b }) => {
        foundry.applications.instances.get(`attache-case-Actor-${a}`).setPosition({ left: 20, top: 60 });
        foundry.applications.instances.get(`attache-case-Actor-${b}`).setPosition({ left: 820, top: 60 });
      }, { a: src.actorId, b: mine.actorId });
      await page.waitForTimeout(300);
      await pointerDrag(page, await tilePoint(page, src.actorId, src.ids.b), await cellPoint(page, mine.actorId, "body", 4, 1));
      await expect.poll(() => page.evaluate(({ id }) => game.actors.get(id).items.find((i) => i.name === "Radio")?.flags["attache-case"]?.pos, { id: mine.actorId }))
        .toEqual({ c: "body", x: 4, y: 1, r: false });
      expect(await count(page, src.actorId, "Radio")).toBe(0);
      await screenshot(page, `${worldId}-qa-two-windows`);
      // R with a focused tile in one window and the pointer over a tile of the other: only the hovered one rotates.
      const radioId = await page.evaluate((id) => game.actors.get(id).items.find((i) => i.name === "Radio").id, mine.actorId);
      await page.locator(`${caseSel(mine.actorId)} .attache-tile[data-item-id="${radioId}"]`).focus();
      const torch = await tilePoint(page, src.actorId, src.ids.d);
      await page.mouse.move(torch.x, torch.y);
      await page.keyboard.press("KeyR");
      await waitForFlags(page, src.actorId, src.ids.d, (f) => f.pos?.r === true);
      await page.waitForTimeout(500);
      expect((await itemFlags(page, mine.actorId, radioId)).pos.r).toBe(false);

      // c) GM relay: the target belongs to another player. Record what core passes as the handler context.
      await gm.page.evaluate(() => {
        const name = "attache-case.transfer";
        const orig = CONFIG.queries[name];
        CONFIG.queries[name] = async (data, context) => {
          window.__qaQuery = { keys: Object.keys(context ?? {}), user: context?.user?.name, isUser: context?.user?.documentName };
          return orig(data, context);
        };
      });
      const relayed = await page.evaluate(async ({ s, t, item }) => {
        const inv = await import("/modules/attache-case/scripts/foundry/inventory.mjs");
        return inv.transferItem(game.actors.get(s).items.get(item), game.actors.get(t), { kind: "cell", pos: { c: "body", x: 1, y: 1, r: false } });
      }, { s: src.actorId, t: theirs.actorId, item: src.ids.c });
      expect(relayed).toBe(true);
      const ctx = await gm.page.evaluate(() => window.__qaQuery);
      console.log(`[10] ${worldId} query handler context: ${JSON.stringify(ctx)}`);
      expect(ctx).toMatchObject({ user: "Player", isUser: "User" });
      await expect.poll(() => gm.page.evaluate(({ id }) => game.actors.get(id).items.find((i) => i.name === "Badge")?.flags["attache-case"]?.pos, { id: theirs.actorId }))
        .toEqual({ c: "body", x: 1, y: 1, r: false });
      expect(await count(page, src.actorId, "Badge")).toBe(0);

      // d) Double give, local and relayed: exactly one copy each time.
      const doubles = await page.evaluate(async ({ s, m, t, d, e }) => {
        const inv = await import("/modules/attache-case/scripts/foundry/inventory.mjs");
        const src = game.actors.get(s);
        const local = await Promise.all([inv.transferItem(src.items.get(d), game.actors.get(m)), inv.transferItem(src.items.get(d), game.actors.get(m))]);
        const relay = await Promise.all([inv.transferItem(src.items.get(e), game.actors.get(t)), inv.transferItem(src.items.get(e), game.actors.get(t))]);
        return { local, relay };
      }, { s: src.actorId, m: mine.actorId, t: theirs.actorId, d: src.ids.d, e: src.ids.e });
      console.log(`[10] ${worldId} double give results: ${JSON.stringify(doubles)}`);
      await page.waitForTimeout(1000);
      expect(await count(page, mine.actorId, "Torch")).toBe(1);
      expect(await count(gm.page, theirs.actorId, "Gloves")).toBe(1);
      expect(await count(page, src.actorId, "Torch")).toBe(0);
      expect(await count(page, src.actorId, "Gloves")).toBe(0);

      // e) No GM connected: a warning, nothing changes.
      const extra = await makeActor(gm.page, { name: "QA Lonely", body: { cols: 4, rows: 4 },
        items: [{ key: "x", name: "Coin", w: 1, h: 1, pos: { c: "body", x: 0, y: 0 } }] });
      await gm.page.goto(gm.page.url().replace(/\/game.*$/, "/join"));
      await expect.poll(() => page.evaluate(() => Boolean(game.users.activeGM)), { timeout: 30_000 }).toBe(false);
      await clearNotifications(page);
      const offline = await page.evaluate(async ({ s, t, item }) => {
        const inv = await import("/modules/attache-case/scripts/foundry/inventory.mjs");
        return inv.transferItem(game.actors.get(s).items.get(item), game.actors.get(t));
      }, { s: extra.actorId, t: theirs.actorId, item: extra.ids.x });
      expect(offline).toBe(false);
      await expect(page.locator("#notifications .notification", { hasText: "No GM is connected" })).toBeVisible();
      expect(await count(page, extra.actorId, "Coin")).toBe(1);
      await loginAs(gm.page, "Gamemaster");
    });

    test("11 UI scale and window scale: drops land under the preview", async () => {
      const page = pl.page;
      const { actorId, ids } = await makeActor(gm.page, {
        name: "QA Scale", body: { cols: 6, rows: 4 },
        items: [{ key: "a", name: "Crowbar", w: 3, h: 1, pos: { c: "body", x: 0, y: 0 } }]
      });
      await openCase(page, actorId);
      const setUi = (scale) => page.evaluate(async (scale) => {
        const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
        cfg.uiScale = scale;
        await game.settings.set("core", "uiConfig", cfg);
        game.configureUI(cfg);
      }, scale);
      const setWin = (scale) => page.evaluate(({ id, scale }) => foundry.applications.instances.get(`attache-case-Actor-${id}`).setPosition({ scale }), { id: actorId, scale });
      const cases = [["ui 0.8", () => setUi(0.8)], ["ui 1.25", () => setUi(1.25)], ["window 1.25", async () => { await setUi(1); await setWin(1.25); }],
        ["window 0.8", () => setWin(0.8)]];
      let n = 0;
      for (const [label, apply] of cases) {
        await apply();
        await page.waitForTimeout(400);
        const target = n % 2 ? { x: 0, y: 0 } : { x: 2, y: 3 };
        // Grab the middle cell of the 3x1 crowbar: its top-left lands one cell left of the cursor.
        await pointerDrag(page, await tilePoint(page, actorId, ids.a, 1, 0), await cellPoint(page, actorId, "body", target.x + 1, target.y));
        await waitForFlags(page, actorId, ids.a, posIs("body", target.x, target.y)).catch((err) => { throw new Error(`${label}: ${err.message}`); });
        n++;
      }
      await screenshot(page, `${worldId}-qa-window-scale`);
      await setWin(1);
      await setUi(1);
    });

    test("12 settings: all render and take effect", async () => {
      const page = gm.page;
      await page.evaluate(() => new foundry.applications.settings.SettingsConfig().render({ force: true }));
      const sc = page.locator(".application#settings-config, .application.settings-config").first();
      await expect(sc).toBeVisible();
      await sc.locator('[data-tab="attache-case"], [data-category="attache-case"]').first().click();
      for (const key of ["defaultBodyCols", "defaultBodyRows", "autoPlace", "allowWorn", "playersCanEditSizes", "cellSize", "showNames"]) {
        await expect(sc.locator(`[name="attache-case.${key}"]`).first(), key).toBeAttached();
      }
      await screenshot(page, `${worldId}-qa-settings`);
      await closeAll(page);

      const set = (k, v) => page.evaluate(({ k, v }) => game.settings.set("attache-case", k, v), { k, v });
      const { actorId, ids } = await makeActor(page, {
        name: "QA Settings",
        items: [
          { key: "a", name: "Pipe", w: 3, h: 2, pos: { c: "body", x: 0, y: 0 } },
          { key: "v", name: "Coat", kind: "armor", w: 2, h: 2, worn: true }
        ]
      });
      const root = await openCase(page, actorId);
      // Default body size (actor has no own body flag).
      await set("defaultBodyCols", 7);
      await set("defaultBodyRows", 2);
      await expect.poll(async () => (await layout(page, actorId)).containers[0]).toMatchObject({ cols: 7, rows: 2 });
      await expect(root.locator('.attache-panel.is-body')).toHaveAttribute("style", /--cols: 7; --rows: 2/);
      // Cell size (client).
      await set("cellSize", 64);
      await expect.poll(() => root.locator('.attache-grid[data-container-id="body"]').evaluate((el) => Math.round(el.getBoundingClientRect().width)).catch(() => 0)).toBe(7 * 64);
      await set("cellSize", 48);
      // Names on tiles (client).
      await expect(root.locator(".attache-tile-name").first()).toBeVisible();
      await set("showNames", false);
      await expect(root.locator(".attache-tile-name")).toHaveCount(0);
      await set("showNames", true);
      // Worn armor (world): off -> no Worn strip and the coat takes space again.
      await expect(root.locator(".attache-worn [data-item-id]")).toHaveCount(1);
      await set("allowWorn", false);
      await expect(root.locator(".attache-worn")).toHaveCount(0);
      await expect.poll(async () => { const l = await layout(page, actorId); return Boolean(l.placed[ids.v]) || l.overflow.includes(ids.v); }).toBe(true);
      await set("allowWorn", true);
      // Auto placement (world).
      await set("autoPlace", false);
      const unplaced = await page.evaluate(async (id) => (await game.actors.get(id).createEmbeddedDocuments("Item", [{ name: "Loose", type: game.system.id === "CoC7" ? "item" : "gear" }]))[0].id, actorId);
      expect((await itemFlags(page, actorId, unplaced)).pos).toBeUndefined();
      await set("autoPlace", true);
      const placed = await page.evaluate(async (id) => (await game.actors.get(id).createEmbeddedDocuments("Item", [{ name: "Placed", type: game.system.id === "CoC7" ? "item" : "gear" }]))[0].id, actorId);
      expect((await itemFlags(page, actorId, placed)).pos).toBeTruthy();
      // Players editing sizes (world).
      await page.evaluate(({ id, u }) => game.actors.get(id).update({ [`ownership.${game.users.getName(u).id}`]: 3 }), { id: actorId, u: "Player" });
      const proot = await openCase(pl.page, actorId);
      await proot.locator(`.attache-tile[data-item-id="${ids.a}"]`).click({ button: "right" });
      await expect(pl.page.locator("#context-menu .context-item", { hasText: "Inventory Size" })).toHaveCount(0);
      await pl.page.keyboard.press("Escape");
      await pl.page.mouse.click(5, 500);
      await set("playersCanEditSizes", true);
      await pl.page.waitForTimeout(500);
      await proot.locator(`.attache-tile[data-item-id="${ids.a}"]`).click({ button: "right" });
      await expect(pl.page.locator("#context-menu .context-item", { hasText: "Inventory Size" })).toHaveCount(1);
      await pl.page.mouse.click(5, 500);
      await set("playersCanEditSizes", false);
      await set("defaultBodyCols", 5);
      await set("defaultBodyRows", 3);
    });

    test("13 pt-BR: every string is translated", async () => {
      const page = gm.page;
      const { actorId, ids } = await makeActor(page, {
        name: "QA Idioma", body: { cols: 6, rows: 3 },
        containers: [{ key: "bag", name: "Mochila", cols: 5, rows: 3 }],
        items: [
          { key: "a", name: "Revólver", kind: "weapon", w: 3, h: 2, pos: { c: "body", x: 0, y: 0 } },
          { key: "b", name: "Corda", w: 2, h: 2 },
          { key: "v", name: "Colete", kind: "armor", w: 3, h: 3, worn: true }
        ]
      });
      await page.evaluate(() => game.settings.set("core", "language", "pt-BR"));
      await page.reload();
      await page.waitForFunction(() => game?.ready === true, null, { timeout: 120_000 });
      await page.evaluate(() => ui.notifications.clear());
      try {
        expect(await page.evaluate(() => game.i18n.lang)).toBe("pt-BR");
        const root = await openCase(page, actorId);
        await root.locator("[data-action=configure]").click();
        await page.evaluate(async ({ id, item }) => {
          const { ItemSizeConfig } = await import("/modules/attache-case/scripts/apps/item-size-config.mjs");
          ItemSizeConfig.open(game.actors.get(id).items.get(item));
        }, { id: actorId, item: ids.a });
        await page.waitForTimeout(800);
        await root.locator(`.attache-tile[data-item-id="${ids.a}"]`).click({ button: "right" });
        const { texts, tooltipKeys } = await page.evaluate(() => {
          const roots = [...document.querySelectorAll(".attache-case, .attache-case-dialog, #context-menu")];
          return {
            texts: roots.map((el) => el.innerText + " " + [...el.querySelectorAll("[aria-label],[placeholder],[title]")]
              .map((e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("placeholder") ?? ""} ${e.getAttribute("title") ?? ""}`).join(" ")),
            // data-tooltip holds keys on purpose (core localizes them on display): they must exist.
            tooltipKeys: roots.flatMap((el) => [...el.querySelectorAll("[data-tooltip]")].map((e) => e.dataset.tooltip))
              .filter((k) => k.startsWith("ATTACHE.") && !game.i18n.has(k))
          };
        });
        const raw = texts.join("\n").match(/ATTACHE\.[\w.]+/g) ?? [];
        expect(raw, "untranslated keys").toEqual([]);
        expect(tooltipKeys, "tooltip keys missing in pt-BR").toEqual([]);
        for (const word of ["Fora da maleta", "Vestido", "No Corpo", "Organizar", "Girar"]) expect(texts.join(" ")).toContain(word);
        await screenshot(page, `${worldId}-qa-ptbr`);
      } finally {
        await page.evaluate(() => game.settings.set("core", "language", "en"));
        await page.reload();
        await page.waitForFunction(() => game?.ready === true, null, { timeout: 120_000 });
        await page.evaluate(() => ui.notifications.clear());
      }
    });

    /* ------------------------------------------------------------------ */

    test("99 console: no errors or warnings from attache-case", async () => {
      const all = [...(gm?.errors ?? []), ...(pl?.errors ?? [])];
      expect(moduleErrors(all)).toEqual([]);
    });
  });
}
