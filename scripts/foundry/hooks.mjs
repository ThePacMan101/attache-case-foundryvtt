/**
 * Foundry hooks: auto-placement, re-rendering of open windows, header controls, the Actor
 * Directory context menu and the keybinding. Automatic writes happen only on the client that
 * caused the change (`userId === game.user.id`).
 */

import { MODULE_ID, FLAGS } from "../constants.mjs";
import { canMove, findSpot, withPlacement } from "../core/layout.mjs";
import { canEditArt, displayName, hasNativeBags, isNativeGrid, isSupportedActor, isWearable, isSupportedSystem, moduleFlags, nativeParent, profile } from "./system-adapter.mjs";
import { automaticGrids, getState, itemSize, packUnstowed } from "./inventory.mjs";
import { isUnstowedByUser, isWorn, placementFields } from "./placement.mjs";
import { autoPlaceEnabled, canEditSizes } from "../settings.mjs";
import { deletion, loc, notify, flagPath } from "./util.mjs";
import { AttacheCaseApp } from "../apps/attache-case-app.mjs";
import { ActorConfig } from "../apps/actor-config.mjs";
import { ItemSizeConfig } from "../apps/item-size-config.mjs";
import { ItemArtConfig } from "../apps/item-art-config.mjs";

/* -------------------------------------------- */
/*  Auto-placement                              */
/* -------------------------------------------- */

/**
 * Cells promised to items whose creation is still pending. A multi-item create calls
 * preCreateItem for every item before any of them exists, so each pending placement is
 * reserved here until the items arrive (or a timeout passes).
 * @type {Map<string, {items: Array<{key:string, size:object, pos:object}>, timer:number}>}
 */
const reservations = new Map();
let reservationCounter = 0;
const RESERVATION_TTL = 10000;

function reserve(actor, size, pos) {
  let entry = reservations.get(actor.uuid);
  if (!entry) reservations.set(actor.uuid, entry = { items: [], timer: 0 });
  entry.items.push({ key: `\u0000pending${++reservationCounter}`, size, pos });
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => reservations.delete(actor.uuid), RESERVATION_TTL);
}

function releaseReservations(actor) {
  const entry = reservations.get(actor.uuid);
  if (!entry) return;
  clearTimeout(entry.timer);
  reservations.delete(actor.uuid);
}

/** The actor's current state, with the pending reservations in its layout. */
function stateWithReservations(actor) {
  const state = getState(actor);
  let { layout } = state;
  for (const r of reservations.get(actor.uuid)?.items ?? []) {
    layout = withPlacement(layout, r.key, r.size, r.pos) ?? layout;
  }
  return { ...state, layout };
}

/** Whether a create operation was issued by us with an explicit placement. */
const isOwnCreate = (options) => Boolean(options?.[MODULE_ID]?.placed);

function onPreCreateItem(item, _data, options, userId) {
  if (userId !== game.user.id || isOwnCreate(options) || !autoPlaceEnabled()) return;
  const actor = item.parent;
  if (!isSupportedActor(actor) || actor.pack) return;
  const info = itemSize(item);
  if (!info.size || info.container || isWorn(item)) return;
  // A8: its bag may come later in this batch (at this point it cannot be told from a dangling id), so such an item
  // waits for the batch to end. onCreateItem settles it, when every document of the batch exists.
  const parentId = profile()?.nativeContainer?.(item);
  if (parentId && !actor.items.has(parentId)) return;
  const parent = nativeParent(item, actor);
  if (parent && !isNativeGrid(parent)) return;
  const state = stateWithReservations(actor);
  const grids = parent ? [parent.id] : automaticGrids(state);
  const pos = moduleFlags(item)[FLAGS.POS];
  if (pos && grids.includes(pos.c) && canMove(state.layout, "\u0000new", info.size, pos)) {
    reserve(actor, info.size, pos);
    return;
  }
  const spot = findSpot(state.layout, grids, info.size);
  // A pos copied from another actor means nothing here: drop it so it cannot "come back" later. On a native system it
  // goes altogether, as `null` there says the user chose Unstowed and `reconcile` should try this one again. Only `pos`:
  // a worn flag copied while Worn is off is to survive until the setting returns.
  const key = flagPath(FLAGS.POS);
  const fields = placementFields(item, { pos: spot, stowed: !hasNativeBags() && !spot && pos !== undefined }, { actor });
  if (key in fields) item.updateSource({ [key]: fields[key] });
  if (spot) reserve(actor, info.size, spot);
}

