/**
 * InventoryService: reads Foundry documents into core layouts and performs every inventory write.
 * Apps call this module; it calls the pure core and the Foundry document API. Every write is a
 * single batched update with only the keys that change.
 */

import { MODULE_ID, BODY_ID, FLAGS } from "../constants.mjs";
import { DEFAULT_REGISTRY } from "../data/default-sizes.mjs";
import { buildLayout, findSpot, canMove, withPlacement, autoArrange as arrange } from "../core/layout.mjs";
import { explainSize, sanitizeContainer, sanitizeSize, mergeRegistries } from "../core/sizes.mjs";
import { footprint } from "../core/grid.mjs";
import {
  autoContainerDims, containerDims, describe, displayName, hasNativeBags, holdsWithoutGrid, isNativeGrid, isSupportedActor, isWearable, moduleFlags, nativeParent,
  containerItemData, containerPresets, canEditArt, cleanArt, profile, wouldCycle
} from "./system-adapter.mjs";
import { isUnstowedByUser, isWorn, placementFields } from "./placement.mjs";
import { autoPlaceEnabled, defaultBody, wornEnabled } from "../settings.mjs";
import { loc, notify, deletion, flagPath } from "./util.mjs";

export { isWorn };

/* -------------------------------------------- */
/*  Size registry                               */
/* -------------------------------------------- */

const extraRegistries = [];
let mergedRegistry = null;
const registryListeners = new Set();

/** @returns {object} the effective size registry (defaults + registered extensions) */
export function registry() {
  // A third party's `byName` also goes first by itself: see `nameOverrides` in core/sizes.mjs.
  mergedRegistry ??= extraRegistries.length
    ? { ...mergeRegistries(DEFAULT_REGISTRY, ...extraRegistries), nameOverrides: mergeRegistries(...extraRegistries).byName }
    : DEFAULT_REGISTRY;
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
  const info = explainSize(describe(item), registry());
  // A bag has a size of its own only while the GM says it is not a bag: as a bag it never sits in a grid.
  const container = Boolean(containerDims(item));
  return { ...info, size: container ? null : info.size, container };
}

/**
 * The pos an item may use (PLAN A2): the one in its own bag, or for a loose item any grid but a native bag.
 * Anything else shows in Unstowed with the flag left alone. Without native bags it is the flag, as ever.
 */
function effectivePos(item, parent, actor) {
  const pos = moduleFlags(item)[FLAGS.POS] ?? null;
  if (!pos || !hasNativeBags()) return pos;
  if (parent) return isNativeGrid(parent) && pos.c === parent.id ? pos : null;
  return isNativeGrid(actor.items.get(pos.c)) ? null : pos;
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
 * @property {Item[]} held items inside a native container with no grid: the holder's tile stands for them
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
  const held = [];
  const boxes = [];
  const layoutItems = [];
  for (const item of actor.items) {
    const dims = containerDims(item);
    if (dims) {
      boxes.push({ id: item.id, sort: item.sort, cols: dims.cols, rows: dims.rows, item });
      continue;
    }
    const info = itemSize(item);
    if (!info.size) {
      if (info.excluded) excluded.push(item);
      continue;
    }
    const parent = nativeParent(item, actor);
    if (holdsWithoutGrid(parent)) {
      held.push(item);
      continue;
    }
    if (isWorn(item)) {
      worn.push(item);
      continue;
    }
    entries.set(item.id, { item, size: info.size });
    layoutItems.push({ id: item.id, size: info.size, pos: effectivePos(item, parent, actor), sort: item.sort ?? 0 });
  }
  boxes.sort(bySort);
  for (const { id, cols, rows, item } of boxes) containers.push({ id, cols, rows, item });
  const layout = buildLayout(containers, layoutItems);
  worn.sort(bySort);
  excluded.sort(bySort);
  return {
    actor, containers, layout, entries, worn, excluded, held,
    overflow: layout.overflow.map((id) => entries.get(id).item)
  };
}

/**
 * Plain-data snapshot of an actor's layout (public API).
 * @param {Actor} actor
 * @returns {{containers: Array<{id:string, cols:number, rows:number, name:string}>,
 *   placed: Record<string, {c:string,x:number,y:number,r:boolean,w:number,h:number}>,
 *   overflow: string[], worn: string[], excluded: string[], held: string[]}}
 */
