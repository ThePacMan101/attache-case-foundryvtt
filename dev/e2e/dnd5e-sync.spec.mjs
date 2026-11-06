/**
 * Two-way sync of native bags and Worn on dnd5e (PLAN M4), on the clean `attache-dnd5e` world, GM and Player in two
 * browser contexts: real mouse on the case, real HTML5 drag on the real dnd5e sheets. Encumbrance, AC and the sheet's
 * lists are dnd5e's own, which is what the unit tests cannot show. Setup goes through `evaluate`; what the acceptance
 * calls a user action does not. Not serial: a failure re-opens both sessions and the other tests still run, so
 * console errors are checked after every test. Fixtures carry `world.attacheQA` and are removed at the start of a run.
 */

import { test, expect } from "@playwright/test";
import { moduleErrors, screenshot } from "./helpers.mjs";
import {
  session, resetWorld, makeActor, openCase, caseSel, closeAll, clickMenu, clearNotifications, setScheme, QA_FLAG,
  pointerDrag, tilePoint, cellPoint, chipPoint, zonePoint, layout
} from "./qa.mjs";

const WORLD = "attache-dnd5e";
const PACK = "dnd5e.equipment24";

/** Real compendium items on an actor, through the normal create path. */
async function addFromPack(page, actorId, names, pack = PACK) {
  return page.evaluate(async ({ actorId, names, pack }) => {
    const p = game.packs.get(pack);
    const index = await p.getIndex();
    const list = [];
    for (const name of names) list.push(game.items.fromCompendium(await p.getDocument(index.find((e) => e.name === name)._id)));
    const created = await game.actors.get(actorId).createEmbeddedDocuments("Item", list);
    return Object.fromEntries(created.map((d) => [d.name, d.id]));
  }, { actorId, names, pack });
}

/**
 * A character as a real world holds one: dnd5e data only, none of our flags, no hook of ours ever ran on it. `items`:
 * `[pack item name, {in: index of the bag in this list, equipped}]`. Created with auto-placement off, as dropping it
 * in with `Actor.create` would otherwise run the create-actor packing.
 */
async function worldCharacter(page, name, items, { owner = "Player" } = {}) {
  return page.evaluate(async ({ name, items, owner, flag, PACK }) => {
    const p = game.packs.get(PACK);
    const index = await p.getIndex();
    const data = [];
    for (const [itemName, extra = {}] of items) {
      const doc = game.items.fromCompendium(await p.getDocument(index.find((e) => e.name === itemName)._id));
      doc._id = foundry.utils.randomID();
      data.push({ doc, extra });
    }
    for (const { doc, extra } of data) {
      doc.system.container = extra.in === undefined ? null : data[extra.in].doc._id;
      if (extra.equipped !== undefined) doc.system.equipped = extra.equipped;
    }
    await game.settings.set("attache-case", "autoPlace", false);
    const actor = await Actor.create({
      name, type: "character", flags: { [flag.scope]: { [flag.key]: true } },
      ownership: { default: 0, [game.users.getName(owner).id]: 3 },
      items: data.map(({ doc }) => doc)
    });
    await game.settings.set("attache-case", "autoPlace", true);
    return { actorId: actor.id, ids: Object.fromEntries(data.map(({ doc }) => [doc.name, doc._id])) };
  }, { name, items, owner, flag: QA_FLAG, PACK });
}

const read = (page, actorId, id) => page.evaluate(({ actorId, id }) => {
  const item = game.actors.get(actorId).items.get(id);
  if (!item) return null;
  return {
    container: item.system.container, equipped: item.system.equipped, attuned: item.system.attuned, pos: item.flags["attache-case"]?.pos,
    art: item.flags["attache-case"]?.art, gearSource: item.flags.dnd5e?.gearSource, name: item.name
  };
}, { actorId, id });
const byName = (page, actorId, name) => page.evaluate(({ actorId, name }) => game.actors.get(actorId).items.find((i) => i.name === name)?.id ?? null, { actorId, name });
const itemCount = (page, actorId) => page.evaluate((actorId) => game.actors.get(actorId).items.size, actorId);
const ac = (page, actorId) => page.evaluate((actorId) => game.actors.get(actorId).system.attributes.ac.value, actorId);
const encumbrance = (page, actorId) => page.evaluate((actorId) => game.actors.get(actorId).system.attributes.encumbrance.value, actorId);
const tile = (page, actorId, itemId) => page.locator(`${caseSel(actorId)} .attache-tile[data-item-id="${itemId}"]`);
const chip = (page, actorId, itemId) => page.locator(`${caseSel(actorId)} .attache-chip[data-item-id="${itemId}"]`);
const grid = (page, actorId, id) => page.locator(`${caseSel(actorId)} .attache-grid[data-container-id="${id}"]`);
const worn = (page, actorId, itemId) => page.locator(`${caseSel(actorId)} .attache-worn .attache-chip[data-item-id="${itemId}"]`);
const unstowed = (page, actorId, itemId) => page.locator(`${caseSel(actorId)} .attache-overflow .attache-chip[data-item-id="${itemId}"]`);

/** Move and size a window; the case's id is known, a sheet is found through its document. */
async function placeCase(page, actorId, position) {
  await page.evaluate(({ actorId, position }) => foundry.applications.instances.get(`attache-case-Actor-${actorId}`).setPosition(position), { actorId, position });
  await page.waitForTimeout(150);
}