/** Items that did not fit, per actor, so a bulk create shows one notification. */
const unplaced = new Map();

function reportUnplaced(actor, item) {
  let entry = unplaced.get(actor.uuid);
  if (!entry) {
    unplaced.set(actor.uuid, entry = { names: [] });
    setTimeout(() => {
      unplaced.delete(actor.uuid);
      if (entry.names.length === 1) notify("info", "ATTACHE.Notify.DidNotFit", { name: entry.names[0] });
      else notify("info", "ATTACHE.Notify.DidNotFitMany", { count: entry.names.length });
    }, 50);
  }
  entry.names.push(displayName(item));
}

/** Packing waiting for the end of the current batch, per actor. */
const pendingPacks = new Map();

/** The last pack started, per actor: the next one waits for its write to come back, or it would read stale cells. */
const runningPacks = new Map();

/**
 * Automatic packing, debounced per actor (A8). Core fires the `createItem` of one batch in a single synchronous loop,
 * so the next task sees every document and every bag of it; a Handy Haversack sends one write, not four.
 * @param {Actor} actor
 * @param {object} what
 * @param {string[]} [what.ids] these items, in Unstowed for whatever reason
 * @param {boolean} [what.all=false] also the other items in Unstowed, except where the user put them
 * @param {boolean} [what.report=false] tell the user about `ids` still in Unstowed afterwards
 */
function schedulePack(actor, { ids = [], all = false, report = false }) {
  let entry = pendingPacks.get(actor.uuid);
  if (!entry) pendingPacks.set(actor.uuid, entry = { ids: new Set(), reports: new Set(), all: false, timer: 0 });
  for (const id of ids) (report ? entry.reports : entry.ids).add(id);
  entry.all ||= all;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    pendingPacks.delete(actor.uuid);
    const run = (runningPacks.get(actor.uuid) ?? Promise.resolve())
      .then(() => runPack(actor, entry))
      .catch((err) => console.error(`${MODULE_ID} |`, err))
      .finally(() => {
        if (runningPacks.get(actor.uuid) === run) runningPacks.delete(actor.uuid);
      });
    runningPacks.set(actor.uuid, run);
  }, 0);
}

/** An actor that is gone needs no packing, and writing to it would only log an error. */
function cancelPack(actor) {
  clearTimeout(pendingPacks.get(actor.uuid)?.timer);
  pendingPacks.delete(actor.uuid);
}

async function runPack(actor, entry) {
  const only = getState(actor).overflow
    .filter((item) => entry.ids.has(item.id) || entry.reports.has(item.id) || (entry.all && !isUnstowedByUser(item)))
    .map((item) => item.id);
  if (only.length) await packUnstowed(actor, { only });
  for (const item of getState(actor).overflow) {
    if (entry.reports.has(item.id)) reportUnplaced(actor, item);
  }
}

function onCreateItem(item, options, userId) {
  const actor = item.parent;
  if (!isSupportedActor(actor)) return;
  refresh(actor, item);
  if (userId !== game.user.id) return;
  releaseReservations(actor);
  if (actor.pack || !autoPlaceEnabled()) return;
  const info = itemSize(item);
  if (info.container) schedulePack(actor, { all: true });
  else if (!isOwnCreate(options) && info.size && !isWorn(item)) schedulePack(actor, { ids: [item.id], report: true });
}