export function getLayout(actor) {
  const s = getState(actor);
  return {
    containers: s.containers.map(({ id, cols, rows, item }) => ({ id, cols, rows, name: item ? displayName(item) : loc("ATTACHE.Window.Body") })),
    placed: Object.fromEntries([...s.layout.placed].map(([id, p]) => [id, { ...p }])),
    overflow: [...s.layout.overflow],
    worn: s.worn.map((i) => i.id),
    excluded: s.excluded.map((i) => i.id),
    held: s.held.map((i) => i.id)
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

/**
 * Update entry for a new place of an item (see placementFields), or null when nothing changes.
 * @param {Item} item
 * @param {{pos?:object|null, worn?:boolean, stowed?:boolean}} place
 * @param {{userAction?:boolean}} [context]
 */
function placementUpdate(item, place, { userAction = false } = {}) {
  const fields = placementFields(item, place, { actor: item.parent, userAction });
  return Object.keys(fields).length ? { _id: item.id, ...fields } : null;
}

/**
 * One batched update, marked so that the writing client's own hooks do not take it for a move on the sheet (D-002).
 * A new marker per call: core writes into the operation, so it cannot be shared.
 */
async function applyUpdates(actor, updates) {
  const list = updates.filter(Boolean);
  if (!list.length) return [];
  return actor.updateEmbeddedDocuments("Item", list, { [MODULE_ID]: { synced: true } });
}

/**
 * The grids an automatic path may use for a loose item (D-008): the body and any grid that is not a native bag.
 * @param {InventoryState} state
 * @returns {string[]} ids in display order
 */
export function automaticGrids(state) {
  return state.containers.filter((ct) => !isNativeGrid(ct.item)).map((ct) => ct.id);
}

/**
 * The grids a path may use for an item in this state (PLAN A2). An item with a bag goes only there.
 * @param {InventoryState} state
 * @param {Item} item
 * @param {object} [options]
 * @param {boolean} [options.userAction=false] the user asked for it: a loose item may enter a bag
 * @returns {string[]} ids in display order
 */
function gridsFor(state, item, { userAction = false } = {}) {
  const parent = nativeParent(item, state.actor);
  if (isNativeGrid(parent)) return [parent.id];
  if (holdsWithoutGrid(parent)) return [];
  // A pointer at a plain item stays until the user asks: nothing automatic rewrites native data.
  if (!userAction) return parent ? [] : automaticGrids(state);
  return state.containers.map((ct) => ct.id).filter((id) => !wouldCycle(state.actor, item, id));
}

/**
 * Pick a spot for an item about to be added: the requested cell (unrotated, then rotated),
 * else anywhere, else null (unstowed).
 * @param {object} layout
 * @param {{w:number,h:number}} size
 * @param {{c:string,x:number,y:number,r?:boolean}|null} [want]
 * @param {string} [itemId] id the item has in this layout, if any
 * @param {string[]} [grids] where it may go when the cell is taken; default every grid
 * @returns {{c:string,x:number,y:number,r:boolean}|null}
 */
export function choosePlacement(layout, size, want, itemId = "\u0000incoming", grids = null) {
  if (want && typeof want.c === "string") {
    const first = { c: want.c, x: want.x, y: want.y, r: Boolean(want.r) };
    if (canMove(layout, itemId, size, first)) return first;
    const flipped = { ...first, r: !first.r };
    if (size.w !== size.h && canMove(layout, itemId, size, flipped)) return flipped;
  }
  return findSpot(layout, grids, size, { preferContainer: want?.c, ignoreId: itemId });
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
  if (wouldCycle(actor, item, pos.c)) {
    notify("warn", "ATTACHE.Notify.ContainerCycle", { name: displayName(item) });
    return false;
  }
  const state = getState(actor);
  if (!canMove(state.layout, itemId, size, pos)) return false;
  await applyUpdates(actor, [placementUpdate(item, { pos }, { userAction: true })]);
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
  await applyUpdates(actor, [placementUpdate(item, { stowed: hasNativeBags() }, { userAction: true })]);
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
  if (!isWearable(item)) {
    notify("warn", "ATTACHE.Notify.NotArmor", { name: displayName(item) });
    return false;
  }
  if (isWorn(item)) return true;
  await applyUpdates(actor, [placementUpdate(item, { worn: true }, { userAction: true })]);
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
  const spot = size ? findSpot(state.layout, automaticGrids(state), size) : null;
  if (!spot) notify("info", "ATTACHE.Notify.DidNotFit", { name: displayName(item) });
  await applyUpdates(actor, [placementUpdate(item, { pos: spot }, { userAction: true })]);
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
    notify("warn", "ATTACHE.Notify.CannotRotate", { name: displayName(item) });
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
      await applyUpdates(actor, [placementUpdate(item, { pos }, { userAction: true })]);
      return true;
    }
  }
  notify("warn", "ATTACHE.Notify.CannotRotate", { name: displayName(item) });
  return false;
}

