/**
 * dnd5e basics and sizing (PLAN M3), on the clean `attache-dnd5e` world, GM and Player, real mouse and
 * keyboard: opening, sizes of real compendium items, compendium drops, drag, rotate, gives, sheet entries,
 * refused actor types, the quantity badge and unidentified items. Native bag sync is M4: a bag's contents
 * show as loose tiles here. Fixtures carry `world.attacheQA` and are removed at the start of each run.
 */

import { test, expect } from "@playwright/test";
import { moduleErrors, screenshot, SEED_FLAG } from "./helpers.mjs";
import {
  session, resetWorld, makeActor, openCase, caseSel, closeAll, clickMenu, clearNotifications, QA_FLAG, setScheme,
  pointerDrag, tilePoint, cellPoint, chipPoint, itemFlags, waitForFlags, layout
} from "./qa.mjs";

const WORLD = "attache-dnd5e";
const ENTRY = "Attaché Case";
const PACK = "attache-case.containers-dnd5e";
const SYSTEM_PACK = "dnd5e.equipment24";

/** Create real compendium items on an actor through the normal path (auto-placement included). */
async function addFromPack(page, actorId, names, pack = SYSTEM_PACK) {
  return page.evaluate(async ({ actorId, names, pack }) => {
    const p = game.packs.get(pack);
    const index = await p.getIndex();
    const list = [];
    for (const name of names) {
      const entry = index.find((e) => e.name === name);
      if (!entry) throw new Error(`no ${name} in ${pack}`);
      list.push(game.items.fromCompendium(await p.getDocument(entry._id)));
    }
    const created = await game.actors.get(actorId).createEmbeddedDocuments("Item", list);
    return Object.fromEntries(created.map((d) => [d.name, d.id]));
  }, { actorId, names, pack });
}

/** Raw items on an actor, placed by the normal path. */
async function addItems(page, actorId, items) {
  return page.evaluate(async ({ actorId, items }) => {
    const created = await game.actors.get(actorId).createEmbeddedDocuments("Item", items);
    return Object.fromEntries(created.map((d) => [d._source.name, d.id]));
  }, { actorId, items });
}

const tile = (page, actorId, itemId) => page.locator(`${caseSel(actorId)} .attache-tile[data-item-id="${itemId}"]`);
const chip = (page, actorId, itemId) => page.locator(`${caseSel(actorId)} .attache-chip[data-item-id="${itemId}"]`);
const footprint = (entry) => (entry ? `${entry.w}x${entry.h}` : null);
const entries = (page, text) => page.locator("#context-menu .context-item", { hasText: text });

async function openKebab(page, uuid) {
  const sheetId = await page.evaluate(async (uuid) => {
    const doc = await fromUuid(uuid);
    await doc.sheet.render({ force: true });
    return doc.sheet.id;
  }, uuid);
  const sheet = page.locator(`[id="${sheetId}"]`);
  await expect(sheet).toBeVisible();
  await sheet.locator("[data-action=toggleControls]").first().click();
  await expect(page.locator("#context-menu .context-item").first()).toBeVisible();
}

/** Open a compendium to the right of the case windows, so that it covers no grid. */
async function openPack(page, pack) {
  await page.evaluate((pack) => game.packs.get(pack).render({ force: true }), pack);
  const id = `Compendium-${pack.replaceAll(".", "_")}`;
  await expect(page.locator(`[id="${id}"]`)).toBeVisible();
  await page.evaluate((id) => foundry.applications.instances.get(id).setPosition({ left: 1150, top: 20, width: 340 }), id);
  await page.waitForTimeout(250);
  return id;
}

async function closeMenu(page) {
  await page.mouse.click(5, 500);
  await expect(page.locator("#context-menu")).toHaveCount(0);
}