/** Whether an update wrote or removed one of our flags. A removal can show as `-=key` in core's `changed`. */
function touchedFlag(changed, key) {
  const ours = changed.flags?.[MODULE_ID];
  return Boolean(ours) && (key in ours || `-=${key}` in ours);
}

function onUpdateItem(item, changed, options, userId) {
  const actor = item.parent;
  if (!isSupportedActor(actor)) return;
  refresh(actor, item, changed);
  if (userId !== game.user.id || actor.pack || !autoPlaceEnabled()) return;
  if (touchedFlag(changed, FLAGS.CONTAINER)) {
    if (itemSize(item).container) {
      // Items displaced by shrinking this container keep their pos (architecture contract: growing
      // it back restores them), so only the other unstowed items are packed.
      const ids = getState(actor).overflow.filter((i) => moduleFlags(i)[FLAGS.POS]?.c !== item.id && !isUnstowedByUser(i)).map((i) => i.id);
      if (ids.length) schedulePack(actor, { ids });
    } else if (hasNativeBags()) {
      // The GM said this bag is not one: it is a tile now, and needs a place.
      schedulePack(actor, { ids: [item.id] });
    }
  }
  // D-002: what we wrote ourselves carries the marker. Anything else came from the sheet or a macro.
  if (!hasNativeBags() || options?.[MODULE_ID]?.synced) return;
  const takenOff = changed.system?.equipped === false && isWearable(item);
  if (foundry.utils.hasProperty(changed, "system.container") || takenOff) schedulePack(actor, { ids: [item.id] });
}

/** The dialogs of an item that no longer exists: saving in one could only fail. */
function closeItemDialogs(item) {
  const id = item.uuid.replaceAll(".", "-");
  for (const prefix of ["attache-art-", "attache-size-"]) foundry.applications.instances.get(`${prefix}${id}`)?.close();
}

function onDeleteItem(item, options, userId) {
  closeItemDialogs(item);
  const actor = item.parent;
  if (!isSupportedActor(actor)) return;
  refresh(actor, item);
  // dnd5e leaves the contents of a deleted bag with a dangling id, which counts as loose: they need a place. With
  // `deleteContents` they are about to go too, and a write would race the delete.
  if (userId !== game.user.id || options?.deleteContents || !hasNativeBags() || actor.pack || !autoPlaceEnabled()) return;
  const ids = actor.items.filter((i) => profile().nativeContainer(i) === item.id || moduleFlags(i)[FLAGS.POS]?.c === item.id).map((i) => i.id);
  if (ids.length) schedulePack(actor, { ids });
}

function onCreateActor(actor, _options, userId) {
  if (userId !== game.user.id || actor.pack || !isSupportedActor(actor) || !autoPlaceEnabled()) return;
  if (actor.items.size) schedulePack(actor, { all: true });
}

/**
 * dnd5e claims an npc's weapon from its compendium source, so our flags would stay behind on any route, the sheet's
 * too. Where the item sat on the npc does stay behind.
 */
function onGetAsGear(item, gear) {
  const ours = { ...moduleFlags(item) };
  delete ours[FLAGS.POS];
  delete ours[FLAGS.WORN];
  gear.updateSource({ flags: { [MODULE_ID]: ours } });
  for (const key of [FLAGS.POS, FLAGS.WORN]) {
    if (moduleFlags(gear)[key] !== undefined) gear.updateSource({ [flagPath(key)]: deletion() });
  }
}

/* -------------------------------------------- */
/*  Re-rendering                                */
/* -------------------------------------------- */

/** Keys of an item update that can change what the case shows. */
const VISIBLE_KEYS = ["name", "img", "sort", "type", "flags", "_stats"];