/**
 * Repack every non-worn physical item from scratch (single batched update). A native bag is arranged on its own with
 * its own contents, the rest in the other grids, so the sheet's organization is never rewritten (D-009).
 * @param {Actor} actor
 * @returns {Promise<{placed:number, overflow:number}>}
 */
export async function autoArrange(actor) {
  const state = getState(actor);
  const descriptor = ({ item, size }) => ({ id: item.id, size, sort: item.sort ?? 0 });
  const groups = new Map();
  const rest = [];
  let stranded = 0;
  for (const entry of state.entries.values()) {
    const parent = nativeParent(entry.item, actor);
    if (!parent) rest.push(descriptor(entry));
    else if (!isNativeGrid(parent)) stranded++;
    else if (groups.has(parent.id)) groups.get(parent.id).push(descriptor(entry));
    else groups.set(parent.id, [descriptor(entry)]);
  }
  const runs = [{ containers: state.containers.filter((ct) => !isNativeGrid(ct.item)), items: rest }];
  for (const [id, items] of groups) runs.push({ containers: state.containers.filter((ct) => ct.id === id), items });
  const placements = new Map();
  let overflow = stranded;
  for (const { containers, items } of runs) {
    const result = arrange(containers, items);
    for (const [id, p] of result.placements) placements.set(id, p);
    overflow += result.overflow.length;
  }
  const updates = [];
  for (const { item } of state.entries.values()) updates.push(placementUpdate(item, { pos: placements.get(item.id) ?? null }));
  await applyUpdates(actor, updates);
  return { placed: placements.size, overflow };
}

/**
 * Place unstowed items wherever they fit, without moving anything already placed.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string[]} [options.only] restrict to these item ids
 * @param {boolean} [options.clearRest=false] unset the stale `pos` of items that still do not fit
 * @param {boolean} [options.userAction=false] the user clicked for it: a loose item may enter a native bag (PLAN A2)
 * @returns {Promise<{placed:number, remaining:number}>}
 */
export async function packUnstowed(actor, { only, clearRest = false, userAction = false } = {}) {
  const state = getState(actor);
  let layout = state.layout;
  const updates = [];
  let placed = 0;
  let remaining = 0;
  for (const item of state.overflow) {
    if (only && !only.includes(item.id)) continue;
    const { size } = state.entries.get(item.id);
    const spot = findSpot(layout, gridsFor(state, item, { userAction }), size, { ignoreId: item.id });
    const next = spot && withPlacement(layout, item.id, size, spot);
    if (next) {
      layout = next;
      updates.push(placementUpdate(item, { pos: spot }, { userAction }));
      placed++;
    } else {
      remaining++;
      if (clearRest) updates.push(placementUpdate(item, {}, { userAction }));
    }
  }
  await applyUpdates(actor, updates);
  return { placed, remaining };
}

/** Actors already reconciled this session, by uuid. */
const reconciled = new Set();

