/**
 * InventoryService: reads Foundry documents into core layouts and performs every inventory write.
 * Apps call this module; it calls the pure core and the Foundry document API. Every write is a
 * single batched update with only the keys that change.
 */

import { MODULE_ID, BODY_ID, FLAGS } from "../constants.mjs";
import { DEFAULT_REGISTRY } from "../data/default-sizes.mjs";
import { CONTAINER_PRESETS } from "../data/container-presets.mjs";
import { buildLayout, findSpot, canMove, withPlacement, autoArrange as arrange } from "../core/layout.mjs";
import { explainSize, isContainer, sanitizeContainer, sanitizeSize, mergeRegistries } from "../core/sizes.mjs";
import { footprint } from "../core/grid.mjs";
import { describe, isArmor, isSupportedActor, moduleFlags, containerItemData } from "./system-adapter.mjs";
import { defaultBody, wornEnabled } from "../settings.mjs";
import { loc, notify, deletion, flagPath } from "./util.mjs";

/* -------------------------------------------- */
/*  Size registry                               */
/* -------------------------------------------- */

const extraRegistries = [];
let mergedRegistry = null;
const registryListeners = new Set();

/** @returns {object} the effective size registry (defaults + registered extensions) */
export function registry() {
  mergedRegistry ??= extraRegistries.length ? mergeRegistries(DEFAULT_REGISTRY, ...extraRegistries) : DEFAULT_REGISTRY;
  return mergedRegistry;
}

/**
 * Add a size registry (see scripts/core/sizes.mjs for the shape). Later registrations win.
 * @param {object} reg
 */
export function registerSizes(reg) {
  if (!reg || typeof reg !== "object" || Array.isArray(reg)) throw new TypeError(`${MODULE_ID} | registerSizes expects a registry object`);
  extraRegistries.push(reg);
  mergedRegistry = null;
  for (const fn of registryListeners) fn();
}

/** @param {() => void} fn called after registerSizes() */
export function onRegistryChange(fn) {
  registryListeners.add(fn);
}

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * @param {Actor} actor
 * @returns {{cols:number, rows:number, custom:boolean}} the actor's body grid
 */
export function bodyDims(actor) {
  const own = sanitizeContainer(actor?.getFlag?.(MODULE_ID, FLAGS.BODY), { min: 0 });
  return own ? { ...own, custom: true } : { ...defaultBody(), custom: false };
}

/** Compare by sort, then id (same order on every client). */
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Size information for one item.
 * @param {Item|object} item
 * @returns {{size:{w:number,h:number}|null, excluded:boolean, source:string, container:boolean}}
 */
export function itemSize(item) {
  const d = describe(item);
  return { ...explainSize(d, registry()), container: isContainer(d) };
}

/** Whether this item currently counts as worn (armor + flag + setting). */
export function isWorn(item) {
  return wornEnabled() && isArmor(item) && moduleFlags(item)[FLAGS.WORN] === true;
}

/**
 * @typedef {object} ContainerInfo
 * @property {string} id "body" or the container item id
 * @property {number} cols
 * @property {number} rows
 * @property {Item|null} item container item (null for the body)
 */

/**
 * @typedef {object} InventoryState
 * @property {Actor} actor
 * @property {ContainerInfo[]} containers display order, body first (omitted when 0 cells)
 * @property {object} layout core layout (grids, placed, overflow)
 * @property {Map<string, {item: Item, size: {w:number,h:number}}>} entries every item in the layout
 * @property {Item[]} overflow unstowed items, in layout order
 * @property {Item[]} worn worn armor
 * @property {Item[]} excluded physical-type items that take no space
 */

/**
 * Read an actor's inventory.
 * @param {Actor} actor
 * @returns {InventoryState}
 */
export function getState(actor) {
  const containers = [];
  const body = bodyDims(actor);
  if (body.cols > 0 && body.rows > 0) containers.push({ id: BODY_ID, cols: body.cols, rows: body.rows, item: null });

  const entries = new Map();
  const worn = [];
  const excluded = [];
  const boxes = [];
  const layoutItems = [];
  for (const item of actor.items) {
    const info = itemSize(item);
    if (info.container) {
      const dims = sanitizeContainer(moduleFlags(item)[FLAGS.CONTAINER]);
      boxes.push({ id: item.id, sort: item.sort, cols: dims.cols, rows: dims.rows, item });
      continue;
    }
    if (!info.size) {
      if (info.excluded) excluded.push(item);
      continue;
    }
    if (isWorn(item)) {
      worn.push(item);
      continue;
    }
    entries.set(item.id, { item, size: info.size });
    layoutItems.push({ id: item.id, size: info.size, pos: moduleFlags(item)[FLAGS.POS] ?? null, sort: item.sort ?? 0 });
  }
  boxes.sort(bySort);
  for (const { id, cols, rows, item } of boxes) containers.push({ id, cols, rows, item });
  const layout = buildLayout(containers, layoutItems);
  worn.sort(bySort);
  excluded.sort(bySort);
  return {
    actor, containers, layout, entries, worn, excluded,
    overflow: layout.overflow.map((id) => entries.get(id).item)
  };
}