/** The actor's real sheet on its Inventory tab, to the right of the case. */
async function openSheet(page, actorId) {
  const id = await page.evaluate(async (actorId) => {
    const sheet = game.actors.get(actorId).sheet;
    await sheet.render({ force: true });
    await sheet.changeTab?.("inventory", "primary");
    sheet.setPosition({ left: 800, top: 10 });
    return sheet.id;
  }, actorId);
  await page.waitForTimeout(500);
  const sheet = page.locator(`[id="${id}"]`);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** A container's real sheet, away from the rest. */
async function openContainerSheet(page, actorId, id, position = { left: 1120, top: 500 }) {
  const sheetId = await page.evaluate(async ({ actorId, id, position }) => {
    const sheet = game.actors.get(actorId).items.get(id).sheet;
    await sheet.render({ force: true });
    sheet.setPosition(position);
    return sheet.id;
  }, { actorId, id, position });
  await page.waitForTimeout(500);
  const sheet = page.locator(`[id="${sheetId}"]`);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** One real HTML5 drag on the sheet. */
async function sheetDrag(page, from, to, targetPosition) {
  await expect(from).toBeVisible();
  await from.dragTo(to, { timeout: 20_000, ...(targetPosition ? { targetPosition } : {}) });
  await page.waitForTimeout(300);
}

/** A pack's Waterskin that really holds Water, created through the service a drop uses. */
async function dropFilledWaterskin(page, actorId) {
  return page.evaluate(async ({ actorId, PACK }) => {
    const docs = await game.packs.get(PACK).getDocuments();
    const holder = docs.find((d) => d.name === "Waterskin" && docs.some((c) => c.system.container === d.id));
    const { addFromDrop } = await import("/modules/attache-case/scripts/foundry/inventory.mjs");
    return (await addFromDrop(game.actors.get(actorId), { type: "Item", uuid: holder.uuid }, { kind: "auto" })).id;
  }, { actorId, PACK });
}

/** Every client records its item updates, with who wrote them and whether they carry our marker. */
async function installCounter(page) {
  await page.evaluate(() => {
    globalThis.__updates = [];
    Hooks.on("updateItem", (item, changed, options, userId) => {
      globalThis.__updates.push({ id: item.id, userId, synced: Boolean(options["attache-case"]?.synced), keys: Object.keys(foundry.utils.flattenObject(changed)) });
    });
  });
}
const clearCount = (s) => s.page.evaluate(() => { globalThis.__updates.length = 0; });
const counted = (s) => s.page.evaluate(() => globalThis.__updates);

test.describe(WORLD, () => {
  let gm;
  let pl;
  let playerId;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(400_000);
    gm = await session(browser, WORLD, "Gamemaster", { canvas: false });
    await resetWorld(gm.page);
    await gm.page.evaluate(async () => {
      if (!game.users.getName("Player2")) await User.create({ name: "Player2", role: CONST.USER_ROLES.PLAYER });
    });
    pl = await session(browser, WORLD, "Player", { canvas: false });
    await installCounter(gm.page);
    await installCounter(pl.page);
    playerId = await pl.page.evaluate(() => game.user.id);
  });

  test.beforeEach(async () => {
    await clearCount(gm);
    await clearCount(pl);
  });

  test.afterEach(async () => {
    for (const s of [gm, pl]) if (s) await closeAll(s.page).catch(() => {});
    expect(moduleErrors(gm?.errors ?? []), "GM console").toEqual([]);
    expect(moduleErrors(pl?.errors ?? []), "Player console").toEqual([]);
  });

  test.afterAll(async () => {
    await gm?.ctx.close();
    await pl?.ctx.close();
  });

  test("01 grid to sheet: drag into a bag sets system.container, out clears it, the sheet lists it, one update per client", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 01" });
    const ids = await addFromPack(gm.page, actorId, ["Backpack", "Dagger"]);
    await openCase(pl.page, actorId);
    await openCase(gm.page, actorId);
    await expect(tile(pl.page, actorId, ids.Dagger)).toBeVisible();
    await expect(grid(pl.page, actorId, ids.Backpack)).toBeVisible();
    await clearCount(gm);
    await clearCount(pl);

    await pointerDrag(pl.page, await tilePoint(pl.page, actorId, ids.Dagger), await cellPoint(pl.page, actorId, ids.Backpack, 1, 2));
    await expect.poll(async () => (await read(pl.page, actorId, ids.Dagger)).container).toBe(ids.Backpack);
    expect((await read(gm.page, actorId, ids.Dagger)).pos).toEqual({ c: ids.Backpack, x: 1, y: 2, r: false });
    await pl.page.waitForTimeout(400);
    for (const s of [gm, pl]) {
      const list = await counted(s);
      expect(list, "one updateItem per client").toHaveLength(1);
      expect(list[0].synced).toBe(true);
      expect(list[0].keys).toEqual(expect.arrayContaining(["system.container"]));
    }
    // GM's window follows, in the bag.
    await expect(grid(gm.page, actorId, ids.Backpack).locator(`.attache-tile[data-item-id="${ids.Dagger}"]`)).toBeVisible();

    // dnd5e's own view: the bag's contents, the sheet's top list no longer has the row, the bag's sheet has it.
    expect(await pl.page.evaluate(({ a, b, d }) => game.actors.get(a).items.get(b).system.contents.has(d), { a: actorId, b: ids.Backpack, d: ids.Dagger })).toBe(true);
    const sheet = await openSheet(pl.page, actorId);
    await expect(sheet.locator(`[data-item-id="${ids.Dagger}"]`)).toHaveCount(0);
    const inner = await openContainerSheet(pl.page, actorId, ids.Backpack);
    await expect(inner.locator(`[data-item-id="${ids.Dagger}"]`)).toBeVisible();
    await closeAll(pl.page);
    await openCase(pl.page, actorId);
    await clearCount(gm);
    await clearCount(pl);

    await pointerDrag(pl.page, await tilePoint(pl.page, actorId, ids.Dagger), await cellPoint(pl.page, actorId, "body", 2, 1));
    await expect.poll(async () => (await read(pl.page, actorId, ids.Dagger)).container).toBeNull();
    expect((await read(gm.page, actorId, ids.Dagger)).pos).toEqual({ c: "body", x: 2, y: 1, r: false });
    await pl.page.waitForTimeout(400);
    expect(await counted(gm)).toHaveLength(1);
    expect(await counted(pl)).toHaveLength(1);
    const again = await openSheet(pl.page, actorId);
    await expect(again.locator(`[data-item-id="${ids.Dagger}"]`)).toBeVisible();
  });

  test("02 the encumbrance value follows a Bag of Holding, and comes back", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 02" });
    const ids = await addFromPack(gm.page, actorId, ["Bag of Holding", "Greatsword"]);
    await openCase(pl.page, actorId);
    const before = await encumbrance(pl.page, actorId);
    expect(before).toBeGreaterThan(0);
    await pointerDrag(pl.page, await tilePoint(pl.page, actorId, ids.Greatsword), await cellPoint(pl.page, actorId, ids["Bag of Holding"], 0, 0));
    await expect.poll(() => encumbrance(pl.page, actorId)).toBeLessThan(before);
    expect((await read(pl.page, actorId, ids.Greatsword)).container).toBe(ids["Bag of Holding"]);
    await pointerDrag(pl.page, await tilePoint(pl.page, actorId, ids.Greatsword), await cellPoint(pl.page, actorId, "body", 0, 0));
    await expect.poll(() => encumbrance(pl.page, actorId)).toBe(before);
  });

  test("03 sheet to grid: moving on the real sheet moves the tile, by the writing client only", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 03" });
    const ids = await addFromPack(gm.page, actorId, ["Backpack", "Dagger", "Rope"]);
    await openCase(gm.page, actorId);
    await openCase(pl.page, actorId);
    await placeCase(pl.page, actorId, { left: 10, top: 10, width: 760, height: 900 });
    await expect(tile(pl.page, actorId, ids.Dagger)).toBeVisible();
    const sheet = await openSheet(pl.page, actorId);
    await clearCount(gm);
    await clearCount(pl);

    await sheetDrag(pl.page, sheet.locator(`[data-item-id="${ids.Dagger}"]`).first(), sheet.locator(`li.container[data-item-id="${ids.Backpack}"]`));
    await expect.poll(async () => (await read(pl.page, actorId, ids.Dagger)).container).toBe(ids.Backpack);
    // Both clients see it arrive in the bag grid.
    await expect(grid(pl.page, actorId, ids.Backpack).locator(`.attache-tile[data-item-id="${ids.Dagger}"]`)).toBeVisible();
    await expect(grid(gm.page, actorId, ids.Backpack).locator(`.attache-tile[data-item-id="${ids.Dagger}"]`)).toBeVisible();
    await pl.page.waitForTimeout(500);
    for (const s of [gm, pl]) {
      const list = (await counted(s)).filter((u) => u.id === ids.Dagger);
      expect(list.every((u) => u.userId === playerId), "only the writing client writes").toBe(true);
      expect(list.filter((u) => u.keys.includes("system.container")), "the sheet's own update").toHaveLength(1);
      expect(list.filter((u) => u.synced), "and one marked update for the tile").toHaveLength(1);
    }
    expect((await read(gm.page, actorId, ids.Dagger)).pos.c).toBe(ids.Backpack);

    // Moved out on the real sheet: from the bag's sheet to the actor's inventory.
    await clearCount(gm);
    await clearCount(pl);
    const inner = await openContainerSheet(pl.page, actorId, ids.Backpack);
    await sheetDrag(pl.page, inner.locator(`[data-item-id="${ids.Dagger}"]`).first(), sheet.locator(`[data-item-id="${ids.Rope}"]`).first());
    await expect.poll(async () => (await read(pl.page, actorId, ids.Dagger)).container).toBeNull();
    await expect(grid(pl.page, actorId, "body").locator(`.attache-tile[data-item-id="${ids.Dagger}"]`)).toBeVisible();
    await expect(grid(gm.page, actorId, "body").locator(`.attache-tile[data-item-id="${ids.Dagger}"]`)).toBeVisible();
    await pl.page.waitForTimeout(500);
    for (const s of [gm, pl]) {
      const list = (await counted(s)).filter((u) => u.id === ids.Dagger);
      expect(list.every((u) => u.userId === playerId)).toBe(true);
      expect(list.filter((u) => u.synced)).toHaveLength(1);
    }
    expect((await read(pl.page, actorId, ids.Dagger)).pos.c).toBe("body");
    expect(await layout(pl.page, actorId)).toEqual(await layout(gm.page, actorId));
  });

  test("04 existing data: a filled Backpack on a real character shows in the bag grid, and both users see the same", async () => {
    const { actorId, ids } = await worldCharacter(gm.page, "QA Sync 04", [
      ["Backpack"], ["Rope", { in: 0, equipped: true }], ["Tinderbox", { in: 0, equipped: true }], ["Waterskin", { in: 0 }], ["Longsword", { equipped: true }], ["Chain Mail", { equipped: true }]
    ]);
    const before = await gm.page.evaluate((id) => game.actors.get(id).items.map((i) => [i.id, i.system.container, i.system.equipped]), actorId);
    for (const id of Object.values(ids)) expect((await read(gm.page, actorId, id)).pos, "no flag of ours yet").toBeUndefined();
    await clearCount(gm);
    await clearCount(pl);
    // Counted where one batch is one call: four hooks alone would also pass for four separate updates.
    await pl.page.evaluate(() => {
      const cls = CONFIG.Item.documentClass;
      const original = cls.updateDocuments;
      globalThis.__ops = [];
      cls.updateDocuments = function(updates, operation) {
        globalThis.__ops.push(updates.length);
        return original.call(this, updates, operation);
      };
    });

    await openCase(pl.page, actorId);
    for (const name of ["Rope", "Tinderbox", "Waterskin"]) {
      await expect(grid(pl.page, actorId, ids.Backpack).locator(`.attache-tile[data-item-id="${ids[name]}"]`), name).toBeVisible();
    }
    await expect(grid(pl.page, actorId, "body").locator(`.attache-tile[data-item-id="${ids.Longsword}"]`)).toBeVisible();
    await expect(worn(pl.page, actorId, ids["Chain Mail"])).toBeVisible();
    await expect(pl.page.locator(`${caseSel(actorId)} .attache-overflow .attache-chip`)).toHaveCount(0);

    // One batched write, with `pos` only; dnd5e's data is what it was.
    await pl.page.waitForTimeout(400);
    const operations = await pl.page.evaluate(() => {
      delete CONFIG.Item.documentClass.updateDocuments;
      return globalThis.__ops;
    });
    expect(operations, "one update operation holding all four").toEqual([4]);
    for (const s of [gm, pl]) {
      const list = await counted(s);
      expect(list.filter((u) => u.userId === playerId).length, "one batch of 4").toBe(4);
      expect(list.flatMap((u) => u.keys).filter((k) => k.startsWith("system.")), "no native write").toEqual([]);
      expect(list.every((u) => u.synced)).toBe(true);
    }
    expect(await gm.page.evaluate((id) => game.actors.get(id).items.map((i) => [i.id, i.system.container, i.system.equipped]), actorId)).toEqual(before);

    // The GM opens it next: same picture, no second write.
    await clearCount(gm);
    await clearCount(pl);
    await openCase(gm.page, actorId);
    await expect(grid(gm.page, actorId, ids.Backpack).locator(".attache-tile")).toHaveCount(3);
    await gm.page.waitForTimeout(300);
    expect(await counted(gm)).toEqual([]);
    expect(await layout(gm.page, actorId)).toEqual(await layout(pl.page, actorId));
    await screenshot(pl.page, `${WORLD}-m4-existing-data`);

    // Re-opening writes nothing more.
    await closeAll(pl.page);
    await openCase(pl.page, actorId);
    await pl.page.waitForTimeout(300);
    expect(await counted(pl)).toEqual([]);
  });

  test("05 Explorer's Pack from the compendium keeps 7 children, on the case and on the sheet; the Waterskin is a tile, its Water has none", async () => {
    const check = async (page, actorId) => {
      const report = await page.evaluate((actorId) => {
        const actor = game.actors.get(actorId);
        const pack = actor.items.find((i) => i.name === "Explorer's Pack");
        const skin = actor.items.find((i) => i.name === "Waterskin");
        return {
          bag: pack?.id, children: pack?.system.contents.size, skin: skin?.id, skinIn: skin?.system.container,
          water: skin ? [...skin.system.contents.values()].map((i) => i.id) : [], total: actor.items.size
        };
      }, actorId);
      expect(report.children, "children of the pack").toBe(7);
      expect(report.total).toBe(9);
      expect(report.skinIn).toBe(report.bag);
      expect(report.water).toHaveLength(1);
      await expect(grid(page, actorId, report.bag).locator(".attache-tile")).toHaveCount(7);
      await expect(tile(page, actorId, report.skin)).toBeVisible();
      await expect(tile(page, actorId, report.water[0])).toHaveCount(0);
      await expect(chip(page, actorId, report.water[0])).toHaveCount(0);
      const l = await layout(page, actorId);
      expect(l.held).toEqual(report.water);
      expect(l.overflow).toEqual([]);
      await expect(page.locator("#notifications .notification", { hasText: "did not fit" })).toHaveCount(0);
    };
    const entryId = await gm.page.evaluate(async (pack) => (await game.packs.get(pack).getIndex()).find((e) => e.name === "Explorer's Pack")._id, PACK);
    const openPack = async (page) => {
      await page.evaluate((pack) => game.packs.get(pack).render({ force: true }), PACK);
      const id = `Compendium-${PACK.replaceAll(".", "_")}`;
      await expect(page.locator(`[id="${id}"]`)).toBeVisible();
      await page.evaluate((id) => foundry.applications.instances.get(id).setPosition({ left: 1200, top: 480, width: 340, height: 500 }), id);
      await page.locator(`[id="${id}"] input[type=search]`).fill("Explorer");
      await page.waitForTimeout(800);
      const entry = page.locator(`[id="${id}"] .directory-item[data-entry-id="${entryId}"]`);
      await expect(entry).toBeVisible();
      return entry;
    };

    // Onto the case.
    const onCase = await makeActor(gm.page, { name: "QA Sync 05a" });
    const page = pl.page;
    await clearNotifications(page);
    await openCase(page, onCase.actorId);
    await placeCase(page, onCase.actorId, { left: 10, top: 10 });
    const entry = await openPack(page);
    await entry.dragTo(grid(page, onCase.actorId, "body"), { timeout: 20_000 });
    await expect.poll(() => itemCount(page, onCase.actorId)).toBe(9);
    await page.waitForTimeout(500);
    await check(page, onCase.actorId);
    await closeAll(page);

    // Onto the real sheet: dnd5e's own route, our hooks place everything.
    const onSheet = await makeActor(gm.page, { name: "QA Sync 05b" });
    await clearNotifications(page);
    await openCase(page, onSheet.actorId);
    await placeCase(page, onSheet.actorId, { left: 10, top: 10, width: 760 });
    const sheet = await openSheet(page, onSheet.actorId);
    await clearCount(pl);
    const entry2 = await openPack(page);
    await entry2.dragTo(sheet.locator('section.tab[data-tab="inventory"]'), { timeout: 20_000, targetPosition: { x: 80, y: 60 } });
    await expect.poll(() => itemCount(page, onSheet.actorId)).toBe(9);
    await page.waitForTimeout(600);
    await check(page, onSheet.actorId);
    const list = await counted(pl);
    expect(new Set(list.filter((u) => u.synced).map((u) => u.id)).size, "seven children placed").toBe(7);
    await screenshot(page, `${WORLD}-m4-explorers-pack`);
  });

  test("06 oracle: every filled bag of the system's packs holds all its children on an empty grid", async () => {
    const report = await gm.page.evaluate(async () => {
      const service = await import("/modules/attache-case/scripts/foundry/inventory.mjs");
      const adapter = await import("/modules/attache-case/scripts/foundry/system-adapter.mjs");
      const { autoArrange } = await import("/modules/attache-case/scripts/core/layout.mjs");
      const out = { checked: 0, bags: [], failures: [] };
      for (const key of ["dnd5e.items", "dnd5e.equipment24"]) {
        const docs = await game.packs.get(key).getDocuments();
        for (const doc of docs) {
          if (doc.type !== "container") continue;
          const dims = adapter.containerDims(doc);
          const contents = await doc.system.contents;
          if (!contents?.size) continue;
          if (!dims) continue;
          const items = [];
          for (const child of contents.values()) {
            if (adapter.containerDims(child)) continue; // a bag in a bag is a panel of its own
            const { size } = service.itemSize(child);
            if (size) items.push({ id: child.id, size, sort: 0, name: child.name });
          }
          out.checked++;
          out.bags.push(`${key}: ${doc.name} ${dims.cols}x${dims.rows} ${items.length}`);
          const r = autoArrange([{ id: doc.id, cols: dims.cols, rows: dims.rows }], items);
          if (r.overflow.length) out.failures.push(`${key}: ${doc.name} ${dims.cols}x${dims.rows} loses ${r.overflow.map((id) => items.find((i) => i.id === id).name)}`);
        }
      }
      return out;
    });
    console.log(`[06] bags checked: ${report.checked}`, report.bags);
    expect(report.checked, "Packs and the Haversack, in both packs").toBeGreaterThanOrEqual(14);
    expect(report.failures).toEqual([]);
  });

  test("07 removal: through the case its children move out; deleted on the sheet, no item is lost; with contents they all go", async () => {
    // Through the case, GM's menu. A bag in the bag keeps what it holds.
    const a = await makeActor(gm.page, { name: "QA Sync 07a" });
    const ids = await addFromPack(gm.page, a.actorId, ["Backpack", "Sack", "Pouch", "Dagger", "Rope"]);
    await gm.page.evaluate(({ a, ids }) => game.actors.get(a).updateEmbeddedDocuments("Item", [
      { _id: ids.Pouch, "system.container": ids.Backpack },
      { _id: ids.Dagger, "system.container": ids.Backpack },
      { _id: ids.Rope, "system.container": ids.Pouch }
    ]), { a: a.actorId, ids });
    await gm.page.waitForTimeout(400);
    const root = await openCase(gm.page, a.actorId);
    await expect(grid(gm.page, a.actorId, ids.Pouch).locator(`.attache-tile[data-item-id="${ids.Rope}"]`), "a bag in a bag is its own panel").toBeVisible();
    await expect(grid(gm.page, a.actorId, ids.Backpack).locator(`.attache-tile[data-item-id="${ids.Dagger}"]`)).toBeVisible();
    await root.locator(`.attache-panel-menu[data-container-id="${ids.Backpack}"]`).click();
    await clickMenu(gm.page, "Remove Container");
    await gm.page.locator(".application.dialog button[data-action=yes], .application.dialog button[data-action=ok]").first().click();
    await expect.poll(() => itemCount(gm.page, a.actorId)).toBe(4);
    await expect(grid(gm.page, a.actorId, "body").locator(`.attache-tile[data-item-id="${ids.Dagger}"]`)).toBeVisible();
    expect((await read(gm.page, a.actorId, ids.Dagger)).container).toBeNull();
    expect((await read(gm.page, a.actorId, ids.Pouch)).container).toBeNull();
    expect((await read(gm.page, a.actorId, ids.Rope)).container).toBe(ids.Pouch);
    await expect(grid(gm.page, a.actorId, ids.Pouch).locator(`.attache-tile[data-item-id="${ids.Rope}"]`)).toBeVisible();
    await closeAll(gm.page);

    // The sheet's delete button, its dialog, default choice. Done by the Player: contents become loose.
    const b = await makeActor(gm.page, { name: "QA Sync 07b" });
    const bags = await addFromPack(gm.page, b.actorId, ["Backpack", "Dagger", "Rope"]);
    await gm.page.evaluate(({ a, ids }) => game.actors.get(a).updateEmbeddedDocuments("Item", [
      { _id: ids.Dagger, "system.container": ids.Backpack }, { _id: ids.Rope, "system.container": ids.Backpack }
    ]), { a: b.actorId, ids: bags });
    await openCase(pl.page, b.actorId);
    await placeCase(pl.page, b.actorId, { left: 10, top: 10, width: 760 });
    await expect(grid(pl.page, b.actorId, bags.Backpack).locator(".attache-tile")).toHaveCount(2);
    const sheet = await openSheet(pl.page, b.actorId);
    await clearCount(pl);
    await clearCount(gm);
    await sheet.locator(`li.container[data-item-id="${bags.Backpack}"]`).click({ button: "right" });
    await clickMenu(pl.page, "Delete");
    await pl.page.locator(".application.dialog button[data-action=yes]").click();
    await expect.poll(() => itemCount(pl.page, b.actorId)).toBe(2);
    await expect(grid(pl.page, b.actorId, "body").locator(`.attache-tile[data-item-id="${bags.Dagger}"]`)).toBeVisible();
    await expect(grid(pl.page, b.actorId, "body").locator(`.attache-tile[data-item-id="${bags.Rope}"]`)).toBeVisible();
    expect((await read(pl.page, b.actorId, bags.Dagger)).container, "dnd5e leaves the id; it counts as loose").toBe(bags.Backpack);
    await pl.page.waitForTimeout(300);
    expect((await counted(gm)).every((u) => u.userId === playerId), "repacked by the writing client").toBe(true);

    // The same dialog with "delete contents": nothing left, and no write of ours raced it.
    const c = await makeActor(gm.page, { name: "QA Sync 07c" });
    const doomed = await addFromPack(gm.page, c.actorId, ["Backpack", "Dagger"]);
    await gm.page.evaluate(({ a, ids }) => game.actors.get(a).items.get(ids.Dagger).update({ "system.container": ids.Backpack }), { a: c.actorId, ids: doomed });
    await closeAll(pl.page);
    await openCase(pl.page, c.actorId);
    await placeCase(pl.page, c.actorId, { left: 10, top: 10, width: 760 });
    const sheet2 = await openSheet(pl.page, c.actorId);
    await clearCount(pl);
    await sheet2.locator(`li.container[data-item-id="${doomed.Backpack}"]`).click({ button: "right" });
    await clickMenu(pl.page, "Delete");
    await pl.page.locator(".application.dialog input[name=deleteContents]").check();
    await pl.page.locator(".application.dialog button[data-action=yes]").click();
    await expect.poll(() => itemCount(pl.page, c.actorId)).toBe(0);
    await pl.page.waitForTimeout(300);
    expect(await counted(pl)).toEqual([]);
  });

  test("08 Worn: wearing changes AC, taking off restores it, the sheet's equip moves the tile; Tinderbox and weapons stay; contained armor is not Worn", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 08" });
    const ids = await addFromPack(gm.page, actorId, ["Chain Mail", "Longsword", "Tinderbox", "Backpack"]);
    const page = pl.page;
    await openCase(page, actorId);
    await placeCase(page, actorId, { left: 10, top: 10, width: 760, height: 900 });
    await openCase(gm.page, actorId);
    const base = await ac(page, actorId);
    await expect(tile(page, actorId, ids["Chain Mail"])).toBeVisible();

    // Wear by dragging to the strip.
    await clearCount(gm);
    await clearCount(pl);
    await pointerDrag(page, await tilePoint(page, actorId, ids["Chain Mail"]), await zonePoint(page, actorId, "worn"));
    await expect.poll(() => ac(page, actorId)).toBe(16);
    expect(base).toBeLessThan(16);
    await expect(worn(page, actorId, ids["Chain Mail"])).toBeVisible();
    await expect(worn(gm.page, actorId, ids["Chain Mail"])).toBeVisible();
    await expect(tile(page, actorId, ids["Chain Mail"])).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await counted(pl)).toHaveLength(1);
    expect(await counted(gm)).toHaveLength(1);
    expect((await read(page, actorId, ids["Chain Mail"])).pos).toBeUndefined();
    for (const scheme of ["light", "dark"]) {
      await setScheme(page, scheme);
      await screenshot(page, `${WORLD}-m4-worn-${scheme}`);
    }

    // Take off through the menu: back to the grid and to the old AC.
    await worn(page, actorId, ids["Chain Mail"]).click({ button: "right" });
    await clickMenu(page, "Take Off");
    await expect.poll(() => ac(page, actorId)).toBe(base);
    await expect(tile(page, actorId, ids["Chain Mail"])).toBeVisible();

    // Equip on the real sheet: the tile moves to Worn, nothing else is written.
    const sheet = await openSheet(page, actorId);
    await clearCount(pl);
    await sheet.locator(`[data-item-id="${ids["Chain Mail"]}"] [data-action="equip"]`).click();
    await expect(worn(page, actorId, ids["Chain Mail"])).toBeVisible();
    await expect(worn(gm.page, actorId, ids["Chain Mail"])).toBeVisible();
    await expect.poll(() => ac(page, actorId)).toBe(16);
    await page.waitForTimeout(300);
    expect((await counted(pl)).filter((u) => u.synced), "going true only shows").toEqual([]);

    // Unequip on the real sheet: back at its stale place.
    const stale = (await read(page, actorId, ids["Chain Mail"])).pos;
    await sheet.locator(`[data-item-id="${ids["Chain Mail"]}"] [data-action="equip"]`).click();
    await expect(tile(page, actorId, ids["Chain Mail"])).toBeVisible();
    expect((await layout(page, actorId)).placed[ids["Chain Mail"]]).toMatchObject({ c: stale.c, x: stale.x, y: stale.y });
    await expect.poll(() => ac(page, actorId)).toBe(base);

    // A real equipped sword and Tinderbox stay in the grid.
    await sheet.locator(`[data-item-id="${ids.Longsword}"] [data-action="equip"]`).click();
    await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ "system.equipped": true }), { a: actorId, i: ids.Tinderbox });
    await expect.poll(async () => (await read(page, actorId, ids.Longsword)).equipped).toBe(true);
    await expect.poll(async () => (await read(page, actorId, ids.Tinderbox)).equipped).toBe(true);
    await page.waitForTimeout(300);
    await expect(tile(page, actorId, ids.Longsword)).toBeVisible();
    await expect(tile(page, actorId, ids.Tinderbox)).toBeVisible();
    expect((await layout(page, actorId)).worn).toEqual([]);

    // Armor equipped and in a bag: a tile in the bag, not Worn; AC counts it, as dnd5e does, and we leave it alone.
    await gm.page.evaluate(({ a, i, b }) => game.actors.get(a).items.get(i).update({ "system.equipped": true, "system.container": b }), { a: actorId, i: ids["Chain Mail"], b: ids.Backpack });
    await expect(grid(page, actorId, ids.Backpack).locator(`.attache-tile[data-item-id="${ids["Chain Mail"]}"]`)).toBeVisible();
    await expect(worn(page, actorId, ids["Chain Mail"])).toHaveCount(0);
    expect((await read(page, actorId, ids["Chain Mail"])).equipped).toBe(true);
    // Dragged out, it unequips rather than jumping to Worn.
    await pointerDrag(page, await tilePoint(page, actorId, ids["Chain Mail"]), await cellPoint(page, actorId, "body", 0, 0));
    await expect.poll(async () => (await read(page, actorId, ids["Chain Mail"])).equipped).toBe(false);
    await expect(worn(page, actorId, ids["Chain Mail"])).toHaveCount(0);
    expect((await read(page, actorId, ids["Chain Mail"])).container).toBeNull();
    await expect(tile(page, actorId, ids["Chain Mail"])).toBeVisible();
    await setScheme(page, "dark");
  });

  test("09 gives: clear container, equipped and attuned; a Waterskin brings its Water; owned and GM-relayed", async () => {
    const page = pl.page;
    const src = await makeActor(gm.page, { name: "QA Sync 09 Giver" });
    const mine = await makeActor(gm.page, { name: "QA Sync 09 Mine" });
    const theirs = await makeActor(gm.page, { name: "QA Sync 09 Theirs", owner: "Player2" });
    const ids = await addFromPack(gm.page, src.actorId, ["Backpack", "Longsword", "Shortsword", "Waterskin"]);
    // A real Waterskin with its Water, as a compendium pack ships it: through the case's own drop.
    await gm.page.evaluate(async ({ a, ids }) => {
      await game.actors.get(a).updateEmbeddedDocuments("Item", [
        { _id: ids.Longsword, "system.container": ids.Backpack, "system.equipped": true, "system.attuned": true }
      ]);
      await game.actors.get(a).items.get(ids.Waterskin).delete();
    }, { a: src.actorId, ids });
    const skinId = await dropFilledWaterskin(gm.page, src.actorId);
    await expect.poll(() => itemCount(gm.page, src.actorId)).toBe(5);

    const root = await openCase(page, src.actorId);
    const give = async (itemId, targetName) => {
      await root.locator(`.attache-tile[data-item-id="${itemId}"]`).click({ button: "right" });
      await clickMenu(page, "Give");
      const dialog = page.locator(".application.attache-give");
      await dialog.locator(".attache-give-option", { hasText: targetName }).click();
      await dialog.locator("button[data-action=give]").click();
    };

    // From inside a bag, equipped and attuned, to an actor the Player owns.
    await expect(grid(page, src.actorId, ids.Backpack).locator(`.attache-tile[data-item-id="${ids.Longsword}"]`)).toBeVisible();
    await give(ids.Longsword, "QA Sync 09 Mine");
    await expect.poll(() => byName(page, mine.actorId, "Longsword")).toBeTruthy();
    const given = await read(page, mine.actorId, await byName(page, mine.actorId, "Longsword"));
    expect(given.container).toBeNull();
    expect(given.equipped).toBe(false);
    expect(given.attuned).toBe(false);
    expect(await read(page, src.actorId, ids.Longsword)).toBeNull();
    expect((await layout(page, mine.actorId)).placed[await byName(page, mine.actorId, "Longsword")]).toMatchObject({ c: "body" });

    // The Waterskin with its Water: both move, nothing stays, nothing is doubled.
    await give(skinId, "QA Sync 09 Mine");
    await expect.poll(() => byName(page, mine.actorId, "Waterskin")).toBeTruthy();
    await expect.poll(() => page.evaluate((id) => game.actors.get(id).items.filter((i) => /water/i.test(i.name)).map((i) => i.name).sort(), src.actorId)).toEqual([]);
    const moved = await page.evaluate((id) => {
      const actor = game.actors.get(id);
      const skin = actor.items.find((i) => i.name === "Waterskin");
      return { size: skin.system.contents.size, names: [...skin.system.contents.values()].map((i) => i.name), total: actor.items.filter((i) => /water/i.test(i.name)).length, skin: skin.id, held: [...skin.system.contents.keys()] };
    }, mine.actorId);
    expect(moved.size).toBe(1);
    expect(moved.total, "receiver: one skin, one water").toBe(2);
    expect((await layout(page, mine.actorId)).placed[moved.skin]).toBeTruthy();
    expect((await layout(page, mine.actorId)).held).toEqual(moved.held);

    // Relayed through the GM: the same.
    await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ "system.equipped": true, "system.attuned": true }), { a: src.actorId, i: ids.Shortsword });
    await give(ids.Shortsword, "QA Sync 09 Theirs");
    await expect.poll(() => byName(gm.page, theirs.actorId, "Shortsword")).toBeTruthy();
    const relayed = await read(gm.page, theirs.actorId, await byName(gm.page, theirs.actorId, "Shortsword"));
    expect(relayed.container).toBeNull();
    expect(relayed.equipped).toBe(false);
    expect(relayed.attuned).toBe(false);
    await expect.poll(() => read(page, src.actorId, ids.Shortsword)).toBeNull();

    // A relayed holder brings its contents too, computed on the GM's client.
    const relayedSkin = await dropFilledWaterskin(gm.page, src.actorId);
    await expect(root.locator(`.attache-tile[data-item-id="${relayedSkin}"]`)).toBeVisible();
    await give(relayedSkin, "QA Sync 09 Theirs");
    await expect.poll(() => byName(gm.page, theirs.actorId, "Waterskin")).toBeTruthy();
    const onTheirs = await gm.page.evaluate((id) => {
      const actor = game.actors.get(id);
      const skin = actor.items.find((i) => i.name === "Waterskin");
      return { held: [...skin.system.contents.keys()], water: actor.items.filter((i) => /water/i.test(i.name)).length };
    }, theirs.actorId);
    expect(onTheirs.held).toHaveLength(1);
    expect(onTheirs.water).toBe(2);
    await expect.poll(() => read(page, src.actorId, relayedSkin)).toBeNull();
    expect(await page.evaluate((id) => game.actors.get(id).items.filter((i) => /water/i.test(i.name)).length, src.actorId), "the giver has none left").toBe(0);
  });

  test("10 give from an npc uses asGear, art survives; art survives a give through a bag; rollback deletes all created ids", async () => {
    const page = pl.page;
    const art = "icons/svg/sword.svg";
    const npc = await makeActor(gm.page, { name: "QA Sync 10 Bandit", actorType: "npc" });
    const mine = await makeActor(gm.page, { name: "QA Sync 10 Mine" });
    const loot = await addFromPack(gm.page, npc.actorId, ["Longsword"]);
    await gm.page.evaluate(({ a, i, art }) => game.actors.get(a).items.get(i).setFlag("attache-case", "art", art), { a: npc.actorId, i: loot.Longsword, art });
    expect(await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).system.properties.has("gear"), { a: npc.actorId, i: loot.Longsword })).toBe(true);

    const root = await openCase(page, npc.actorId);
    await root.locator(`.attache-tile[data-item-id="${loot.Longsword}"]`).click({ button: "right" });
    await clickMenu(page, "Give");
    await page.locator(".application.attache-give .attache-give-option", { hasText: "QA Sync 10 Mine" }).click();
    await page.locator(".application.attache-give button[data-action=give]").click();
    await expect.poll(() => byName(page, mine.actorId, "Longsword")).toBeTruthy();
    const gear = await read(page, mine.actorId, await byName(page, mine.actorId, "Longsword"));
    expect(gear.gearSource, "asGear ran").toBe(`Actor.${npc.actorId}.Item.${loot.Longsword}`);
    expect(gear.art).toBe(art);
    expect(gear.equipped).toBe(false);
    await expect.poll(() => read(page, npc.actorId, loot.Longsword)).toBeNull();
    await closeAll(page);

    // An item with no compendium to go back to is cloned as it is: its pos stays behind, on the sheet's route as well.
    const potion = await addFromPack(gm.page, npc.actorId, ["Potion of Healing"]);
    const clone = await gm.page.evaluate(async ({ a, i, art }) => {
      const item = game.actors.get(a).items.get(i);
      await item.setFlag("attache-case", "art", art);
      const gear = await item.system.asGear();
      return { hadPos: Boolean(item.flags["attache-case"].pos), flags: gear.flags["attache-case"], source: gear.flags.dnd5e?.gearSource };
    }, { a: npc.actorId, i: potion["Potion of Healing"], art });
    expect(clone.hadPos).toBe(true);
    expect(clone.source).toBeTruthy();
    expect(clone.flags.art).toBe(art);
    expect(clone.flags.pos).toBeUndefined();

    // Relayed through the GM, to an actor the Player does not own.
    const theirs = await makeActor(gm.page, { name: "QA Sync 10 Theirs", owner: "Player2" });
    const blade = await addFromPack(gm.page, npc.actorId, ["Shortsword"]);
    await gm.page.evaluate(({ a, i, art }) => game.actors.get(a).items.get(i).setFlag("attache-case", "art", art), { a: npc.actorId, i: blade.Shortsword, art });
    const relay = await openCase(page, npc.actorId);
    await relay.locator(`.attache-tile[data-item-id="${blade.Shortsword}"]`).click({ button: "right" });
    await clickMenu(page, "Give");
    await page.locator(".application.attache-give .attache-give-option", { hasText: "QA Sync 10 Theirs" }).click();
    await page.locator(".application.attache-give button[data-action=give]").click();
    await expect.poll(() => byName(gm.page, theirs.actorId, "Shortsword")).toBeTruthy();
    const relayed = await read(gm.page, theirs.actorId, await byName(gm.page, theirs.actorId, "Shortsword"));
    expect(relayed.gearSource, "asGear ran on the GM's client").toBe(`Actor.${npc.actorId}.Item.${blade.Shortsword}`);
    expect(relayed.art).toBe(art);
    await expect.poll(() => read(page, npc.actorId, blade.Shortsword)).toBeNull();
    await closeAll(page);

    // Art through a bag: cross-window drag from a bag of one actor onto a cell of a bag of another.
    const a = await makeActor(gm.page, { name: "QA Sync 10 A" });
    const b = await makeActor(gm.page, { name: "QA Sync 10 B" });
    const on = await addFromPack(gm.page, a.actorId, ["Backpack", "Dagger"]);
    const target = await addFromPack(gm.page, b.actorId, ["Sack"]);
    await gm.page.evaluate(({ a, ids, art }) => game.actors.get(a).items.get(ids.Dagger).update({ "system.container": ids.Backpack, "flags.attache-case.art": art }), { a: a.actorId, ids: on, art });
    await page.waitForTimeout(300);
    await openCase(page, a.actorId);
    await openCase(page, b.actorId);
    await placeCase(page, a.actorId, { left: 10, top: 10, width: 770, height: 900 });
    await placeCase(page, b.actorId, { left: 800, top: 10, width: 770, height: 900 });
    await pointerDrag(page, await tilePoint(page, a.actorId, on.Dagger), await cellPoint(page, b.actorId, target.Sack, 2, 1));
    await expect.poll(() => byName(page, b.actorId, "Dagger")).toBeTruthy();
    const landed = await read(page, b.actorId, await byName(page, b.actorId, "Dagger"));
    expect(landed.container).toBe(target.Sack);
    expect(landed.pos).toEqual({ c: target.Sack, x: 2, y: 1, r: false });
    expect(landed.art).toBe(art);
    await expect.poll(() => read(page, a.actorId, on.Dagger)).toBeNull();
    await closeAll(page);

    // Rollback: the source refuses its delete. Everything created on the target goes again.
    const src = await makeActor(gm.page, { name: "QA Sync 10 Refuser" });
    const dst = await makeActor(gm.page, { name: "QA Sync 10 Receiver" });
    const service = "/modules/attache-case/scripts/foundry/inventory.mjs";
    const waterskin = await dropFilledWaterskin(gm.page, src.actorId);
    await expect.poll(() => itemCount(page, src.actorId)).toBe(2);
    const outcome = await page.evaluate(async ({ src, dst, id, service }) => {
      const giver = game.actors.get(src);
      const receiver = game.actors.get(dst);
      const created = [];
      const hook = Hooks.on("createItem", (item) => { if (item.parent === receiver) created.push(item.id); });
      const original = giver.deleteEmbeddedDocuments;
      giver.deleteEmbeddedDocuments = async () => { throw new Error("refused for this test"); };
      const { transferItem } = await import(service);
      const silenced = console.error;
      console.error = () => {};
      let result;
      try {
        result = await transferItem(giver.items.get(id), receiver);
      } finally {
        console.error = silenced;
        giver.deleteEmbeddedDocuments = original;
        Hooks.off("createItem", hook);
      }
      return { result, created, left: [...receiver.items.keys()] };
    }, { src: src.actorId, dst: dst.actorId, id: waterskin, service });
    expect(outcome.result).toBe(false);
    expect(outcome.created, "the skin and its water were really created").toHaveLength(2);
    await expect.poll(() => itemCount(page, dst.actorId), "every created id deleted").toBe(0);
    expect(await itemCount(page, src.actorId), "the source keeps both").toBe(2);
    await expect(page.locator("#notifications .notification", { hasText: "Could not give" }).first()).toBeVisible();
  });

  test("11 a refused cycle changes nothing and warns; autoArrange, Place Unstowed and rotate keep sheet and case in step", async () => {
    const page = pl.page;
    // A Sack the GM says is no bag is a tile, holding a Pouch with a panel of its own.
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 11" });
    const ids = await addFromPack(gm.page, actorId, ["Sack", "Pouch", "Backpack", "Dagger", "Rope"]);
    await gm.page.evaluate(async ({ a, ids }) => {
      await game.actors.get(a).items.get(ids.Sack).setFlag("attache-case", "container", false);
      await game.actors.get(a).items.get(ids.Pouch).update({ "system.container": ids.Sack });
      await game.actors.get(a).items.get(ids.Dagger).update({ "system.container": ids.Backpack });
    }, { a: actorId, ids });
    await page.waitForTimeout(500);
    await openCase(page, actorId);
    await expect(tile(page, actorId, ids.Sack)).toBeVisible();
    await expect(grid(page, actorId, ids.Pouch)).toBeVisible();
    await clearCount(pl);
    await clearNotifications(page);
    await pointerDrag(page, await tilePoint(page, actorId, ids.Sack), await cellPoint(page, actorId, ids.Pouch, 0, 0));
    await expect(page.locator("#notifications .notification.warning", { hasText: "cannot go inside" })).toBeVisible();
    await expect(page.locator("#notifications .notification", { hasText: "does not fit" })).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await counted(pl)).toEqual([]);
    expect((await read(page, actorId, ids.Sack)).container).toBeNull();
    await expect(tile(page, actorId, ids.Sack)).toBeVisible();

    // Auto-arrange: contents in their bag, loose out of it, no native key written.
    const nativeBefore = await page.evaluate((id) => game.actors.get(id).items.map((i) => [i.id, i.system.container, i.system.equipped]), actorId);
    await clearCount(pl);
    await page.locator(`${caseSel(actorId)} [data-action=autoArrange]`).click();
    await page.waitForTimeout(500);
    expect((await counted(pl)).flatMap((u) => u.keys).filter((k) => k.startsWith("system."))).toEqual([]);
    expect(await page.evaluate((id) => game.actors.get(id).items.map((i) => [i.id, i.system.container, i.system.equipped]), actorId)).toEqual(nativeBefore);
    expect((await layout(page, actorId)).placed[ids.Dagger].c).toBe(ids.Backpack);
    expect((await layout(page, actorId)).placed[ids.Rope].c).toBe("body");

    // Rotate in a bag: pos only.
    await clearCount(pl);
    const p = await tilePoint(page, actorId, ids.Dagger);
    await page.mouse.move(p.x, p.y);
    await page.keyboard.press("KeyR");
    await expect.poll(async () => (await read(page, actorId, ids.Dagger)).pos?.r).toBe(true);
    await page.waitForTimeout(300);
    expect((await counted(pl)).flatMap((u) => u.keys).filter((k) => k.startsWith("system."))).toEqual([]);

    // Stow takes it out of the bag; it stays until the user clicks; Place Unstowed with a full body may use the bag.
    await tile(page, actorId, ids.Dagger).click({ button: "right" });
    await clickMenu(page, "Stow");
    await expect(unstowed(page, actorId, ids.Dagger)).toBeVisible();
    expect((await read(page, actorId, ids.Dagger)).container).toBeNull();
    await page.waitForTimeout(300);
    await expect(unstowed(page, actorId, ids.Dagger)).toBeVisible();
    await gm.page.evaluate((id) => game.actors.get(id).setFlag("attache-case", "body", { cols: 0, rows: 0 }), actorId);
    await page.locator(`${caseSel(actorId)} [data-action=packUnstowed]`).click();
    await expect.poll(async () => (await read(page, actorId, ids.Dagger)).container).not.toBeNull();
    expect((await read(page, actorId, ids.Dagger)).pos.c).toBe((await read(page, actorId, ids.Dagger)).container);
  });

  test("12 A7 and A11: the size dialog on an auto bag; container:false takes tiles away and the sheet keeps them; a stack and a rename change nothing", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 12" });
    const ids = await addFromPack(gm.page, actorId, ["Backpack", "Dagger", "Arrows"]);
    await gm.page.evaluate(({ a, ids }) => game.actors.get(a).items.get(ids.Dagger).update({ "system.container": ids.Backpack }), { a: actorId, ids });
    const page = gm.page;
    const root = await openCase(page, actorId);
    await expect(root.locator(`.attache-grid[data-container-id="${ids.Backpack}"]`)).toBeVisible();

    const openDialog = async () => {
      await page.evaluate(async ({ a, i }) => {
        const { ItemSizeConfig } = await import("/modules/attache-case/scripts/apps/item-size-config.mjs");
        ItemSizeConfig.open(game.actors.get(a).items.get(i));
      }, { a: actorId, i: ids.Backpack });
      const dialog = page.locator(".application.attache-size-config");
      await expect(dialog).toBeVisible();
      return dialog;
    };
    // Auto: shows its grid, Save leaves it automatic.
    let dialog = await openDialog();
    await expect(dialog.locator("input[name=isContainer]")).toBeChecked();
    await expect(dialog.locator("input[name=cols]")).toHaveValue("8");
    await expect(dialog.locator("input[name=rows]")).toHaveValue("6");
    await expect(dialog.locator(".attache-container-auto")).toContainText(/8\D+6/);
    await dialog.locator("button[type=submit]").click();
    await expect(dialog).toHaveCount(0);
    const flag = () => page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).flags["attache-case"]?.container ?? null, { a: actorId, i: ids.Backpack });
    expect(await flag()).toBeNull();

    // Custom dims.
    dialog = await openDialog();
    await dialog.locator("input[name=cols]").fill("5");
    await dialog.locator("button[type=submit]").click();
    await expect(dialog).toHaveCount(0);
    expect(await flag()).toEqual({ cols: 5, rows: 6 });
    await expect(root.locator(`.attache-panel`).filter({ has: page.locator(`.attache-grid[data-container-id="${ids.Backpack}"]`) })).toHaveAttribute("style", /--cols: 5/);

    // Back to automatic through Reset, then off.
    dialog = await openDialog();
    await dialog.locator("button[data-action=resetContainer]").click();
    await dialog.locator("button[type=submit]").click();
    await expect(dialog).toHaveCount(0);
    expect(await flag()).toBeNull();

    dialog = await openDialog();
    await dialog.locator("input[name=isContainer]").uncheck();
    await dialog.locator("button[type=submit]").click();
    await expect(dialog).toHaveCount(0);
    expect(await flag()).toBe(false);
    // The bag is a tile now, its child has none and is still on the sheet.
    await expect(root.locator(`.attache-grid[data-container-id="${ids.Backpack}"]`)).toHaveCount(0);
    await expect(tile(page, actorId, ids.Backpack)).toBeVisible();
    // Not a bag, it takes the space a Backpack takes when carried.
    await expect.poll(async () => (await layout(page, actorId)).placed[ids.Backpack]).toMatchObject({ w: 4, h: 4 });
    await expect(tile(page, actorId, ids.Dagger)).toHaveCount(0);
    await expect(chip(page, actorId, ids.Dagger)).toHaveCount(0);
    expect((await read(page, actorId, ids.Dagger)).container).toBe(ids.Backpack);
    expect(await page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).system.contents.size, { a: actorId, i: ids.Backpack })).toBe(1);

    // And on again: everything returns where it was.
    const dagger = (await read(page, actorId, ids.Dagger)).pos;
    dialog = await openDialog();
    await dialog.locator("input[name=isContainer]").check();
    await dialog.locator("button[type=submit]").click();
    await expect(dialog).toHaveCount(0);
    await expect(root.locator(`.attache-grid[data-container-id="${ids.Backpack}"] .attache-tile[data-item-id="${ids.Dagger}"]`)).toBeVisible();
    expect((await read(page, actorId, ids.Dagger)).pos).toEqual(dagger);

    // A stack and renames.
    const before = await layout(page, actorId);
    await page.evaluate(({ a, ids }) => game.actors.get(a).updateEmbeddedDocuments("Item", [
      { _id: ids.Arrows, "system.quantity": 60, name: "Flechas" }, { _id: ids.Dagger, name: "Backpack" }, { _id: ids.Backpack, name: "Frasco" }
    ]), { a: actorId, ids });
    await page.waitForTimeout(400);
    const after = await layout(page, actorId);
    expect(after.placed).toEqual(before.placed);
    expect(after.containers.map((c) => [c.id, c.cols, c.rows])).toEqual(before.containers.map((c) => [c.id, c.cols, c.rows]));
  });

  test("14 D-008: nothing automatic puts a loose item in a bag: a full body, a new bag, the first opening", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 14", body: { cols: 1, rows: 1 } });
    const ids = await addFromPack(gm.page, actorId, ["Backpack", "Longsword"]);
    await gm.page.waitForTimeout(400);
    const loose = async (id) => {
      const item = await read(gm.page, actorId, id);
      expect(item.container, "the sheet still has it loose").toBeNull();
      expect(item.pos, "and no pos points at the bag").toBeUndefined();
      expect((await layout(gm.page, actorId)).overflow).toContain(id);
    };
    await loose(ids.Longsword);
    const later = await addFromPack(gm.page, actorId, ["Dagger"]);
    await gm.page.waitForTimeout(400);
    await loose(later.Dagger);
    // A pos copied from another actor, with no spot: the flag goes, so a later opening tries again.
    const copied = await gm.page.evaluate(async (a) => {
      const flags = { "attache-case": { pos: { c: "body", x: 0, y: 0, r: false }, size: { w: 1, h: 1 } } };
      await game.actors.get(a).createEmbeddedDocuments("Item", [{ name: "Filler", type: "loot", flags }], { "attache-case": { placed: true } });
      const [made] = await game.actors.get(a).createEmbeddedDocuments("Item", [{ name: "Copied", type: "loot", flags }]);
      return made.id;
    }, actorId);
    await gm.page.waitForTimeout(300);
    expect((await read(gm.page, actorId, copied)).pos, "no null, no stale request").toBeUndefined();
    expect((await layout(gm.page, actorId)).overflow).toContain(copied);
    const sack = await addFromPack(gm.page, actorId, ["Sack"]);
    await gm.page.waitForTimeout(400);
    await loose(ids.Longsword);
    await openCase(pl.page, actorId);
    await pl.page.waitForTimeout(400);
    await loose(ids.Longsword);
    await expect(unstowed(pl.page, actorId, ids.Longsword)).toBeVisible();
    await expect(grid(pl.page, actorId, ids.Backpack).locator(".attache-tile")).toHaveCount(0);
    // The user's click may.
    await pl.page.locator(`${caseSel(actorId)} [data-action=packUnstowed]`).click();
    await expect.poll(async () => (await read(pl.page, actorId, ids.Longsword)).container).not.toBeNull();
    const placed = await read(pl.page, actorId, ids.Longsword);
    expect([ids.Backpack, sack.Sack]).toContain(placed.container);
    expect(placed.pos.c).toBe(placed.container);
  });

  test("15 a filled bag dropped on and given to an npc: its armor stays unequipped, AC unchanged", async () => {
    const page = pl.page;
    const npc = await makeActor(gm.page, { name: "QA Sync 15 Bandit", actorType: "npc" });
    const src = await makeActor(gm.page, { name: "QA Sync 15 Giver" });
    const ids = await addFromPack(gm.page, src.actorId, ["Backpack", "Sack", "Plate Armor", "Chain Mail"]);
    await gm.page.evaluate(async ({ a, ids }) => {
      const actor = game.actors.get(a);
      await actor.items.get(ids.Sack).setFlag("attache-case", "container", false);
      await actor.updateEmbeddedDocuments("Item", [
        { _id: ids["Plate Armor"], "system.container": ids.Backpack }, { _id: ids["Chain Mail"], "system.container": ids.Sack }
      ]);
    }, { a: src.actorId, ids });
    await page.waitForTimeout(300);
    const base = await ac(page, npc.actorId);

    // A drop of the bag.
    await page.evaluate(async ({ a, b, i }) => {
      const { addFromDrop } = await import("/modules/attache-case/scripts/foundry/inventory.mjs");
      await addFromDrop(game.actors.get(b), { type: "Item", uuid: game.actors.get(a).items.get(i).uuid }, { kind: "auto" });
    }, { a: src.actorId, b: npc.actorId, i: ids.Backpack });
    await expect.poll(() => byName(page, npc.actorId, "Plate Armor")).toBeTruthy();
    expect((await read(page, npc.actorId, await byName(page, npc.actorId, "Plate Armor"))).equipped).toBe(false);
    expect(await ac(page, npc.actorId), "after the drop").toBe(base);

    // A give of the holder, through the menu.
    const root = await openCase(page, src.actorId);
    await root.locator(`.attache-tile[data-item-id="${ids.Sack}"]`).click({ button: "right" });
    await clickMenu(page, "Give");
    await page.locator(".application.attache-give .attache-give-option", { hasText: "QA Sync 15 Bandit" }).click();
    await page.locator(".application.attache-give button[data-action=give]").click();
    await expect.poll(() => byName(page, npc.actorId, "Chain Mail")).toBeTruthy();
    expect((await read(page, npc.actorId, await byName(page, npc.actorId, "Chain Mail"))).equipped).toBe(false);
    expect(await ac(page, npc.actorId), "after the give").toBe(base);
  });

  test("16 a give that would lose what lies below dnd5e's depth limit moves nothing", async () => {
    const page = pl.page;
    const src = await makeActor(gm.page, { name: "QA Sync 16 Giver" });
    const dst = await makeActor(gm.page, { name: "QA Sync 16 Receiver" });
    await gm.page.evaluate(async (a) => {
      const actor = game.actors.get(a);
      let parent = null;
      for (let i = 0; i < 8; i++) {
        const [bag] = await actor.createEmbeddedDocuments("Item", [{ name: `Sack${i}`, type: "container", system: { container: parent, capacity: { weight: { value: 30, units: "lb" } } }, flags: i ? {} : { "attache-case": { container: false, size: { w: 1, h: 1 } } } }]);
        parent = bag.id;
      }
      await actor.createEmbeddedDocuments("Item", [{ name: "Dagger", type: "weapon", system: { container: parent } }]);
    }, src.actorId);
    await page.waitForTimeout(300);
    expect(await itemCount(page, src.actorId)).toBe(9);
    const sack = await byName(page, src.actorId, "Sack0");
    const root = await openCase(page, src.actorId);
    await clearNotifications(page);
    await root.locator(`.attache-tile[data-item-id="${sack}"]`).click({ button: "right" });
    await clickMenu(page, "Give");
    await page.locator(".application.attache-give .attache-give-option", { hasText: "QA Sync 16 Receiver" }).click();
    const silenced = page.evaluate(() => {
      globalThis.__error = console.error;
      console.error = () => {};
    });
    await silenced;
    await page.locator(".application.attache-give button[data-action=give]").click();
    await expect(page.locator("#notifications .notification", { hasText: "Could not give" }).first()).toBeVisible();
    await page.evaluate(() => { console.error = globalThis.__error; });
    await page.waitForTimeout(300);
    expect(await itemCount(page, dst.actorId), "nothing was created").toBe(0);
    expect(await itemCount(page, src.actorId), "nothing was lost").toBe(9);
  });

  test("17 six unmarked awaited updates, as a macro does: every tile its own cell, none left out", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 17" });
    const names = ["Dagger", "Rope", "Potion of Healing", "Torch", "Tinderbox", "Crowbar"];
    const ids = await addFromPack(gm.page, actorId, ["Backpack", ...names]);
    await gm.page.waitForTimeout(300);
    await pl.page.evaluate(async ({ a, list, bag }) => {
      const actor = game.actors.get(a);
      for (const id of list) await actor.items.get(id).update({ "system.container": bag });
    }, { a: actorId, list: names.map((n) => ids[n]), bag: ids.Backpack });
    await pl.page.waitForTimeout(800);
    const l = await layout(pl.page, actorId);
    expect(l.overflow, "nobody left out").toEqual([]);
    const cells = names.map((n) => l.placed[ids[n]]);
    for (const p of cells) expect(p.c).toBe(ids.Backpack);
    const taken = new Set();
    for (const p of cells) for (let x = p.x; x < p.x + p.w; x++) for (let y = p.y; y < p.y + p.h; y++) taken.add(`${x},${y}`);
    expect(taken.size, "no overlap").toBe(cells.reduce((sum, p) => sum + p.w * p.h, 0));
  });

  test("18 a real drop on a full body's cell stays out of the bag", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 18", body: { cols: 1, rows: 1 } });
    const ids = await addFromPack(gm.page, actorId, ["Backpack", "Potion of Healing"]);
    const page = pl.page;
    await openCase(page, actorId);
    await placeCase(page, actorId, { left: 10, top: 10 });
    const entryId = await page.evaluate(async (pack) => (await game.packs.get(pack).getIndex()).find((e) => e.name === "Dagger")._id, PACK);
    await page.evaluate((pack) => game.packs.get(pack).render({ force: true }), PACK);
    const id = `Compendium-${PACK.replaceAll(".", "_")}`;
    await expect(page.locator(`[id="${id}"]`)).toBeVisible();
    await page.evaluate((id) => foundry.applications.instances.get(id).setPosition({ left: 1200, top: 300, width: 340, height: 500 }), id);
    await page.locator(`[id="${id}"] input[type=search]`).fill("Dagger");
    await page.waitForTimeout(800);
    await page.locator(`[id="${id}"] .directory-item[data-entry-id="${entryId}"]`).dragTo(grid(page, actorId, "body"), { timeout: 20_000 });
    await expect.poll(() => byName(page, actorId, "Dagger")).toBeTruthy();
    const dagger = await read(page, actorId, await byName(page, actorId, "Dagger"));
    expect(dagger.container).toBeNull();
    await expect(unstowed(page, actorId, await byName(page, actorId, "Dagger"))).toBeVisible();
    await expect(grid(page, actorId, ids.Backpack).locator(".attache-tile")).toHaveCount(0);
  });

  test("19 an unlinked token: opening its case forks nothing, and a rename on the base still reaches it", async () => {
    const page = gm.page;
    const { actorId, ids } = await worldCharacter(page, "QA Sync 19", [["Backpack"], ["Dagger", {}], ["Rope", { in: 0 }]]);
    const scene = await page.evaluate(async ({ actorId, flag }) => {
      const s = await Scene.create({ name: "QA Sync 19", flags: { [flag.scope]: { [flag.key]: true } } });
      const made = await s.createEmbeddedDocuments("Token", [
        { name: "T1", actorId, actorLink: false, x: 0, y: 0 }, { name: "T2", actorId, actorLink: false, x: 200, y: 0 }
      ]);
      return { id: s.id, t1: made[0].id, t2: made[1].id };
    }, { actorId, flag: QA_FLAG });
    try {
      const state = (t, item) => page.evaluate(({ s, t, item }) => {
        const token = game.scenes.get(s).tokens.get(t);
        const { actor } = token;
        return { managed: token.delta.items.manages(item), name: actor.items.get(item).name, pos: actor.items.get(item).flags["attache-case"]?.pos ?? null };
      }, { s: scene.id, t, item });
      const uuid = await page.evaluate(({ s, t }) => {
        const actor = game.scenes.get(s).tokens.get(t).actor;
        game.modules.get("attache-case").api.open(actor);
        return actor.uuid;
      }, { s: scene.id, t: scene.t1 });
      const root = page.locator(`.application.attache-case[data-actor-uuid="${uuid}"]`);
      await expect(root.locator(`.attache-tile[data-item-id="${ids.Dagger}"]`)).toBeVisible();
      await expect(root.locator(`.attache-grid[data-container-id="${ids.Backpack}"] .attache-tile[data-item-id="${ids.Rope}"]`)).toBeVisible();
      for (const item of [ids.Dagger, ids.Rope]) expect((await state(scene.t1, item)).managed, "not forked into the token").toBe(false);
      expect((await read(page, actorId, ids.Dagger)).pos?.c, "the base was set up").toBe("body");

      await page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ name: "Renamed On Base" }), { a: actorId, i: ids.Dagger });
      await page.waitForTimeout(300);
      expect((await state(scene.t1, ids.Dagger)).name, "T1 inherits").toBe("Renamed On Base");
      expect((await state(scene.t2, ids.Dagger)).name, "T2 inherits").toBe("Renamed On Base");
    } finally {
      await closeAll(page);
      await page.evaluate((id) => game.scenes.get(id).delete(), scene.id);
    }
  });

  test("20 take off with no room, the Worn setting off and on, no Worn on a vehicle", async () => {
    const page = pl.page;
    const { actorId, ids } = await worldCharacter(page === pl.page ? gm.page : page, "QA Sync 20", [["Chain Mail", { equipped: true }]]);
    await gm.page.evaluate((id) => game.actors.get(id).setFlag("attache-case", "body", { cols: 1, rows: 1 }), actorId);
    await openCase(page, actorId);
    const base = 10;
    await expect(worn(page, actorId, ids["Chain Mail"])).toBeVisible();
    expect(await ac(page, actorId)).toBe(16);
    await worn(page, actorId, ids["Chain Mail"]).click({ button: "right" });
    await clickMenu(page, "Take Off");
    await expect.poll(() => ac(page, actorId)).toBe(base);
    await expect(unstowed(page, actorId, ids["Chain Mail"])).toBeVisible();
    expect((await read(page, actorId, ids["Chain Mail"])).equipped).toBe(false);

    // Worn off: the strip goes, equipped armor is a tile and keeps its AC. On again: back in the strip.
    await gm.page.evaluate(({ a, i }) => game.actors.get(a).updateEmbeddedDocuments("Item", [{ _id: i, "system.equipped": true }]), { a: actorId, i: ids["Chain Mail"] });
    await expect(worn(page, actorId, ids["Chain Mail"])).toBeVisible();
    await gm.page.evaluate(() => game.settings.set("attache-case", "allowWorn", false));
    await expect(page.locator(`${caseSel(actorId)} .attache-worn`)).toHaveCount(0);
    await expect(unstowed(page, actorId, ids["Chain Mail"])).toBeVisible();
    expect(await ac(page, actorId), "dnd5e's equipped is untouched").toBe(16);
    await gm.page.evaluate(() => game.settings.set("attache-case", "allowWorn", true));
    await expect(worn(page, actorId, ids["Chain Mail"])).toBeVisible();

    // A vehicle: no strip, no Wear entry, and equipped armor is an ordinary tile.
    const cart = await makeActor(gm.page, { name: "QA Sync 20 Cart", actorType: "vehicle" });
    const carried = await addFromPack(gm.page, cart.actorId, ["Chain Mail"]);
    const root = await openCase(page, cart.actorId);
    await expect(root.locator(".attache-worn")).toHaveCount(0);
    await root.locator(`.attache-tile[data-item-id="${carried["Chain Mail"]}"]`).click({ button: "right" });
    await expect(page.locator("#context-menu .context-item").first()).toBeVisible();
    await expect(page.locator("#context-menu .context-item", { hasText: "Wear" })).toHaveCount(0);
    await page.mouse.click(5, 500);
    await expect(page.locator("#context-menu")).toHaveCount(0);
  });

  test("21 a pointer at a plain item: shown in Unstowed, and a user move repairs it", async () => {
    const page = pl.page;
    const { actorId } = await makeActor(gm.page, { name: "QA Sync 21" });
    const ids = await addFromPack(gm.page, actorId, ["Dagger", "Rope"]);
    const lost = (await page.evaluate(async ({ a, i, to }) => { await game.actors.get(a).items.get(i).update({ "system.container": to }); return i; }, { a: actorId, i: ids.Dagger, to: ids.Rope }));
    await openCase(page, actorId);
    const sheet = await openSheet(page, actorId);
    await expect(sheet.locator(`[data-item-id="${lost}"]`), "dnd5e hides it").toHaveCount(0);
    await placeCase(page, actorId, { left: 10, top: 10, width: 760 });
    await expect(unstowed(page, actorId, lost)).toBeVisible();
    await pointerDrag(page, await chipPoint(page, actorId, lost), await cellPoint(page, actorId, "body", 4, 3));
    await expect.poll(async () => (await read(page, actorId, lost)).container).toBeNull();
    await expect(tile(page, actorId, lost)).toBeVisible();
    await expect(sheet.locator(`[data-item-id="${lost}"]`).first(), "the sheet has it back").toBeVisible();
  });

  test("13 screenshots: bag panel and Worn, light and dark", async () => {
    const { actorId, ids } = await worldCharacter(gm.page, "QA Sync 13", [
      ["Backpack"], ["Rope", { in: 0 }], ["Tinderbox", { in: 0 }], ["Waterskin", { in: 0 }], ["Longsword", {}], ["Chain Mail", { equipped: true }], ["Shield", { equipped: true }], ["Fine Clothes", {}], ["Pouch", { in: 0 }]
    ]);
    await openCase(pl.page, actorId);
    await expect(grid(pl.page, actorId, ids.Backpack).locator(".attache-tile")).toHaveCount(3);
    await expect(worn(pl.page, actorId, ids["Chain Mail"])).toBeVisible();
    await expect(worn(pl.page, actorId, ids.Shield)).toBeVisible();
    await expect(grid(pl.page, actorId, ids.Pouch)).toBeVisible();
    await clearNotifications(pl.page);
    for (const scheme of ["light", "dark"]) {
      await setScheme(pl.page, scheme);
      await screenshot(pl.page, `${WORLD}-m4-bags-${scheme}`);
    }
    await setScheme(pl.page, "dark");
  });
});