test.describe.serial(WORLD, () => {
  let gm;
  let pl;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(400_000);
    gm = await session(browser, WORLD, "Gamemaster", { canvas: false });
    await resetWorld(gm.page);
    pl = await session(browser, WORLD, "Player", { canvas: false });
  });

  test.afterEach(async () => {
    for (const s of [gm, pl]) if (s) await closeAll(s.page).catch(() => {});
  });

  test.afterAll(async () => {
    await gm?.ctx.close();
    await pl?.ctx.close();
  });

  for (const role of ["GM", "Player"]) {
    test(`01 ${role} opens the case from the sheet, the sidebar and I`, async () => {
      const { page } = role === "GM" ? gm : pl;
      const seed = await page.evaluate((flag) => game.actors.find((a) => a.getFlag(flag.scope, flag.key))?.id, SEED_FLAG);
      expect(seed, "seeded character (dev/setup.sh)").toBeTruthy();

      await openKebab(page, `Actor.${seed}`);
      await clickMenu(page, ENTRY);
      await expect(page.locator(`${caseSel(seed)} .attache-layout`)).toBeVisible();
      await closeAll(page);

      await page.evaluate(() => ui.actors.activate());
      await page.locator(`#actors .directory-item[data-entry-id="${seed}"]`).click({ button: "right" });
      await clickMenu(page, ENTRY);
      await expect(page.locator(caseSel(seed))).toBeVisible();
      await closeAll(page);

      if (role === "GM") await page.evaluate((id) => game.user.update({ character: id }), seed);
      await page.mouse.click(800, 600);
      await page.keyboard.press("KeyI");
      await expect(page.locator(caseSel(seed))).toBeVisible();
      await page.keyboard.press("KeyI");
      await expect(page.locator(caseSel(seed))).toHaveCount(0);
      if (role === "GM") await page.evaluate(() => game.user.update({ character: null }));
    });
  }

  test("02 real compendium items get the D-003 sizes on both clients; an unarmed strike takes no space", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sizes", body: { cols: 20, rows: 20 } });
    const ids = await addFromPack(gm.page, actorId, [
      "Longsword", "Greatsword", "Dagger", "Longbow", "Spear", "Plate Armor", "Shield", "Arrows", "Potion of Healing", "Rope", "Pole", "Ladder", "Shovel", "Spell Scroll, 1st Level", "Backpack"
    ]);
    const unarmed = await addFromPack(gm.page, actorId, ["Unarmed Strike"]);
    const expected = {
      "Longsword": "6x1", "Greatsword": "8x2", "Dagger": "2x1", "Longbow": "8x2", "Spear": "8x1", "Plate Armor": "4x5", "Shield": "3x3", "Arrows": "2x1",
      "Potion of Healing": "1x1", "Rope": "2x2", "Pole": "8x1", "Ladder": "8x2", "Shovel": "5x2", "Spell Scroll, 1st Level": "2x1", "Backpack": "4x4"
    };
    const sizes = async (page) => {
      const { placed } = await layout(page, actorId);
      return Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, footprint(placed[id])]));
    };
    expect(await sizes(gm.page)).toEqual(expected);
    expect(await sizes(pl.page)).toEqual(expected);
    const l = await layout(gm.page, actorId);
    expect(l.excluded).toContain(unarmed["Unarmed Strike"]);
    expect(l.placed[unarmed["Unarmed Strike"]]).toBeUndefined();

    // Identity on real data: a renamed sword keeps its size.
    const sword = ids.Longsword;
    await gm.page.evaluate(({ actorId, sword }) => game.actors.get(actorId).items.get(sword).update({ name: "Presa do Dragão" }), { actorId, sword });
    expect(footprint((await layout(gm.page, actorId)).placed[sword])).toBe("6x1");

    // Real items whose size comes from a keyword or a punctuated table name: no base item to save them.
    const named = await addFromPack(gm.page, actorId, ["Cloak of Protection", "Boots of Speed", "Staff of Fire", "Vorpal Sword", "Explorer's Pack", "Lantern, Hooded", "Ladder"]);
    const before = (await layout(gm.page, actorId)).placed;
    for (const [i, id] of Object.values(named).entries()) {
      await gm.page.evaluate(({ actorId, id, name }) => game.actors.get(actorId).items.get(id).update({ name }), { actorId, id, name: `Presente da Rainha ${i}` });
    }
    const after = (await layout(gm.page, actorId)).placed;
    expect(Object.fromEntries(Object.entries(named).map(([n, id]) => [n, footprint(after[id])])))
      .toEqual(Object.fromEntries(Object.entries(named).map(([n, id]) => [n, footprint(before[id])])));
    for (const id of Object.values(named)) expect(after[id], "same place").toEqual(before[id]);
    await openCase(gm.page, actorId);
    await screenshot(gm.page, `${WORLD}-m3-sizes`);
  });

  for (const role of ["GM", "Player"]) {
    test(`03 ${role} drops from compendiums: our bag pack and a system weapon`, async () => {
      const { page } = role === "GM" ? gm : pl;
      const { actorId } = await makeActor(gm.page, { name: `QA Drop ${role}`, body: { cols: 8, rows: 5 } });
      const root = await openCase(page, actorId);
      await page.evaluate((id) => foundry.applications.instances.get(`attache-case-Actor-${id}`).setPosition({ left: 20, top: 20 }), actorId);

      const info = await page.evaluate(async (pack) => {
        const p = game.packs.get(pack);
        const docs = await p.getDocuments();
        return { count: docs.length, names: docs.map((d) => d.name), id: docs.find((d) => d.name === "Backpack")?.id, types: [...new Set(docs.map((d) => d.type))] };
      }, PACK);
      await openPack(page, PACK);
      expect(info.count).toBe(8);
      expect([...info.names].sort()).toEqual(["Backpack", "Bag of Holding", "Barrel", "Basket", "Chest", "Pouch", "Sack", "Saddlebags"]);
      expect(info.types).toEqual(["container"]);
      expect(info.id).toBeTruthy();
      const grid = root.locator('.attache-grid[data-container-id="body"]');
      const bag = page.locator(`.application.compendium-directory .directory-item[data-entry-id="${info.id}"]`);
      await expect(bag).toBeVisible();
      await bag.dragTo(grid, { targetPosition: { x: 200, y: 100 }, timeout: 20_000 });
      await expect.poll(() => page.evaluate((id) => game.actors.get(id).items.find((i) => i.name === "Backpack")?.type, actorId)).toBe("container");
      const bagId = await page.evaluate((id) => game.actors.get(id).items.find((i) => i.name === "Backpack").id, actorId);
      await expect(root.locator(`.attache-grid[data-container-id="${bagId}"]`)).toBeVisible();
      expect(await itemFlags(page, actorId, bagId)).toMatchObject({ container: { cols: 8, rows: 6 } });
      if (role === "GM") await screenshot(page, `${WORLD}-m3-compendium`);
      const packWindow = await openPack(page, PACK);
      await page.evaluate((id) => foundry.applications.instances.get(id).close({ animate: false }), packWindow);

      // A system compendium weapon, onto a chosen cell.
      const entryId = await page.evaluate(async (pack) => (await game.packs.get(pack).getIndex()).find((e) => e.name === "Longsword")._id, SYSTEM_PACK);
      await openPack(page, SYSTEM_PACK);
      await page.locator(".application.compendium-directory input[type=search]").last().fill("Longsword");
      await page.waitForTimeout(800);
      const entry = page.locator(`.application.compendium-directory .directory-item[data-entry-id="${entryId}"]`);
      await expect(entry).toBeVisible();
      const point = await cellPoint(page, actorId, "body", 1, 2);
      const box = await grid.boundingBox();
      await entry.dragTo(grid, { targetPosition: { x: point.x - box.x, y: point.y - box.y }, timeout: 20_000 });
      await expect.poll(() => page.evaluate((id) => game.actors.get(id).items.find((i) => i.name === "Longsword")?.flags["attache-case"]?.pos, actorId))
        .toEqual({ c: "body", x: 1, y: 2, r: false });
      const swordId = await page.evaluate((id) => game.actors.get(id).items.find((i) => i.name === "Longsword").id, actorId);
      expect(footprint((await layout(page, actorId)).placed[swordId])).toBe("6x1");
    });
  }

  test("04 Player drags and rotates real items; the GM sees it", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Drag", body: { cols: 8, rows: 5 } });
    const ids = await addFromPack(gm.page, actorId, ["Shortsword", "Dagger"]);
    await openCase(pl.page, actorId);
    const sword = ids.Shortsword;
    const dagger = ids.Dagger;

    await pointerDrag(pl.page, await tilePoint(pl.page, actorId, sword), await cellPoint(pl.page, actorId, "body", 3, 4));
    await waitForFlags(pl.page, actorId, sword, (f) => f.pos?.x === 3 && f.pos?.y === 4 && f.pos?.r === false);

    // R during a drag.
    await pointerDrag(pl.page, await tilePoint(pl.page, actorId, sword), await cellPoint(pl.page, actorId, "body", 7, 0), { mid: () => pl.page.keyboard.press("KeyR") });
    await waitForFlags(pl.page, actorId, sword, (f) => f.pos?.r === true && f.pos?.x === 7);
    await expect(tile(pl.page, actorId, sword)).toHaveClass(/is-rotated/);
    expect(footprint((await layout(pl.page, actorId)).placed[sword])).toBe("1x4");

    // R while hovering, then the menu entry.
    const p = await tilePoint(pl.page, actorId, dagger);
    await pl.page.mouse.move(p.x, p.y);
    await pl.page.keyboard.press("KeyR");
    await waitForFlags(pl.page, actorId, dagger, (f) => f.pos?.r === true);
    await tile(pl.page, actorId, dagger).click({ button: "right" });
    await clickMenu(pl.page, "Rotate");
    await waitForFlags(pl.page, actorId, dagger, (f) => f.pos?.r === false);

    await openCase(gm.page, actorId);
    await expect(tile(gm.page, actorId, sword)).toHaveClass(/is-rotated/);
    expect(await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).flags["attache-case"].pos, { a: actorId, i: sword }))
      .toEqual({ c: "body", x: 7, y: 0, r: true });
  });

  test("05 gives between actors: menu, cross-window drag, GM relay; the stack stays one stack", async () => {
    await gm.page.evaluate(async () => {
      if (!game.users.getName("Player2")) await User.create({ name: "Player2", role: CONST.USER_ROLES.PLAYER });
    });
    const page = pl.page;
    const src = await makeActor(gm.page, { name: "QA Giver", body: { cols: 8, rows: 5 } });
    const mine = await makeActor(gm.page, { name: "QA Mine", body: { cols: 8, rows: 5 } });
    const theirs = await makeActor(gm.page, { name: "QA Theirs", owner: "Player2", body: { cols: 8, rows: 5 } });
    const ids = await addFromPack(gm.page, src.actorId, ["Longsword", "Arrows", "Dagger"]);
    await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ "system.quantity": 20 }), { a: src.actorId, i: ids.Arrows });
    const count = (actorId, name) => page.evaluate(({ actorId, name }) => game.actors.get(actorId).items.filter((i) => i.name === name).length, { actorId, name });

    const root = await openCase(page, src.actorId);
    await root.locator(`.attache-tile[data-item-id="${ids.Arrows}"]`).click({ button: "right" });
    await clickMenu(page, "Give");
    const give = page.locator(".application.attache-give");
    await give.locator(".attache-give-option", { hasText: "QA Mine" }).click();
    await give.locator("button[data-action=give]").click();
    await expect.poll(() => count(mine.actorId, "Arrows")).toBe(1);
    expect(await count(src.actorId, "Arrows")).toBe(0);
    expect(await page.evaluate((id) => game.actors.get(id).items.find((i) => i.name === "Arrows").system.quantity, mine.actorId)).toBe(20);

    await openCase(page, mine.actorId);
    await page.evaluate(({ a, b }) => {
      foundry.applications.instances.get(`attache-case-Actor-${a}`).setPosition({ left: 20, top: 60 });
      foundry.applications.instances.get(`attache-case-Actor-${b}`).setPosition({ left: 780, top: 60 });
    }, { a: src.actorId, b: mine.actorId });
    await page.waitForTimeout(300);
    await pointerDrag(page, await tilePoint(page, src.actorId, ids.Longsword), await cellPoint(page, mine.actorId, "body", 1, 3));
    await expect.poll(() => page.evaluate((id) => game.actors.get(id).items.find((i) => i.name === "Longsword")?.flags["attache-case"]?.pos, mine.actorId))
      .toEqual({ c: "body", x: 1, y: 3, r: false });
    expect(await count(src.actorId, "Longsword")).toBe(0);
    await screenshot(page, `${WORLD}-m3-two-windows`);

    // The target belongs to another player: relayed through the GM.
    await root.locator(`.attache-tile[data-item-id="${ids.Dagger}"]`).click({ button: "right" });
    await clickMenu(page, "Give");
    const again = page.locator(".application.attache-give");
    await again.locator(".attache-give-option", { hasText: "QA Theirs" }).click();
    await again.locator("button[data-action=give]").click();
    await expect.poll(() => gm.page.evaluate((id) => game.actors.get(id).items.filter((i) => i.name === "Dagger").length, theirs.actorId)).toBe(1);
    await expect.poll(() => count(src.actorId, "Dagger")).toBe(0);
  });

  test("06 kebab entries on real dnd5e sheets, the container sheet included", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Sheets", body: { cols: 8, rows: 5 } });
    const ids = await addFromPack(gm.page, actorId, ["Longsword", "Backpack"]);
    const sheetClass = await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).sheet.constructor.name, { a: actorId, i: ids.Backpack });
    expect(sheetClass).toBe("ContainerSheet");

    await openKebab(gm.page, `Actor.${actorId}`);
    await clickMenu(gm.page, ENTRY);
    await expect(gm.page.locator(`${caseSel(actorId)} .attache-layout`)).toBeVisible();
    await closeAll(gm.page);

    for (const [actorType, sheet] of [["npc", "NPCActorSheet"], ["vehicle", "VehicleActorSheet"]]) {
      const other = await makeActor(gm.page, { name: `QA Sheets ${actorType}`, actorType });
      expect(await gm.page.evaluate((id) => game.actors.get(id).sheet.constructor.name, other.actorId)).toBe(sheet);
      for (const { page } of [gm, pl]) {
        await openKebab(page, `Actor.${other.actorId}`);
        await clickMenu(page, ENTRY);
        await expect(page.locator(`${caseSel(other.actorId)} .attache-layout`)).toBeVisible();
        await closeAll(page);
      }
    }

    for (const id of [ids.Longsword, ids.Backpack]) {
      const uuid = `Actor.${actorId}.Item.${id}`;
      await openKebab(gm.page, uuid);
      await clickMenu(gm.page, "Inventory Size");
      await expect(gm.page.locator(".application.attache-size-config")).toBeVisible();
      await closeAll(gm.page);
      await openKebab(gm.page, uuid);
      await clickMenu(gm.page, "Change Image");
      await expect(gm.page.locator(".application.attache-art-config")).toBeVisible();
      await closeAll(gm.page);

      await openKebab(pl.page, uuid);
      await expect(entries(pl.page, "Inventory Size")).toHaveCount(0);
      await clickMenu(pl.page, "Change Image");
      await expect(pl.page.locator(".application.attache-art-config")).toBeVisible();
      await closeAll(pl.page);
    }
  });

  test("07 group and encounter actors are refused", async () => {
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

        await clearNotifications(page);
        await page.evaluate((id) => game.modules.get("attache-case").api.open(game.actors.get(id)), actorId);
        await expect(page.locator(caseSel(actorId))).toHaveCount(0);
        await expect(page.locator("#notifications .notification", { hasText: "This actor type is not supported." }).first()).toBeVisible();
        await expect(page.locator("#notifications .notification", { hasText: "This game system" })).toHaveCount(0);
      }
    }
  });

  test("08 quantity badge on tiles and chips; the size does not grow", async () => {
    const { actorId } = await makeActor(gm.page, {
      name: "QA Quantity", body: { cols: 4, rows: 2 }
    });
    const ids = await addFromPack(gm.page, actorId, ["Arrows", "Potion of Healing", "Dagger"]);
    await gm.page.evaluate(({ a, ids }) => game.actors.get(a).updateEmbeddedDocuments("Item", [
      { _id: ids.Arrows, "system.quantity": 20 }, { _id: ids["Potion of Healing"], "system.quantity": 3 }
    ]), { a: actorId, ids });
    await openCase(pl.page, actorId);
    const badge = (loc) => loc.locator(".attache-qty");
    await expect(badge(tile(pl.page, actorId, ids.Arrows))).toHaveText("20");
    await expect(badge(tile(pl.page, actorId, ids["Potion of Healing"]))).toHaveText("3");
    await expect(badge(tile(pl.page, actorId, ids.Dagger))).toHaveCount(0);
    expect(await tile(pl.page, actorId, ids.Arrows).evaluate((el) => [el.style.getPropertyValue("--w").trim(), el.style.getPropertyValue("--h").trim()])).toEqual(["2", "1"]);
    // The small tile hides its name, not its badge.
    await expect(badge(tile(pl.page, actorId, ids["Potion of Healing"]))).toBeVisible();

    // A stack merge is only an update: the other client follows, and the size stays.
    await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ "system.quantity": 40 }), { a: actorId, i: ids.Arrows });
    await expect(badge(tile(pl.page, actorId, ids.Arrows))).toHaveText("40");
    expect(footprint((await layout(pl.page, actorId)).placed[ids.Arrows])).toBe("2x1");

    // Stowed: a chip keeps the badge.
    await tile(pl.page, actorId, ids.Arrows).click({ button: "right" });
    await clickMenu(pl.page, "Stow");
    await expect(badge(chip(pl.page, actorId, ids.Arrows))).toHaveText("40");
    await expect(chip(pl.page, actorId, ids.Dagger)).toHaveCount(0);

    // Down to one: no badge.
    await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ "system.quantity": 1 }), { a: actorId, i: ids.Arrows });
    await expect(chip(pl.page, actorId, ids.Arrows)).toBeVisible();
    await expect(badge(chip(pl.page, actorId, ids.Arrows))).toHaveCount(0);
    await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ "system.quantity": 12 }), { a: actorId, i: ids.Arrows });
    await expect(badge(chip(pl.page, actorId, ids.Arrows))).toHaveText("12");

    for (const scheme of ["light", "dark"]) {
      await setScheme(pl.page, scheme);
      await screenshot(pl.page, `${WORLD}-m3-quantity-${scheme}`);
    }

    // The smallest tile the settings allow, with the longest labels: the badge stays inside it.
    await pl.page.evaluate(() => game.settings.set("attache-case", "cellSize", 32));
    const small = badge(tile(pl.page, actorId, ids["Potion of Healing"]));
    try {
      for (const [quantity, label] of [[999, "999"], [1000, "1k"], [123456, "123k"]]) {
        await gm.page.evaluate(({ a, i, quantity }) => game.actors.get(a).items.get(i).update({ "system.quantity": quantity }), { a: actorId, i: ids["Potion of Healing"], quantity });
        await expect(small).toHaveText(label);
        await pl.page.waitForTimeout(250);
        const b = await small.boundingBox();
        const t = await tile(pl.page, actorId, ids["Potion of Healing"]).boundingBox();
        expect(t.width, "the tile really is one 32 px cell").toBeLessThan(33);
        expect(b.x, label).toBeGreaterThanOrEqual(t.x);
        expect(b.x + b.width, label).toBeLessThanOrEqual(t.x + t.width);
      }
      // The exact number stays in the tooltip.
      expect(await tile(pl.page, actorId, ids["Potion of Healing"]).getAttribute("data-tooltip-html")).toContain("×123456");
    } finally {
      await pl.page.evaluate(() => game.settings.set("attache-case", "cellSize", 48));
    }
  });

  test("09 unidentified: Player sees a generic label, no chosen art, the same size", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Unidentified", body: { cols: 8, rows: 5 } });
    const ids = await addFromPack(gm.page, actorId, ["Longsword", "Rope"]);
    const art = "icons/svg/sword.svg";
    await gm.page.evaluate(({ a, i, art }) => game.actors.get(a).items.get(i).setFlag("attache-case", "art", art), { a: actorId, i: ids.Longsword, art });
    const created = await addItems(gm.page, actorId, [{
      name: "Vorpal Blade", type: "weapon", img: "icons/svg/item-bag.svg",
      system: { type: { value: "martialM", baseItem: "greatsword" }, identified: false, unidentified: { name: "" } }
    }]);
    const blade = created["Vorpal Blade"];
    const before = (await layout(gm.page, actorId)).placed;
    expect(footprint(before[blade])).toBe("8x2");
    expect(footprint(before[ids.Longsword])).toBe("6x1");

    const name = (page, id) => tile(page, actorId, id).locator(".attache-tile-name");
    await openCase(pl.page, actorId);
    await openCase(gm.page, actorId);
    // Empty unidentified name: the Player gets the generic label everywhere, the GM the real name.
    await expect(name(pl.page, blade)).toHaveText("Unidentified Item");
    await expect(tile(pl.page, actorId, blade)).toHaveAttribute("aria-label", "Unidentified Item");
    expect(await tile(pl.page, actorId, blade).getAttribute("data-tooltip-html")).not.toContain("Vorpal");
    await expect(name(gm.page, blade)).toHaveText("Vorpal Blade");

    // Unidentifying through the data dnd5e fills the fake name in; size and place do not change.
    await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ "system.identified": false }), { a: actorId, i: ids.Longsword });
    await expect(name(pl.page, ids.Longsword)).not.toHaveText("Longsword");
    const fake = await name(pl.page, ids.Longsword).textContent();
    expect(fake).toMatch(/Unidentified/);
    let after = (await layout(pl.page, actorId)).placed;
    expect(after[ids.Longsword]).toEqual(before[ids.Longsword]);
    // The chosen image is concealed from the Player while unidentified; the GM keeps it.
    const src = (page, id) => tile(page, actorId, id).locator(".attache-tile-art").getAttribute("src");
    expect(await src(pl.page, ids.Longsword)).not.toBe(art);
    expect(await src(gm.page, ids.Longsword)).toBe(art);
    for (const scheme of ["light", "dark"]) {
      await setScheme(pl.page, scheme);
      await screenshot(pl.page, `${WORLD}-m3-unidentified-${scheme}`);
    }

    // Identified again.
    await gm.page.evaluate(({ a, ids }) => game.actors.get(a).updateEmbeddedDocuments("Item", [
      { _id: ids[0], "system.identified": true }, { _id: ids[1], "system.identified": true }
    ]), { a: actorId, ids: [ids.Longsword, blade] });
    await expect(name(pl.page, blade)).toHaveText("Vorpal Blade");
    await expect(name(pl.page, ids.Longsword)).toHaveText("Longsword");
    expect(await src(pl.page, ids.Longsword)).toBe(art);
    after = (await layout(pl.page, actorId)).placed;
    expect(after[blade]).toEqual(before[blade]);
    expect(after[ids.Longsword]).toEqual(before[ids.Longsword]);

    // A stowed unidentified item: the chip follows the same rule. dnd5e fills an empty name in on the update
    // that sets identified:false, so it is emptied by a second one.
    await gm.page.evaluate(async ({ a, i }) => {
      const it = game.actors.get(a).items.get(i);
      await it.update({ "system.identified": false });
      await it.update({ "system.unidentified.name": "" });
    }, { a: actorId, i: blade });
    await expect(name(pl.page, blade)).toHaveText("Unidentified Item");
    await tile(pl.page, actorId, blade).click({ button: "right" });
    await clickMenu(pl.page, "Stow");
    await expect(chip(pl.page, actorId, blade).locator(".attache-chip-name")).toHaveText("Unidentified Item");
    await expect(chip(pl.page, actorId, blade).locator(".attache-chip-size")).toHaveText(/8\D+2/);
    // The Give dialog's title must not name it either.
    await chip(pl.page, actorId, blade).click({ button: "right" });
    await clickMenu(pl.page, "Give");
    const give = pl.page.locator(".application.attache-give");
    await expect(give).toBeVisible();
    await expect(give.locator(".window-title")).toContainText("Unidentified Item");
    await expect(give.locator(".window-title")).not.toContainText("Vorpal");
    await give.locator("button[data-action=cancel]").click();

    // With Players Edit Sizes on, the size dialog names it no better.
    await gm.page.evaluate(() => game.settings.set("attache-case", "playersCanEditSizes", true));
    await pl.page.waitForTimeout(250);
    await chip(pl.page, actorId, blade).click({ button: "right" });
    await clickMenu(pl.page, "Inventory Size");
    const dialog = pl.page.locator(".application.attache-size-config");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".window-title")).toContainText("Unidentified Item");
    expect(await dialog.evaluate((el) => el.outerHTML)).not.toMatch(/Vorpal|Greatsword/i);
    await dialog.locator("[data-action=close]").click();
    await gm.page.evaluate(() => game.settings.set("attache-case", "playersCanEditSizes", false));

    // A bag panel follows the same rule.
    const bags = await addItems(gm.page, actorId, [{
      name: "Bag of Secrets", type: "container", img: "icons/svg/item-bag.svg",
      system: { identified: false, unidentified: { name: "" } }, flags: { "attache-case": { container: { cols: 3, rows: 2 } } }
    }]);
    const panel = pl.page.locator(`${caseSel(actorId)} .attache-panel`).filter({ has: pl.page.locator(`.attache-grid[data-container-id="${bags["Bag of Secrets"]}"]`) });
    await expect(panel.locator(".attache-panel-name")).toHaveText("Unidentified Item");
    expect(await pl.page.locator(caseSel(actorId)).evaluate((el) => el.outerHTML)).not.toMatch(/Bag of Secrets|Vorpal/);
    const gmPanel = gm.page.locator(`${caseSel(actorId)} .attache-panel`).filter({ has: gm.page.locator(`.attache-grid[data-container-id="${bags["Bag of Secrets"]}"]`) });
    await expect(gmPanel.locator(".attache-panel-name")).toHaveText("Bag of Secrets");
  });

  test("10 npc attacks take no space, real gear does; the GM can include one", async () => {
    const { actorId } = await makeActor(gm.page, { name: "QA Monster", actorType: "npc", body: { cols: 8, rows: 5 } });
    const ids = await addItems(gm.page, actorId, [
      { name: "Bite", type: "weapon", system: { type: { value: "natural" } } },
      { name: "Tail Attack", type: "weapon", system: { type: { value: "simpleM" }, properties: [] } },
      { name: "Carried Mace", type: "weapon", system: { type: { value: "simpleM", baseItem: "mace" }, weight: { value: 4, units: "lb" } } }
    ]);
    const gear = await addFromPack(gm.page, actorId, ["Longsword"]);
    // dnd5e marks any non-natural weapon created on an npc as `gear`, so a weapon with no such mark is what
    // an embedded pack monster has. With the mark the tail would count as carried.
    expect(await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).system.properties.has("gear"), { a: actorId, i: ids["Tail Attack"] })).toBe(true);
    expect(footprint((await layout(gm.page, actorId)).placed[ids["Tail Attack"]])).toBe("3x1");
    await gm.page.evaluate(({ a, i }) => game.actors.get(a).items.get(i).update({ "system.properties": [] }), { a: actorId, i: ids["Tail Attack"] });
    const l = await layout(gm.page, actorId);
    expect(l.excluded.sort()).toEqual([ids.Bite, ids["Tail Attack"]].sort());
    expect(footprint(l.placed[ids["Carried Mace"]])).toBe("3x1");
    expect(footprint(l.placed[gear.Longsword])).toBe("6x1");

    await openCase(pl.page, actorId);
    await expect(pl.page.locator(`${caseSel(actorId)} .attache-excluded`)).toHaveCount(0);
    await expect(tile(pl.page, actorId, ids.Bite)).toHaveCount(0);

    const root = await openCase(gm.page, actorId);
    await root.locator(".attache-excluded summary").click();
    await chip(gm.page, actorId, ids.Bite).click({ button: "right" });
    await clickMenu(gm.page, "Include");
    await waitForFlags(gm.page, actorId, ids.Bite, (f) => f.excluded === false);
    await expect.poll(async () => Boolean((await layout(gm.page, actorId)).excluded.includes(ids.Bite))).toBe(false);
    const p = await chipPoint(gm.page, actorId, ids.Bite);
    await pointerDrag(gm.page, p, await cellPoint(gm.page, actorId, "body", 0, 4));
    await expect(tile(gm.page, actorId, ids.Bite)).toBeVisible();
  });

  test("11 console: no errors or warnings from attache-case", async () => {
    expect(moduleErrors(gm.errors), "GM").toEqual([]);
    expect(moduleErrors(pl.errors), "Player").toEqual([]);
    await gm.page.evaluate(async (flag) => {
      const actors = game.actors.filter((a) => a.getFlag(flag.scope, flag.key));
      if (actors.length) await Actor.deleteDocuments(actors.map((a) => a.id));
      await game.users.getName("Player2")?.delete();
    }, QA_FLAG);
    for (const s of [gm, pl]) await setScheme(s.page, "dark").catch(() => {});
  });
});