/**
 * Plain-data snapshot of an actor's layout (public API).
 * @param {Actor} actor
 * @returns {{containers: Array<{id:string, cols:number, rows:number, name:string}>,
 *   placed: Record<string, {c:string,x:number,y:number,r:boolean,w:number,h:number}>,
 *   overflow: string[], worn: string[], excluded: string[]}}
 */
export function getLayout(actor) {
  const s = getState(actor);
  return {
    containers: s.containers.map(({ id, cols, rows, item }) => ({ id, cols, rows, name: item?.name ?? loc("ATTACHE.Window.Body") })),
    placed: Object.fromEntries([...s.layout.placed].map(([id, p]) => [id, { ...p }])),
    overflow: [...s.layout.overflow],
    worn: s.worn.map((i) => i.id),
    excluded: s.excluded.map((i) => i.id)
  };
}

/**
 * Used and total cells, overall and per container.
 * @param {InventoryState} state
 * @returns {{used:number, total:number, pct:number, perContainer: Map<string, {used:number, total:number, pct:number}>}}
 */
export function capacity(state) {
  const perContainer = new Map();
  let used = 0;
  let total = 0;
  for (const ct of state.containers) {
    const grid = state.layout.grids.get(ct.id);
    const t = ct.cols * ct.rows;
    const u = t - grid.freeCells();
    perContainer.set(ct.id, { used: u, total: t, pct: t ? Math.round((u / t) * 100) : 0 });
    used += u;
    total += t;
  }
  return { used, total, pct: total ? Math.round((used / total) * 100) : 0, perContainer };
}

/* -------------------------------------------- */
/*  Writing helpers                             */
/* -------------------------------------------- */

/** Update entry placing an item at `pos` (null = unstowed), clearing `worn` if needed. */
function placementUpdate(item, pos) {
  const flags = moduleFlags(item);
  const u = { _id: item.id };
  if (pos) {
    const p = { c: pos.c, x: pos.x, y: pos.y, r: Boolean(pos.r) };
    const cur = flags[FLAGS.POS];
    if (!cur || cur.c !== p.c || cur.x !== p.x || cur.y !== p.y || Boolean(cur.r) !== p.r) u[flagPath(FLAGS.POS)] = p;
  } else if (flags[FLAGS.POS] !== undefined) {
    u[flagPath(FLAGS.POS)] = deletion();
  }
  if (flags[FLAGS.WORN] !== undefined) u[flagPath(FLAGS.WORN)] = deletion();
  return Object.keys(u).length > 1 ? u : null;
}

async function applyUpdates(actor, updates) {
  const list = updates.filter(Boolean);
  if (!list.length) return [];
  return actor.updateEmbeddedDocuments("Item", list);
}

/**
 * Pick a spot for an item about to be added: the requested cell (unrotated, then rotated),
 * else anywhere, else null (unstowed).
 * @param {object} layout
 * @param {{w:number,h:number}} size
 * @param {{c:string,x:number,y:number,r?:boolean}|null} [want]
 * @param {string} [itemId] id the item has in this layout, if any
 * @returns {{c:string,x:number,y:number,r:boolean}|null}
 */
export function choosePlacement(layout, size, want, itemId = "\u0000incoming") {
  if (want && typeof want.c === "string") {
    const first = { c: want.c, x: want.x, y: want.y, r: Boolean(want.r) };
    if (canMove(layout, itemId, size, first)) return first;
    const flipped = { ...first, r: !first.r };
    if (size.w !== size.h && canMove(layout, itemId, size, flipped)) return flipped;
  }
  return findSpot(layout, null, size, { preferContainer: want?.c, ignoreId: itemId });
}

/* -------------------------------------------- */
/*  Operations on placed items                  */
/* -------------------------------------------- */

