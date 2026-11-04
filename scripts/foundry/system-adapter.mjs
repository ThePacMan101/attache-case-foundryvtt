/**
 * Per-system knowledge: which systems are supported, which item types are physical / armor,
 * which item type is used for generic container items, and how to build the core size
 * descriptor from a Foundry Item.
 */

import { MODULE_ID, FLAGS, DEFAULT_BODY } from "../constants.mjs";
import { resolveArt, sanitizeArt } from "../core/art.mjs";
import { describeDnd5e } from "../core/dnd5e.mjs";
import { CONTAINER_PRESETS, DND5E_PRESETS } from "../data/container-presets.mjs";
import { DEFAULT_REGISTRY } from "../data/default-sizes.mjs";
import { loc } from "./util.mjs";

/**
 * @typedef {object} SystemProfile
 * @property {string[]} physicalTypes item types that take space (from DEFAULT_REGISTRY)
 * @property {string[]} armorTypes item types that may be worn
 * @property {string} containerType item type used for preset containers
 * @property {(description: string) => object} describe builds the `system` data of a new
 *   container item (the two systems store descriptions differently)
 * @property {(item: Item) => string|null} coreId stable system-specific identity
 * @property {{cols:number, rows:number}} defaultBody body grid when the GM saved no other value
 * @property {ReadonlyArray<object>} presets containers offered in the Configure dialog
 * @property {string[]} [actorTypes] supported actor types; unset = all
 * @property {string[]} [visibleSystemKeys] `system.*` keys whose change re-renders the case
 * @property {(item: Item, user: User) => boolean} [concealsArt] whether this user must not see the
 *   item's chosen image; unset = never
 * @property {(item: Item) => object} [describeExtras] extra size descriptor fields (core/sizes.mjs)
 * @property {(item: Item) => number} [quantity] stack size for the badge; unset = no stacks
 * @property {(item: Item, user: User) => string} [displayName] the name this user sees; unset = `item.name`
 */

/** @type {Readonly<Record<string, SystemProfile>>} */
const PROFILES = Object.freeze({
  CoC7: Object.freeze({
    physicalTypes: DEFAULT_REGISTRY.physicalTypes.CoC7,
    armorTypes: ["armor"],
    containerType: "item",
    describe: (description) => ({ description: { value: description } }),
    coreId: (item) => item.flags?.CoC7?.cocidFlag?.id || null,
    defaultBody: DEFAULT_BODY,
    presets: CONTAINER_PRESETS
  }),
  deltagreen: Object.freeze({
    physicalTypes: DEFAULT_REGISTRY.physicalTypes.deltagreen,
    armorTypes: ["armor"],
    containerType: "gear",
    describe: (description) => ({ description }),
    coreId: () => null,
    defaultBody: DEFAULT_BODY,
    presets: CONTAINER_PRESETS
  }),
  dnd5e: Object.freeze({
    physicalTypes: DEFAULT_REGISTRY.physicalTypes.dnd5e,
    armorTypes: [],
    containerType: "container",
    describe: (description) => ({ description: { value: description } }),
    coreId: () => null,
    defaultBody: Object.freeze({ cols: 8, rows: 5 }),
    presets: DND5E_PRESETS,
    actorTypes: ["character", "npc", "vehicle"],
    visibleSystemKeys: ["container", "equipped", "quantity", "identified", "weight", "type", "capacity", "unidentified", "properties"],
    describeExtras: describeDnd5e,
    quantity: (item) => (Number.isInteger(item?.system?.quantity) ? item.system.quantity : 1),
    // dnd5e swaps `item.name` for a filled unidentified name, for everyone. An empty one leaves the real name
    // in `item.name`, which a player must not read here.
    displayName: (item, user) => (!user?.isGM && item?.system?.identified === false && !item.system.unidentified?.name
      ? loc("ATTACHE.Window.Unidentified")
      : item?.name ?? ""),
    // A chosen image could name an item the player has not identified. dnd5e shows `item.img` to
    // everyone, so that one is not a new leak.
    concealsArt: (item, user) => !user?.isGM && item?.system?.identified === false
  })
});

/** @returns {string} the active system id */
export function systemId() {
  return game.system.id;
}

/**
 * @param {string} [id] system id, default the active system
 * @returns {boolean}
 */
export function isSupportedSystem(id = systemId()) {
  return Object.hasOwn(PROFILES, id);
}

/** @returns {SystemProfile|null} profile of the active system */
export function profile() {
  return PROFILES[systemId()] ?? null;
}

/** @returns {string[]} ids of every supported system */
export function supportedSystems() {
  return Object.keys(PROFILES);
}

/**
 * Whether the module should act on this actor at all.
 * @param {Actor|null|undefined} actor
 * @returns {boolean}
 */