/**
 * Set up an existing character when its case is first opened: items with no place yet, or one their bag rules out,
 * get one (PLAN A2's automatic row). One batched update, once per session per actor, and only `pos`: a real
 * character's `system.container` and `system.equipped` are not ours to rewrite. Never call it from a render.
 * An item whose cell is merely taken or cut off by a smaller bag keeps its request, as everywhere; one the user
 * put in Unstowed stays there. A token's case sets up its base actor: a write here would fork what the token inherits
 * from it, so only what the token holds on its own is written on the token. With a base the user does not own, nothing is.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function reconcile(actor) {
  if (!hasNativeBags() || !actor || actor.pack || !actor.isOwner || !autoPlaceEnabled() || reconciled.has(actor.uuid)) return;
  reconciled.add(actor.uuid);
  if (actor.isToken) {
    const base = actor.token?.baseActor;
    if (!base?.isOwner) return;
    await reconcile(base);
  }
  const state = getState(actor);
  let layout = state.layout;
  const updates = [];
  for (const item of state.overflow) {
    if (isUnstowedByUser(item) || (actor.isToken && !actor.token.delta.items.manages(item.id))) continue;
    const parent = nativeParent(item, actor);
    const want = effectivePos(item, parent, actor);
    if (want && state.layout.grids.has(want.c)) continue;
    const { size } = state.entries.get(item.id);
    const spot = findSpot(layout, gridsFor(state, item), size, { ignoreId: item.id });
    const next = spot && withPlacement(layout, item.id, size, spot);
    if (!next) continue;
    layout = next;
    updates.push(placementUpdate(item, { pos: spot }));
  }
  await applyUpdates(actor, updates);
}

/* -------------------------------------------- */
/*  Adding, removing and transferring items     */
/* -------------------------------------------- */

/** Write flat update keys into raw item data. */
function applyFields(data, fields) {
  for (const [key, value] of Object.entries(fields)) foundry.utils.setProperty(data, key, value);
  return data;
}

/** What must not travel with a copy: where it was on the old actor. */
function clearPlacement(data) {
  delete data.folder;
  delete data.ownership;
  data.flags ??= {};
  const ours = { ...(data.flags[MODULE_ID] ?? {}) };
  delete ours[FLAGS.POS];
  delete ours[FLAGS.WORN];
  data.flags[MODULE_ID] = ours;
  return data;
}

/**
 * Decide where an incoming item goes on `actor`.
 * @param {Actor} actor
 * @param {Item|object} item document or data (used for its size)
 * @param {{kind:"cell", pos:object}|{kind:"overflow"}|{kind:"worn"}|{kind:"auto"}} target
 * @returns {{pos: object|null, worn: boolean, stowed: boolean}}
 */
function resolveIncoming(actor, item, target) {
  const info = itemSize(item);
  const none = { pos: null, worn: false, stowed: false };
  if (target.kind === "worn" && wornEnabled() && isWearable(item, actor)) return { ...none, worn: true };
  if (target.kind === "overflow") return { ...none, stowed: hasNativeBags() };
  if (!info.size) return none;
  const state = getState(actor);
  // A cell in a bag is the user's word for that bag. Anything else gives no right to walk into one (PLAN A2, D-008).
  const automatic = automaticGrids(state);
  if (target.kind !== "cell") return { ...none, pos: findSpot(state.layout, automatic, info.size) };
  const grids = isNativeGrid(actor.items.get(target.pos.c)) ? [target.pos.c] : automatic;
  return { ...none, pos: choosePlacement(state.layout, info.size, target.pos, undefined, grids) };
}

/**
 * How many documents an item and everything inside it are. A walk of its own: dnd5e's `allContainedItems` recurses
 * forever on a cycle, which it does not prevent outside its sheets.
 */
async function countWithContents(item) {
  const seen = new Set([item.id]);
  const walk = async (doc) => {
    const contents = await doc.system?.contents;
    for (const child of contents?.values() ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      await walk(child);
    }
  };
  await walk(item);
  return seen.size;
}

/** A child's cell, if it had one in its bag and that bag is a grid on the new actor too; anything else means nothing. */
function remappedPos(data, datas, pos) {
  const parent = datas.find((d) => d._id === data.system?.container);
  return pos?.c && pos.c !== BODY_ID && isNativeGrid(parent) ? { ...pos, c: parent._id } : null;
}