/**
 * Move an item to a placement (validated). Clears `worn`.
 * @param {Actor} actor
 * @param {string} itemId
 * @param {{c:string,x:number,y:number,r:boolean}} pos
 * @returns {Promise<boolean>} false when the move is not valid
 */
export async function moveItem(actor, itemId, pos) {
  const item = actor.items.get(itemId);
  if (!item) return false;
  const { size } = itemSize(item);
  if (!size) return false;
  const state = getState(actor);
  if (!canMove(state.layout, itemId, size, pos)) return false;
  await applyUpdates(actor, [placementUpdate(item, pos)]);
  return true;
}

/**
 * Unstow an item (move it to the overflow tray).
 * @param {Actor} actor
 * @param {string} itemId
 */
export async function stowItem(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item) return;
  await applyUpdates(actor, [placementUpdate(item, null)]);
}

/**
 * Wear an armor item (takes no grid space).
 * @param {Actor} actor
 * @param {string} itemId
 * @returns {Promise<boolean>}
 */
export async function wearItem(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item || !wornEnabled()) return false;
  if (!isArmor(item)) {
    notify("warn", "ATTACHE.Notify.NotArmor", { name: item.name });
    return false;
  }
  if (isWorn(item)) return true;
  const u = { _id: item.id, [flagPath(FLAGS.WORN)]: true };
  if (moduleFlags(item)[FLAGS.POS] !== undefined) u[flagPath(FLAGS.POS)] = deletion();
  await applyUpdates(actor, [u]);
  return true;
}

/**
 * Take off a worn item: put it back in the grid if there is room, else unstow it.
 * @param {Actor} actor
 * @param {string} itemId
 */
export async function takeOffItem(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item) return;
  const { size } = itemSize(item);
  const state = getState(actor);
  const spot = size ? findSpot(state.layout, null, size) : null;
  if (!spot) notify("info", "ATTACHE.Notify.DidNotFit", { name: item.name });
  await applyUpdates(actor, [placementUpdate(item, spot)]);
}

/**
 * Rotate a placed item where it is (same top-left, nudged back into bounds if needed).
 * @param {Actor} actor
 * @param {string} itemId
 * @returns {Promise<boolean>} false (and a warning) if the rotated item does not fit
 */
export async function rotateInPlace(actor, itemId) {
  const item = actor.items.get(itemId);
  const state = getState(actor);
  const placed = state.layout.placed.get(itemId);
  const entry = state.entries.get(itemId);
  if (!item || !entry) return false;
  if (!placed) {
    notify("warn", "ATTACHE.Notify.CannotRotate", { name: item.name });
    return false;
  }
  const { size } = entry;
  if (size.w === size.h) return true;
  const r = !placed.r;
  const fp = footprint(size, r);
  const grid = state.layout.grids.get(placed.c);
  const candidates = [
    { x: placed.x, y: placed.y },
    { x: Math.min(placed.x, grid.cols - fp.w), y: Math.min(placed.y, grid.rows - fp.h) },
    // Keep the item centred on its old centre.
    { x: placed.x + Math.round((placed.w - fp.w) / 2), y: placed.y + Math.round((placed.h - fp.h) / 2) }
  ];
  for (const { x, y } of candidates) {
    const pos = { c: placed.c, x, y, r };
    if (canMove(state.layout, itemId, size, pos)) {
      await applyUpdates(actor, [placementUpdate(item, pos)]);
      return true;
    }
  }
  notify("warn", "ATTACHE.Notify.CannotRotate", { name: item.name });
  return false;
}

/**
 * Repack every non-worn physical item from scratch (single batched update).
 * @param {Actor} actor
 * @returns {Promise<{placed:number, overflow:number}>}
 */
export async function autoArrange(actor) {
  const state = getState(actor);
  const items = [...state.entries.values()].map(({ item, size }) => ({ id: item.id, size, sort: item.sort ?? 0 }));
  const result = arrange(state.containers, items);
  const updates = [];
  for (const { item } of state.entries.values()) updates.push(placementUpdate(item, result.placements.get(item.id) ?? null));
  await applyUpdates(actor, updates);
  return { placed: result.placements.size, overflow: result.overflow.length };
}

/**
 * Place unstowed items wherever they fit, without moving anything already placed.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string[]} [options.only] restrict to these item ids
 * @param {boolean} [options.clearRest=false] unset the stale `pos` of items that still do not fit
 * @returns {Promise<{placed:number, remaining:number}>}
 */