/** Re-render the case (and the GM config) of an actor if this change is visible there. */
function refresh(actor, item, changed) {
  if (item) {
    const ours = foundry.utils.hasProperty(changed ?? {}, `flags.${MODULE_ID}`);
    const info = itemSize(item);
    if (!ours && !info.size && !info.container && !info.excluded) return;
    const visible = VISIBLE_KEYS.some((k) => k in (changed ?? {})) || profile()?.visibleSystemKeys?.some((k) => k in (changed?.system ?? {}));
    if (changed && !ours && !visible) return;
    // The GM dialog has unsaved inputs: a player moving an item (pos/worn) must not wipe them.
    const configKeys = Object.keys(changed?.flags?.[MODULE_ID] ?? {}).filter((k) => !PLACEMENT_KEYS.has(k.replace(/^-=/, "")));
    if (info.container || configKeys.length) ActorConfig.refreshFor(actor);
  }
  AttacheCaseApp.refreshFor(actor);
  // An unlinked token shows its base's items, but core fires nothing on the token when they change.
  if (actor.isToken) return;
  for (const token of actor.getDependentTokens?.() ?? []) {
    if (!token.actorLink && token.actor) AttacheCaseApp.refreshFor(token.actor);
  }
}

/** Item flags that only record where an item sits. */
const PLACEMENT_KEYS = new Set([FLAGS.POS, FLAGS.WORN]);

function refreshActorWindows(actor, changed) {
  if (["name", "img", "ownership", "flags"].some((k) => k in changed)) AttacheCaseApp.refreshFor(actor);
  if ("name" in changed || changed.flags?.[MODULE_ID]) ActorConfig.refreshFor(actor);
}

function onUpdateActor(actor, changed) {
  if (!isSupportedActor(actor)) return;
  refreshActorWindows(actor, changed);
  if (actor.isToken) return;
  // An unlinked token inherits from this actor, but core fires no updateActor for it.
  for (const token of actor.getDependentTokens()) {
    if (!token.actorLink && token.actor) refreshActorWindows(token.actor, changed);
  }
}

/* -------------------------------------------- */
/*  Entry points: header controls, menus, keys  */
/* -------------------------------------------- */

const OPEN_ACTION = "attacheCaseOpen";
const SIZE_ACTION = "attacheCaseItemSize";
const ART_ACTION = "attacheCaseItemArt";

/**
 * Header controls are hook-added entries of the window's kebab menu. The entry carries
 * `onClick`; the same handler is also registered as an action on the sheet in case core only
 * dispatches through `options.actions` (opening is idempotent, so a double call is harmless).
 */
function onActorSheetControls(app, controls) {
  const actor = app.document;
  if (!isSupportedActor(actor) || !actor.isOwner || controls.some((c) => c.action === OPEN_ACTION)) return;
  const handler = () => AttacheCaseApp.open(actor);
  app.options.actions[OPEN_ACTION] ??= handler;
  controls.push({ action: OPEN_ACTION, icon: "fa-solid fa-briefcase", label: "ATTACHE.Menu.OpenCase", visible: true, onClick: handler });
}

function onItemSheetControls(app, controls) {
  const item = app.document;
  if (!isSupportedSystem() || !item) return;
  const info = itemSize(item);
  if (info.source === "nonPhysical" && !info.container) return;
  const add = (action, icon, label, handler) => {
    if (controls.some((c) => c.action === action)) return;
    app.options.actions[action] ??= handler;
    controls.push({ action, icon, label, visible: true, onClick: handler });
  };
  if (canEditSizes(item)) add(SIZE_ACTION, "fa-solid fa-ruler-combined", "ATTACHE.Menu.ItemSize", () => ItemSizeConfig.open(item));
  if (canEditArt(item)) add(ART_ACTION, "fa-solid fa-image", "ATTACHE.Menu.ItemArt", () => ItemArtConfig.open(item));
}