/**
 * Creation data of an item copied onto `actor`, placed as `target` asks: one entry, or on a system with native bags
 * the item followed by its contents (`createWithContents` gives them new ids and links, so it must be created with
 * `keepId`). A copy can land in Worn or in a bag: every placement key comes from placementFields.
 * @param {Item} source
 * @param {Actor} actor
 * @param {object} target see resolveIncoming
 * @param {object} [options]
 * @param {boolean} [options.give=false] a give between actors, not a drop
 * @returns {Promise<{datas: object[], rootId: string|undefined, place: object, options: object, complete: boolean}>}
 *   `complete` is false when dnd5e's depth limit left something out of `datas`, or the contents are a cycle
 */
async function buildCopy(source, actor, target, { give = false } = {}) {
  const p = profile();
  const context = { actor, userAction: true };
  if (!p?.cleanCopy) {
    const data = source.pack || !source.parent ? game.items.fromCompendium(source, { keepId: false }) : source.toObject();
    const place = resolveIncoming(actor, data, target);
    delete data._id;
    delete data.sort;
    clearPlacement(data);
    return { datas: [applyFields(data, placementFields(data, place, context))], rootId: undefined, place, options: ownCreate(), complete: true };
  }
  const prepared = await p.prepareCopy(source, actor);
  const datas = await Item.implementation.createWithContents([prepared]);
  const complete = datas.length === await countWithContents(source);
  datas.forEach((data, index) => {
    const oldPos = moduleFlags(data)[FLAGS.POS];
    p.cleanCopy(clearPlacement(data), { give, root: index === 0 });
    const pos = index && remappedPos(data, datas, oldPos);
    if (pos) data.flags[MODULE_ID][FLAGS.POS] = pos;
  });
  const [root] = datas;
  delete root.sort;
  const place = resolveIncoming(actor, root, target);
  applyFields(root, placementFields(root, place, context));
  // Otherwise dnd5e equips armor given to an npc, and a tile asked for on a cell would jump to Worn.
  if (!place.worn && wornEnabled() && isWearable(root, actor)) root.system.equipped = false;
  return { datas, rootId: root._id, place, options: { ...ownCreate(), keepId: true }, complete };
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
      else notify("warn", "ATTACHE.Notify.NoSpace", { name: displayName(source) });
    }
    return source;
  }

  const info = itemSize(source);
  if (!info.size && !info.container && !info.excluded) {
    notify("warn", "ATTACHE.Notify.NotInventory", { name: displayName(source) });
    return null;
  }
  const { datas, rootId, place, options, complete } = await buildCopy(source, actor, target);
  // Nothing is deleted here, so what can be copied is, and the user is told.
  if (!complete) notify("warn", "ATTACHE.Notify.TooDeep", { name: displayName(source) });
  const list = await actor.createEmbeddedDocuments("Item", datas, options);
  const created = rootId ? list.find((doc) => doc.id === rootId) : list[0];
  if (created && info.size && !place.pos && !place.worn && target.kind !== "overflow") {
    notify("info", "ATTACHE.Notify.DidNotFit", { name: displayName(created) });
  }
  return created ?? null;
}

/**
 * Move an item to another actor: create on the target first, delete from the source only after
 * that succeeded; roll every copy back if anything fails. Never duplicates or loses items.
 * On a system with native bags its contents move with it (PLAN A4).
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
  const { datas, rootId, options, complete } = await buildCopy(item, targetActor, target, { give: true });
  // The delete below takes everything inside the item, however deep: what was not copied would be gone for good.
  if (!complete) throw new Error("contents nested too deep to copy");
  const list = await targetActor.createEmbeddedDocuments("Item", datas, options);
  const rollback = () => targetActor.deleteEmbeddedDocuments("Item", list.map((doc) => doc.id)).catch(() => null);
  if (list.length !== datas.length) {
    if (list.length) await rollback();
    throw new Error("create failed");
  }
  try {
    // A concurrent transfer of the same item (double drop, GM + player) may have deleted it
    // already: then this copy is a duplicate and must be rolled back too.
    const deleted = await source.deleteEmbeddedDocuments("Item", [item.id], ...(rootId ? [{ deleteContents: true }] : []));
    if (!deleted?.length) throw new Error("source item gone");
  } catch (err) {
    await rollback();
    throw err;
  }
  return rootId ? list.find((doc) => doc.id === rootId) : list[0];
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
  const name = displayName(item);
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
 * Actors that do not use the world default body grid. A token's delta holds only what the token
 * overrides, so an unlinked token that merely inherits its base actor's size is not listed: clearing
 * the base clears it.
 * @returns {{base: Actor[], tokens: Actor[]}} world actors, and synthetic actors of unlinked tokens
 */