export async function packUnstowed(actor, { only, clearRest = false } = {}) {
  const state = getState(actor);
  let layout = state.layout;
  const updates = [];
  let placed = 0;
  let remaining = 0;
  for (const item of state.overflow) {
    if (only && !only.includes(item.id)) continue;
    const { size } = state.entries.get(item.id);
    const spot = findSpot(layout, null, size, { ignoreId: item.id });
    const next = spot && withPlacement(layout, item.id, size, spot);
    if (next) {
      layout = next;
      updates.push(placementUpdate(item, spot));
      placed++;
    } else {
      remaining++;
      if (clearRest) updates.push(placementUpdate(item, null));
    }
  }
  await applyUpdates(actor, updates);
  return { placed, remaining };
}

/* -------------------------------------------- */
/*  Adding, removing and transferring items     */
/* -------------------------------------------- */

/** Clean creation data of an item copied onto `target`, with our placement flags set. */
function copyData(source, { pos = null, worn = false } = {}) {
  const data = source instanceof foundry.abstract.DataModel ? source.toObject() : foundry.utils.deepClone(source);
  delete data._id;
  delete data.folder;
  delete data.ownership;
  delete data.sort;
  data.flags ??= {};
  const ours = { ...(data.flags[MODULE_ID] ?? {}) };
  delete ours[FLAGS.POS];
  delete ours[FLAGS.WORN];
  if (pos) ours[FLAGS.POS] = { c: pos.c, x: pos.x, y: pos.y, r: Boolean(pos.r) };
  if (worn) ours[FLAGS.WORN] = true;
  data.flags[MODULE_ID] = ours;
  return data;
}

/**
 * Decide where an incoming item goes on `actor`.
 * @param {Actor} actor
 * @param {Item|object} item document or data (used for its size)
 * @param {{kind:"cell", pos:object}|{kind:"overflow"}|{kind:"worn"}|{kind:"auto"}} target
 * @returns {{pos: object|null, worn: boolean}}
 */
function resolveIncoming(actor, item, target) {
  const info = itemSize(item);
  if (target.kind === "worn" && wornEnabled() && isArmor(item)) return { pos: null, worn: true };
  if (!info.size || target.kind === "overflow") return { pos: null, worn: false };
  const state = getState(actor);
  const pos = choosePlacement(state.layout, info.size, target.kind === "cell" ? target.pos : null);
  return { pos, worn: false };
}

/**
 * Operation options for our own creates (preCreate auto-placement must not second-guess them).
 * A new object per call: core writes into the operation (e.g. `parent`), so it cannot be shared or frozen.
 */
const ownCreate = () => ({ [MODULE_ID]: { placed: true } });

/**
 * Create an item from Foundry drop data on this actor at the requested cell (or move it when it
 * is already owned by this actor).
 * @param {Actor} actor
 * @param {object} dropData `{type:"Item", uuid}`
 * @param {{kind:string, pos?:object}} target
 * @returns {Promise<Item|null>}
 */
export async function addFromDrop(actor, dropData, target) {
  if (dropData?.type !== "Item") return null;
  let source;
  try {
    source = await Item.implementation.fromDropData(dropData);
  } catch {
    source = null;
  }
  if (!source) return null;

  // Same actor: it is a move.
  if (source.parent === actor) {
    if (target.kind === "overflow") await stowItem(actor, source.id);
    else if (target.kind === "worn") await wearItem(actor, source.id);
    else if (target.kind === "cell") {
      const { size } = itemSize(source);
      const pos = size && choosePlacement(getState(actor).layout, size, target.pos, source.id);
      if (pos && pos.c === target.pos.c && pos.x === target.pos.x && pos.y === target.pos.y) await moveItem(actor, source.id, pos);
      else notify("warn", "ATTACHE.Notify.NoSpace", { name: source.name });
    }
    return source;
  }

  const info = itemSize(source);
  if (!info.size && !info.container && !info.excluded) {
    notify("warn", "ATTACHE.Notify.NotInventory", { name: source.name });
    return null;
  }
  const data = source.pack || !source.parent
    ? game.items.fromCompendium(source, { keepId: false })
    : source.toObject();
  const { pos, worn } = resolveIncoming(actor, data, target);
  const [created] = await actor.createEmbeddedDocuments("Item", [copyData(data, { pos, worn })], ownCreate());
  if (created && info.size && !pos && !worn && target.kind !== "overflow") {
    notify("info", "ATTACHE.Notify.DidNotFit", { name: created.name });
  }
  return created ?? null;
}

