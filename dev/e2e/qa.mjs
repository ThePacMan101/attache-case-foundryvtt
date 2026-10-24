/**
 * QA helpers for the Attaché Case regression specs: deterministic fixture actors, locators for the
 * case window, real pointer drags and flag polling. Everything that touches documents runs in the
 * page (`page.evaluate`); interactions use Playwright's real mouse and keyboard.
 */

import { expect } from "@playwright/test";
import { launchWorld, loginAs, collectConsoleErrors } from "./helpers.mjs";

/** World flag marking actors created by the QA specs (deleted at the start of every run). */
export const QA_FLAG = { scope: "world", key: "attacheQA" };

/** Item types per system for the generic kinds used by the fixtures. */
export const TYPES = {
  CoC7: { gear: "item", weapon: "weapon", armor: "armor", book: "book", skill: "skill" },
  deltagreen: { gear: "gear", weapon: "weapon", armor: "armor", book: "tome", skill: "bond" }
};

/**
 * Open a browser context logged in as `user` on `worldId` (launching it if needed).
 * `canvas: false` sets the core client setting noCanvas: much faster in headless Chromium (software
 * WebGL), and nothing in the module depends on the canvas.
 * @returns {Promise<{ctx, page, errors: Array}>}
 */
export async function session(browser, worldId, user, { canvas = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  if (!canvas) await ctx.addInitScript(() => localStorage.setItem("core.noCanvas", "true"));
  const page = await ctx.newPage();
  const errors = collectConsoleErrors(page);
  page.on("console", (msg) => {
    if (msg.type() === "warning" && /attache-case/i.test(msg.text())) {
      errors.push({ type: "warning", text: msg.text(), location: msg.location()?.url ?? "" });
    }
  });
  await launchWorld(page, worldId);
  await loginAs(page, user);
  return { ctx, page, errors };
}

/** Delete every QA actor and leftover world items, close every framed window. */
export async function resetWorld(page) {
  await page.evaluate(async (flag) => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame) await app.close();
    const actors = game.actors.filter((a) => a.getFlag(flag.scope, flag.key));
    if (actors.length) await Actor.deleteDocuments(actors.map((a) => a.id));
    const items = game.items.filter((i) => i.getFlag(flag.scope, flag.key));
    if (items.length) await Item.deleteDocuments(items.map((i) => i.id));
    await game.settings.set("attache-case", "autoPlace", true);
    await game.settings.set("attache-case", "allowWorn", true);
    await game.settings.set("attache-case", "playersCanEditSizes", false);
    await game.settings.set("attache-case", "defaultBodyCols", 5);
    await game.settings.set("attache-case", "defaultBodyRows", 3);
  }, QA_FLAG);
}

/**
 * Create a fixture actor (as GM) with a deterministic layout.
 * spec: {name, owner?: "Player"|null, defaultLevel?: number, body?: {cols, rows},
 *   containers?: [{key, name, cols, rows}],
 *   items?: [{key, name, kind: "gear"|"weapon"|"armor"|..., w, h, pos?: {c: "body"|<containerKey>, x, y, r}, worn?, img?}]}
 * Items are created with our "placed" operation option, so auto-placement never interferes.
 * @returns {Promise<{actorId:string, uuid:string, ids: Record<string,string>}>}
 */
export async function makeActor(page, spec) {
  return page.evaluate(async ({ spec, flag, TYPES }) => {
    const types = TYPES[game.system.id];
    const actorType = game.system.id === "CoC7" ? "character" : "agent";
    const ownership = { default: spec.defaultLevel ?? 0 };
    const owner = spec.owner === undefined ? "Player" : spec.owner;
    if (owner) ownership[game.users.getName(owner).id] = 3;
    const flags = { [flag.scope]: { [flag.key]: true } };
    if (spec.body) flags["attache-case"] = { body: spec.body };
    const actor = await Actor.create({ name: spec.name, type: actorType, ownership, flags });
    const ids = {};
    const opts = { "attache-case": { placed: true } };
    const boxes = (spec.containers ?? []).map((c, i) => ({
      name: c.name, type: types.gear, img: "icons/svg/chest.svg", sort: (i + 1) * 100000,
      flags: { "attache-case": { container: { cols: c.cols, rows: c.rows } } }
    }));
    const createdBoxes = boxes.length ? await actor.createEmbeddedDocuments("Item", boxes, opts) : [];
    // Created documents do not always come back in input order: map them by (unique) name.
    for (const c of spec.containers ?? []) ids[c.key] = createdBoxes.find((d) => d.name === c.name).id;
    const data = (spec.items ?? []).map((it) => {
      const ours = {};
      if (it.w) ours.size = { w: it.w, h: it.h };
      if (it.pos) ours.pos = { c: it.pos.c === "body" ? "body" : ids[it.pos.c], x: it.pos.x, y: it.pos.y, r: Boolean(it.pos.r) };
      if (it.worn) ours.worn = true;
      if (it.excluded !== undefined) ours.excluded = it.excluded;
      return { name: it.name, type: types[it.kind ?? "gear"], img: it.img ?? "icons/svg/item-bag.svg", flags: { "attache-case": ours } };
    });
    const created = data.length ? await actor.createEmbeddedDocuments("Item", data, opts) : [];
    for (const it of spec.items ?? []) ids[it.key] = created.find((d) => d.name === it.name).id;
    return { actorId: actor.id, uuid: actor.uuid, ids };
  }, { spec, flag: QA_FLAG, TYPES });
}