export function actorsWithCustomBody() {
  const hasOwn = (doc) => doc?.flags?.[MODULE_ID]?.[FLAGS.BODY] !== undefined;
  const base = game.actors.filter(hasOwn);
  const tokens = [];
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && hasOwn(token.delta) && token.actor) tokens.push(token.actor);
    }
  }
  return { base, tokens };
}

/**
 * Put every actor back on the world default. Base actors go first, so that by the time a token is
 * reset its base no longer has a size for it to fall back on.
 * @returns {Promise<{cleared:number, failed:number}>}
 */
export async function clearBodyOverrides() {
  const { base, tokens } = actorsWithCustomBody();
  let cleared = 0;
  let failed = 0;
  for (const actor of [...base, ...tokens]) {
    try {
      await setBody(actor, null);
      cleared++;
    } catch (err) {
      failed++;
      console.error(`${MODULE_ID} | could not clear the size of ${actor.name}`, err);
    }
  }
  return { cleared, failed };
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
  const preset = containerPresets().find((p) => p.key === key);
  if (!preset) return null;
  const data = containerItemData({
    name: loc(preset.name), description: loc(preset.description), img: preset.img, cols: preset.cols, rows: preset.rows, system: preset.system
  });
  if (!data) return null;
  data.sort = nextContainerSort(actor);
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created ?? null;
}

/**
 * Remove a container item. Its contents are re-packed elsewhere where possible, else unstowed. Native children are
 * taken out first, in one batch, or they would keep a dangling id; a bag among them keeps what it holds.
 * @param {Actor} actor
 * @param {string} containerId
 */
export async function removeContainer(actor, containerId) {
  const contents = [];
  const children = [];
  for (const item of actor.items) {
    const inside = nativeParent(item, actor)?.id === containerId;
    if (inside) children.push(item);
    if (inside || moduleFlags(item)[FLAGS.POS]?.c === containerId) contents.push(item.id);
  }
  await applyUpdates(actor, children.map((item) => placementUpdate(item, {}, { userAction: true })));
  await actor.deleteEmbeddedDocuments("Item", [containerId]);
  if (contents.length) await packUnstowed(actor, { only: contents, clearRest: true });
}

/**
 * Choose or reset an item's image. The item's own `img` is never touched.
 * @param {Item} item
 * @param {string|null} path path or URL; null or blank = back to the item's own image
 * @returns {Promise<boolean>} false (and a warning) when refused
 */
export async function setItemArt(item, path) {
  if (!canEditArt(item)) {
    notify("warn", "ATTACHE.Notify.NoPermission");
    return false;
  }
  const current = moduleFlags(item)[FLAGS.ART];
  if (path === null || (typeof path === "string" && !path.trim())) {
    if (current !== undefined) await item.update({ [flagPath(FLAGS.ART)]: deletion() });
    return true;
  }
  const clean = cleanArt(path);
  if (!clean) {
    notify("warn", "ATTACHE.Notify.InvalidArt");
    return false;
  }
  if (clean !== current) await item.update({ [flagPath(FLAGS.ART)]: clean });
  return true;
}

/**
 * Write the GM size configuration of one item in a single update.
 * @param {Item} item
 * @param {{size?: {w:number,h:number}|null, excluded?: boolean|null, container?: {cols:number,rows:number}|false|null}} cfg
 *   null = remove the flag; undefined = leave it alone; `container: false` = this bag is not one
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
  // A container never sits in a grid; a flag removed from a real bag makes it a container again.
  if ((cfg.container || (cfg.container === null && autoContainerDims(item))) && flags[FLAGS.POS] !== undefined) update[flagPath(FLAGS.POS)] = deletion();
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
    const cur = item && containerDims(item);
    if (!cur || !clean || (cur.cols === clean.cols && cur.rows === clean.rows)) continue;
    updates.push({ _id: id, [flagPath(FLAGS.CONTAINER)]: clean });
  }
  await applyUpdates(actor, updates);
}