/**
 * Move an item to another actor: create on the target first, delete from the source only after
 * that succeeded; roll the copy back if the delete fails. Never duplicates or loses items.
 * Runs locally; callers must own both actors (or be the GM).
 * @param {Item} item owned item
 * @param {Actor} targetActor
 * @param {{kind:string, pos?:object}} [target]
 * @returns {Promise<Item>} the new item
 */
export async function executeTransfer(item, targetActor, target = { kind: "auto" }) {
  const source = item.parent;
  if (!source || source === targetActor) throw new Error("invalid transfer");
  if (!source.items.has(item.id)) throw new Error("source item gone");
  const { pos, worn } = resolveIncoming(targetActor, item, target);
  const [created] = await targetActor.createEmbeddedDocuments("Item", [copyData(item, { pos, worn })], ownCreate());
  if (!created) throw new Error("create failed");
  try {
    // A concurrent transfer of the same item (double drop, GM + player) may have deleted it
    // already: then this copy is a duplicate and must be rolled back too.
    const deleted = await source.deleteEmbeddedDocuments("Item", [item.id]);
    if (!deleted?.length) throw new Error("source item gone");
  } catch (err) {
    await targetActor.deleteEmbeddedDocuments("Item", [created.id]).catch(() => null);
    throw err;
  }
  return created;
}

/** Query name of the GM-relayed transfer. */
export const TRANSFER_QUERY = `${MODULE_ID}.transfer`;

/**
 * Whether `user` may hand items to `actor`: actors they own, or actors with a player owner.
 * @param {Actor} actor
 * @param {User} [user]
 * @returns {boolean}
 */
export function canGiveTo(actor, user = game.user) {
  if (!isSupportedActor(actor) || actor.pack) return false;
  return actor.testUserPermission(user, "OWNER") || actor.hasPlayerOwner;
}

/**
 * Give an item to another actor, relaying to the active GM when the user does not own the
 * target. Shows notifications; never throws.
 * @param {Item} item
 * @param {Actor} targetActor
 * @param {{kind:string, pos?:object}} [target]
 * @returns {Promise<boolean>}
 */
export async function transferItem(item, targetActor, target = { kind: "auto" }) {
  const source = item?.parent;
  if (!source || !targetActor || source === targetActor) return false;
  if (!source.isOwner || !canGiveTo(targetActor)) {
    notify("warn", "ATTACHE.Notify.NoPermission");
    return false;
  }
  const name = item.name;
  try {
    if (targetActor.isOwner) {
      await executeTransfer(item, targetActor, target);
    } else {
      const gm = game.users.activeGM;
      if (!gm) {
        notify("warn", "ATTACHE.Notify.NoGM");
        return false;
      }
      const res = await gm.query(TRANSFER_QUERY, {
        itemUuid: item.uuid, targetUuid: targetActor.uuid, target
      }, { timeout: 20000 });
      if (res?.error === "gone") return false; // a concurrent transfer of this item won
      if (!res?.ok) throw new Error(res?.error ?? "rejected");
    }
  } catch (err) {
    // A concurrent transfer of the same item (double click, double drop) won the race: the copy
    // was rolled back and the item already moved once, so there is nothing to report.
    if (!source.items.has(item.id)) return false;
    console.error(`${MODULE_ID} | transfer failed`, err);
    notify("error", "ATTACHE.Notify.TransferFailed", { name });
    return false;
  }
  notify("info", "ATTACHE.Notify.Transferred", { name, actor: targetActor.name });
  return true;
}

/**
 * Delete an item (callers confirm first).
 * @param {Item} item
 */
export async function deleteItem(item) {
  await item.parent?.deleteEmbeddedDocuments("Item", [item.id]);
}

/* -------------------------------------------- */
/*  Configuration (GM)                          */
/* -------------------------------------------- */

/**
 * Set or reset the actor's body grid.
 * @param {Actor} actor
 * @param {{cols:number, rows:number}|null} dims null = use the world default
 */
export async function setBody(actor, dims) {
  const clean = dims && sanitizeContainer(dims, { min: 0 });
  const has = actor.getFlag(MODULE_ID, FLAGS.BODY) !== undefined;
  if (!clean) {
    if (has) await actor.update({ [flagPath(FLAGS.BODY)]: deletion() });
    return;
  }
  await actor.update({ [flagPath(FLAGS.BODY)]: clean });
}