/** CSS selector of the case window of an actor. */
export const caseSel = (actorId) => `.application.attache-case[data-actor-uuid="Actor.${actorId}"]`;

/** Open the case (API) and wait until its grids are rendered. */
export async function openCase(page, actorId) {
  await page.evaluate((id) => game.modules.get("attache-case").api.open(game.actors.get(id)), actorId);
  const root = page.locator(caseSel(actorId));
  await expect(root).toBeVisible();
  await expect(root.locator(".attache-layout")).toBeVisible();
  await page.waitForTimeout(250);
  return root;
}

/** Close every framed window (sheets, cases, dialogs). */
export async function closeAll(page) {
  await page.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
  });
  await page.mouse.move(5, 500);
}

/** Bounding box of a grid plus its on-screen cell size. */
export async function gridBox(page, actorId, containerId) {
  const grid = page.locator(`${caseSel(actorId)} .attache-grid[data-container-id="${containerId}"]`);
  await expect(grid).toBeVisible();
  const box = await grid.boundingBox();
  const cols = await grid.evaluate((el) => Number(getComputedStyle(el.closest(".attache-panel")).getPropertyValue("--cols")));
  return { ...box, cell: box.width / cols };
}

/** Screen point at the centre of grid cell (x, y). */
export async function cellPoint(page, actorId, containerId, x, y) {
  const b = await gridBox(page, actorId, containerId);
  return { x: b.x + (x + 0.5) * b.cell, y: b.y + (y + 0.5) * b.cell };
}

/** Screen point at the centre of the (dx, dy) cell of a placed tile (top-left cell by default). */
export async function tilePoint(page, actorId, itemId, dx = 0, dy = 0) {
  const tile = page.locator(`${caseSel(actorId)} .attache-tile[data-item-id="${itemId}"]`);
  await expect(tile).toBeVisible();
  const box = await tile.boundingBox();
  const cid = await tile.evaluate((el) => el.closest(".attache-grid").dataset.containerId);
  const g = await gridBox(page, actorId, cid);
  return { x: box.x + (dx + 0.5) * g.cell, y: box.y + (dy + 0.5) * g.cell };
}

/** Centre of a chip (Unstowed / Worn / Not carried). */
export async function chipPoint(page, actorId, itemId) {
  const chip = page.locator(`${caseSel(actorId)} .attache-chip[data-item-id="${itemId}"]`);
  await expect(chip).toBeVisible();
  const b = await chip.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Centre of a side zone ("overflow" | "worn"). */
export async function zonePoint(page, actorId, kind) {
  const z = page.locator(`${caseSel(actorId)} .attache-${kind}`);
  const b = await z.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 14) };
}

/**
 * Real pointer drag: press at `from`, move past the threshold, move to `to` in steps, run `mid`
 * (e.g. press R) while still holding, release.
 */
let dragShot = 0;
export async function pointerDrag(page, from, to, { mid, steps = 10, release = true } = {}) {
  if (process.env.QA_SHOTS) console.log(`[drag ${dragShot + 1}] ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y + 6, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps });
  await page.waitForTimeout(80);
  if (process.env.QA_SHOTS) await page.screenshot({ path: `/work/dev/artifacts/drag-${++dragShot}-a.png` });
  if (mid) {
    await mid();
    await page.waitForTimeout(80);
    if (process.env.QA_SHOTS) await page.screenshot({ path: `/work/dev/artifacts/drag-${dragShot}-b.png` });
  }
  if (release) {
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
}

/** Our flags of an item (null when the item does not exist). */
export async function itemFlags(page, actorId, itemId) {
  return page.evaluate(({ actorId, itemId }) => {
    const item = game.actors.get(actorId)?.items.get(itemId);
    return item ? foundry.utils.deepClone(item.flags["attache-case"] ?? {}) : null;
  }, { actorId, itemId });
}

/** Poll until `pred(flags)` holds; returns the last flags. */
export async function waitForFlags(page, actorId, itemId, pred, timeout = 5000) {
  const end = Date.now() + timeout;
  let flags;
  while (Date.now() < end) {
    flags = await itemFlags(page, actorId, itemId);
    if (pred(flags)) return flags;
    await page.waitForTimeout(100);
  }
  throw new Error(`flags of ${itemId} never matched; last: ${JSON.stringify(flags)}`);
}

/** Plain layout from the public API. */
export async function layout(page, actorId) {
  return page.evaluate((id) => JSON.parse(JSON.stringify(game.modules.get("attache-case").api.getLayout(game.actors.get(id)))), actorId);
}

/** Text of the most recent notifications. */
export async function notifications(page) {
  return page.evaluate(() => [...document.querySelectorAll("#notifications .notification")].map((n) => n.textContent.trim()));
}

/** Clear notifications (they can cover the top of the screen). */
export async function clearNotifications(page) {
  await page.evaluate(() => ui.notifications.clear());
}

/** Click an entry of the open ContextMenu by its text. */
export async function clickMenu(page, text) {
  const entry = page.locator("#context-menu .context-item", { hasText: text }).first();
  await expect(entry).toBeVisible();
  await entry.click();
  // Core closes the menu with an animation and then removes its element; re-opening the same menu
  // before that finishes would lose the new one, so wait until it is gone.
  await expect(page.locator("#context-menu")).toHaveCount(0);
}

/** Re-export for specs that only import from here. */
export { launchWorld, loginAs };