function onActorContextOptions(app, entries) {
  if (app instanceof foundry.applications.sidebar.apps.Compendium || !isSupportedSystem()) return;
  const actorOf = (li) => game.actors.get(li.dataset.entryId);
  entries.push({
    label: "ATTACHE.Menu.OpenCase",
    icon: "fa-solid fa-briefcase",
    group: MODULE_ID,
    visible: (li) => {
      const actor = actorOf(li);
      return isSupportedActor(actor) && actor.testUserPermission(game.user, "OBSERVER");
    },
    onClick: (_event, li) => AttacheCaseApp.open(actorOf(li))
  });
}

/** Keybinding: the assigned character, else the first controlled token's actor. Toggles. */
function onOpenKey() {
  if (!isSupportedSystem()) return false;
  const actor = game.user.character ?? canvas?.tokens?.controlled?.[0]?.actor ?? null;
  if (!actor) {
    notify("warn", "ATTACHE.Notify.NoActor");
    return true;
  }
  const open = AttacheCaseApp.get(actor);
  if (open?.rendered && !open.minimized && ui.activeWindow === open) open.close();
  else AttacheCaseApp.open(actor);
  return true;
}

/** Register the keybinding. Call during `init`. */
export function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "open", {
    name: "ATTACHE.Settings.OpenKey.Name",
    hint: "ATTACHE.Settings.OpenKey.Hint",
    editable: [{ key: "KeyI" }],
    onDown: onOpenKey,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}

/**
 * CoC7 (on `ready`) asks the GM to run its world migration for every module that ships CoC7 Item
 * packs and is not recorded in its `systemUpdatedModuleVersion` world setting, and shows players a
 * blocking "wait for your GM" prompt meanwhile, on every load. Our pack only holds plain container
 * items with nothing to migrate. World settings cannot be written before `ready`, so every client
 * marks our version as current in its local copy of the setting during `setup` (never persisted).
 */
function markCoC7PacksCurrent() {
  const key = "systemUpdatedModuleVersion";
  const config = game.system.id === "CoC7" ? game.settings.settings.get(`CoC7.${key}`) : null;
  const version = game.modules.get(MODULE_ID)?.version;
  if (!config || !version) return;
  const doc = game.settings.get("CoC7", key, { document: true });
  const known = doc.value && typeof doc.value === "object" ? doc.value : {};
  if (known[MODULE_ID] === version) return;
  const value = { ...known, [MODULE_ID]: version };
  if (doc.id) doc.updateSource({ value: JSON.stringify(value) });
  else config.default = value;
}

/** Register every hook. Call during `init`. */
export function registerHooks() {
  Hooks.once("setup", markCoC7PacksCurrent);
  Hooks.on("preCreateItem", onPreCreateItem);
  Hooks.on("createItem", onCreateItem);
  Hooks.on("updateItem", onUpdateItem);
  Hooks.on("deleteItem", onDeleteItem);
  Hooks.on("createActor", onCreateActor);
  Hooks.on("updateActor", onUpdateActor);
  Hooks.on("dnd5e.getAsGear", onGetAsGear);
  Hooks.on("deleteActor", (actor) => {
    cancelPack(actor);
    AttacheCaseApp.get(actor)?.close();
    for (const item of actor.items) closeItemDialogs(item);
  });
  Hooks.on("getHeaderControlsActorSheetV2", onActorSheetControls);
  Hooks.on("getHeaderControlsItemSheetV2", onItemSheetControls);
  // dnd5e's ItemSheet5e and ContainerSheet extend DocumentSheetV2, not ItemSheetV2.
  Hooks.on("getHeaderControlsItemSheet5e", onItemSheetControls);
  Hooks.on("getActorContextOptions", onActorContextOptions);
}

/** Used by main.mjs once the game is ready. */
export function warnIfUnsupported() {
  if (!isSupportedSystem()) {
    console.warn(`${MODULE_ID} | ${loc("ATTACHE.Notify.Unsupported")}`);
  }
}
