/**
 * Foundry hooks: auto-placement, re-rendering of open windows, header controls, the Actor
 * Directory context menu and the keybinding. Automatic writes happen only on the client that
 * caused the change (`userId === game.user.id`).
 */

import { MODULE_ID, FLAGS } from "../constants.mjs";
import { canMove, findSpot, withPlacement } from "../core/layout.mjs";
import { isSupportedActor, isSupportedSystem, moduleFlags } from "./system-adapter.mjs";
import { getState, itemSize, isWorn, packUnstowed } from "./inventory.mjs";
import { autoPlaceEnabled, canEditSizes } from "../settings.mjs";
import { loc, notify, flagPath } from "./util.mjs";
import { AttacheCaseApp } from "../apps/attache-case-app.mjs";
import { ActorConfig } from "../apps/actor-config.mjs";
import { ItemSizeConfig } from "../apps/item-size-config.mjs";

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

/** The actor's current layout plus the pending reservations. */
function layoutWithReservations(actor) {
  let { layout } = getState(actor);
  for (const r of reservations.get(actor.uuid)?.items ?? []) {
    layout = withPlacement(layout, r.key, r.size, r.pos) ?? layout;
  }
  return layout;
}

/** Whether a create operation was issued by us with an explicit placement. */
const isOwnCreate = (options) => Boolean(options?.[MODULE_ID]?.placed);

function onPreCreateItem(item, _data, options, userId) {
  if (userId !== game.user.id || isOwnCreate(options) || !autoPlaceEnabled()) return;
  const actor = item.parent;
  if (!isSupportedActor(actor) || actor.pack) return;
  const info = itemSize(item);
  if (!info.size || info.container || isWorn(item)) return;
  const layout = layoutWithReservations(actor);
  const pos = moduleFlags(item)[FLAGS.POS];
  if (pos && canMove(layout, "\u0000new", info.size, pos)) {
    reserve(actor, info.size, pos);
    return;
  }
  const spot = findSpot(layout, null, info.size);
  // A pos copied from another actor means nothing here: drop it so it cannot "come back" later.
  if (spot || pos !== undefined) item.updateSource({ [flagPath(FLAGS.POS)]: spot ?? null });
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
  entry.names.push(item.name);
}

function onCreateItem(item, options, userId) {
  const actor = item.parent;
  if (!isSupportedActor(actor)) return;
  refresh(actor, item);
  if (userId !== game.user.id) return;
  releaseReservations(actor);
  if (actor.pack || !autoPlaceEnabled()) return;
  const info = itemSize(item);
  if (info.container) {
    packUnstowed(actor).catch((err) => console.error(`${MODULE_ID} |`, err));
    return;
  }
  if (isOwnCreate(options) || !info.size || isWorn(item)) return;
  const { layout } = getState(actor);
  if (!layout.placed.has(item.id)) reportUnplaced(actor, item);
}

function onUpdateItem(item, changed, _options, userId) {
  const actor = item.parent;
  if (!isSupportedActor(actor)) return;
  refresh(actor, item, changed);
  if (userId !== game.user.id || actor.pack || !autoPlaceEnabled()) return;
  const became = foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${FLAGS.CONTAINER}`) && itemSize(item).container;
  if (!became) return;
  // Items displaced by shrinking this container keep their pos (architecture contract: growing
  // it back restores them), so only the other unstowed items are packed.
  const only = getState(actor).overflow.filter((i) => moduleFlags(i)[FLAGS.POS]?.c !== item.id).map((i) => i.id);
  if (only.length) packUnstowed(actor, { only }).catch((err) => console.error(`${MODULE_ID} |`, err));
}

function onDeleteItem(item) {
  const actor = item.parent;
  if (isSupportedActor(actor)) refresh(actor, item);
}

function onCreateActor(actor, _options, userId) {
  if (userId !== game.user.id || actor.pack || !isSupportedActor(actor) || !autoPlaceEnabled()) return;
  if (!actor.items.size) return;
  packUnstowed(actor).catch((err) => console.error(`${MODULE_ID} |`, err));
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
    if (changed && !ours && !VISIBLE_KEYS.some((k) => k in changed)) return;
    // The GM dialog has unsaved inputs: a player moving an item (pos/worn) must not wipe them.
    const configKeys = Object.keys(changed?.flags?.[MODULE_ID] ?? {}).filter((k) => !PLACEMENT_KEYS.has(k.replace(/^-=/, "")));
    if (info.container || configKeys.length) ActorConfig.refreshFor(actor);
  }
  AttacheCaseApp.refreshFor(actor);
}

/** Item flags that only record where an item sits. */
const PLACEMENT_KEYS = new Set([FLAGS.POS, FLAGS.WORN]);

function onUpdateActor(actor, changed) {
  if (!isSupportedActor(actor)) return;
  if (["name", "img", "ownership", "flags"].some((k) => k in changed)) AttacheCaseApp.refreshFor(actor);
  if ("name" in changed || changed.flags?.[MODULE_ID]) ActorConfig.refreshFor(actor);
}

/* -------------------------------------------- */
/*  Entry points: header controls, menus, keys  */
/* -------------------------------------------- */

const OPEN_ACTION = "attacheCaseOpen";
const SIZE_ACTION = "attacheCaseItemSize";

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
  if (!isSupportedSystem() || !item || controls.some((c) => c.action === SIZE_ACTION)) return;
  const info = itemSize(item);
  if ((info.source === "nonPhysical" && !info.container) || !canEditSizes(item)) return;
  const handler = () => ItemSizeConfig.open(item);
  app.options.actions[SIZE_ACTION] ??= handler;
  controls.push({ action: SIZE_ACTION, icon: "fa-solid fa-ruler-combined", label: "ATTACHE.Menu.ItemSize", visible: true, onClick: handler });
}

function onActorContextOptions(app, entries) {
  if (app instanceof foundry.applications.sidebar.apps.Compendium || !isSupportedSystem()) return;
  const actorOf = (li) => game.actors.get(li.dataset.entryId);
  entries.push({
    label: "ATTACHE.Menu.OpenCase",
    icon: "fa-solid fa-briefcase",
    group: MODULE_ID,
    visible: (li) => Boolean(actorOf(li)?.testUserPermission(game.user, "OBSERVER")),
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
  Hooks.on("deleteActor", (actor) => AttacheCaseApp.get(actor)?.close());
  Hooks.on("getHeaderControlsActorSheetV2", onActorSheetControls);
  Hooks.on("getHeaderControlsItemSheetV2", onItemSheetControls);
  Hooks.on("getActorContextOptions", onActorContextOptions);
}

/** Used by main.mjs once the game is ready. */
export function warnIfUnsupported() {
  if (!isSupportedSystem()) {
    console.warn(`${MODULE_ID} | ${loc("ATTACHE.Notify.Unsupported")}`);
  }
}