/**
 * Resize a container ("body" or a container item). Items that no longer fit become unstowed
 * (their pos flag is kept, per the architecture contract).
 * @param {Actor} actor
 * @param {string} containerId
 * @param {{cols:number, rows:number}} dims
 */
export async function resizeContainer(actor, containerId, dims) {
  if (containerId === BODY_ID) return setBody(actor, dims);
  const item = actor.items.get(containerId);
  const clean = sanitizeContainer(dims);
  if (!item || !clean) return;
  await item.update({ [flagPath(FLAGS.CONTAINER)]: clean });
}

/**
 * Next sort value after every existing container item of the actor.
 * @param {Actor} actor
 */
function nextContainerSort(actor) {
  let max = 0;
  for (const item of actor.items) if (itemSize(item).container) max = Math.max(max, item.sort ?? 0);
  return max + (CONST.SORT_INTEGER_DENSITY ?? 100000);
}

/**
 * Add a container from a preset; the name is localized now.
 * @param {Actor} actor
 * @param {string} key CONTAINER_PRESETS key
 * @returns {Promise<Item|null>}
 */
export async function addPresetContainer(actor, key) {
  const preset = CONTAINER_PRESETS.find((p) => p.key === key);
  if (!preset) return null;
  const data = containerItemData({
    name: loc(preset.name), description: loc(preset.description), img: preset.img, cols: preset.cols, rows: preset.rows
  });
  if (!data) return null;
  data.sort = nextContainerSort(actor);
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created ?? null;
}

/**
 * Remove a container item. Its contents are re-packed elsewhere where possible, else unstowed.
 * @param {Actor} actor
 * @param {string} containerId
 */
export async function removeContainer(actor, containerId) {
  const contents = [];
  for (const item of actor.items) if (moduleFlags(item)[FLAGS.POS]?.c === containerId) contents.push(item.id);
  await actor.deleteEmbeddedDocuments("Item", [containerId]);
  if (contents.length) await packUnstowed(actor, { only: contents, clearRest: true });
}

/**
 * Write the GM size configuration of one item in a single update.
 * @param {Item} item
 * @param {{size?: {w:number,h:number}|null, excluded?: boolean|null, container?: {cols:number,rows:number}|null}} cfg
 *   null = remove the flag; undefined = leave it alone
 */
export async function setItemConfig(item, cfg) {
  const flags = moduleFlags(item);
  const update = {};
  const put = (key, value) => {
    if (value === undefined) return;
    if (value === null) {
      if (flags[key] !== undefined) update[flagPath(key)] = deletion();
    } else if (JSON.stringify(flags[key]) !== JSON.stringify(value)) {
      update[flagPath(key)] = value;
    }
  };
  put(FLAGS.SIZE, cfg.size === null ? null : (cfg.size && sanitizeSize(cfg.size)) ?? undefined);
  put(FLAGS.EXCLUDED, cfg.excluded === null ? null : cfg.excluded);
  put(FLAGS.CONTAINER, cfg.container === null ? null : (cfg.container && sanitizeContainer(cfg.container)) ?? undefined);
  // A container never sits in a grid.
  if (cfg.container && flags[FLAGS.POS] !== undefined) update[flagPath(FLAGS.POS)] = deletion();
  if (!Object.keys(update).length) return;
  await item.update(update);
}

/**
 * Toggle the GM exclusion of an item.
 * @param {Item} item
 */
export async function toggleExcluded(item) {
  const excluded = itemSize(item).excluded;
  // Including again: drop the flag if the registry does not exclude it, else force `false`.
  if (excluded) {
    const d = describe(item);
    const reg = explainSize({ ...d, flags: { ...d.flags, excluded: undefined } }, registry());
    await setItemConfig(item, { excluded: reg.excluded ? false : null });
  } else {
    await setItemConfig(item, { excluded: true });
  }
}

/**
 * Resize several container items at once (single batched update).
 * @param {Actor} actor
 * @param {Record<string, {cols:number, rows:number}>} dimsById
 */
export async function resizeContainers(actor, dimsById) {
  const updates = [];
  for (const [id, dims] of Object.entries(dimsById ?? {})) {
    const item = actor.items.get(id);
    const clean = sanitizeContainer(dims);
    const cur = item && sanitizeContainer(moduleFlags(item)[FLAGS.CONTAINER]);
    if (!cur || !clean || (cur.cols === clean.cols && cur.rows === clean.rows)) continue;
    updates.push({ _id: id, [flagPath(FLAGS.CONTAINER)]: clean });
  }
  await applyUpdates(actor, updates);
}