export function isSupportedActor(actor) {
  if (!actor || actor.documentName !== "Actor" || !isSupportedSystem()) return false;
  const types = profile().actorTypes;
  return !types || types.includes(actor.type);
}

/**
 * The body grid of a system when the GM saved no other value.
 * @param {string} id system id
 * @returns {Readonly<{cols:number, rows:number}>}
 */
export function defaultBodyFor(id) {
  return Object.hasOwn(PROFILES, id) ? PROFILES[id].defaultBody : DEFAULT_BODY;
}

/** @returns {ReadonlyArray<object>} the container presets of the active system */
export function containerPresets() {
  return profile()?.presets ?? CONTAINER_PRESETS;
}

/**
 * Whether an item type may be worn (armor) in the active system.
 * @param {Item} item
 * @returns {boolean}
 */
export function isArmor(item) {
  return Boolean(profile()?.armorTypes.includes(item?.type));
}

/**
 * Our flags of an item (or raw item data), read defensively.
 * @param {Item|object} item
 * @returns {object}
 */
export function moduleFlags(item) {
  const flags = item?.flags?.[MODULE_ID];
  return flags && typeof flags === "object" ? flags : {};
}

/** @returns {string[]} what core accepts as an image file */
export function imageExtensions() {
  return Object.keys(CONST.IMAGE_FILE_EXTENSIONS);
}

/**
 * Validate a value for the `art` flag.
 * @param {*} value
 * @returns {string|null} the clean path, or null when it cannot be used
 */
export function cleanArt(value) {
  return sanitizeArt(value, imageExtensions());
}

/**
 * The image a user sees for an item, with what to try if that file does not load.
 * @param {Item|object} item
 * @param {User} [user]
 * @returns {{src:string, fallback:string}}
 */
export function displayImg(item, user = game.user) {
  const conceal = Boolean(profile()?.concealsArt?.(item, user));
  return resolveArt({ art: moduleFlags(item)[FLAGS.ART], img: item?.img }, { conceal, extensions: imageExtensions() });
}

/**
 * The name a user sees for an item.
 * @param {Item|object} item
 * @param {User} [user]
 * @returns {string}
 */
export function displayName(item, user = game.user) {
  const custom = profile()?.displayName;
  return custom ? custom(item, user) : item?.name ?? "";
}

/**
 * How many of this item the stack holds; 1 on systems without stacks. Never changes its size.
 * @param {Item|object} item
 * @returns {number}
 */
export function itemQuantity(item) {
  return profile()?.quantity?.(item) ?? 1;
}

/**
 * A stack's number as its badge shows it: at most 3 characters, so that it stays inside a one-cell tile.
 * @param {number} quantity
 * @returns {string}
 */
export function quantityLabel(quantity) {
  if (quantity < 1000) return String(quantity);
  return quantity < 1000000 ? `${Math.floor(quantity / 1000)}k` : `${Math.floor(quantity / 1000000)}M`;
}

/**
 * Whether a user may choose an item's image: whoever owns the item, unless its current image is
 * concealed from them (the dialog would show the path, and saving would overwrite it).
 * @param {Item} item
 * @param {User} [user]
 * @returns {boolean}
 */
export function canEditArt(item, user = game.user) {
  if (!item?.isOwner || item.compendium?.locked) return false;
  return !profile()?.concealsArt?.(item, user);
}

/**
 * Build the core size descriptor for an Item document or raw item data.
 * @param {Item|object} item
 * @returns {{type:string, name:string, systemId:string, sourceId:string|null, coreId:string|null,
 *   flags:{size?:object, excluded?:boolean, container?:object}}} plus the profile's `describeExtras`
 */
export function describe(item) {
  const flags = moduleFlags(item);
  return {
    type: item?.type,
    name: item?.name ?? "",
    systemId: systemId(),
    sourceId: item?._stats?.compendiumSource || null,
    coreId: profile()?.coreId(item) ?? null,
    flags: {
      size: flags[FLAGS.SIZE],
      excluded: flags[FLAGS.EXCLUDED],
      container: flags[FLAGS.CONTAINER]
    },
    ...profile()?.describeExtras?.(item)
  };
}

/**
 * Creation data for a container item of the active system.
 * @param {{name:string, description?:string, img?:string, cols:number, rows:number, system?:object}} spec
 *   name/description already localized; `system` is what a preset adds to the item's data
 * @returns {object|null} null on unsupported systems
 */
export function containerItemData({ name, description = "", img, cols, rows, system }) {
  const p = profile();
  if (!p) return null;
  const data = {
    name,
    type: p.containerType,
    system: { ...p.describe(description ? `<p>${foundry.utils.escapeHTML(description)}</p>` : ""), ...foundry.utils.deepClone(system) },
    flags: { [MODULE_ID]: { [FLAGS.CONTAINER]: { cols, rows } } }
  };
  if (img) data.img = img;
  return data;
}
