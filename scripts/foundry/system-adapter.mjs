/**
 * Per-system knowledge: which systems are supported, which item types are physical / armor,
 * which item type is used for generic container items, and how to build the core size
 * descriptor from a Foundry Item.
 */

import { MODULE_ID, FLAGS } from "../constants.mjs";
import { resolveArt } from "../core/art.mjs";
import { defaultBodyFor } from "../core/body-defaults.mjs";
import { CONTAINER_PRESETS } from "../data/container-presets.mjs";
import { DEFAULT_REGISTRY } from "../data/default-sizes.mjs";

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
 */

/** Temporary dnd5e list, chosen from the modern presets until the fantasy list arrives. */
const DND5E_PRESET_KEYS = new Set(["beltPouch", "satchel", "backpack", "duffelBag"]);

/** @type {Readonly<Record<string, SystemProfile>>} */
const PROFILES = Object.freeze({
  CoC7: Object.freeze({
    physicalTypes: DEFAULT_REGISTRY.physicalTypes.CoC7,
    armorTypes: ["armor"],
    containerType: "item",
    describe: (description) => ({ description: { value: description } }),
    coreId: (item) => item.flags?.CoC7?.cocidFlag?.id || null,
    defaultBody: defaultBodyFor("CoC7"),
    presets: CONTAINER_PRESETS
  }),
  deltagreen: Object.freeze({
    physicalTypes: DEFAULT_REGISTRY.physicalTypes.deltagreen,
    armorTypes: ["armor"],
    containerType: "gear",
    describe: (description) => ({ description }),
    coreId: () => null,
    defaultBody: defaultBodyFor("deltagreen"),
    presets: CONTAINER_PRESETS
  }),
  dnd5e: Object.freeze({
    physicalTypes: DEFAULT_REGISTRY.physicalTypes.dnd5e,
    armorTypes: [],
    containerType: "container",
    describe: (description) => ({ description: { value: description } }),
    coreId: () => null,
    defaultBody: defaultBodyFor("dnd5e"),
    presets: CONTAINER_PRESETS.filter((p) => DND5E_PRESET_KEYS.has(p.key)),
    actorTypes: ["character", "npc", "vehicle"],
    visibleSystemKeys: ["identified"],
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

/**
 * The image a user sees for an item, with what to try if that file does not load.
 * @param {Item|object} item
 * @param {User} [user]
 * @returns {{src:string, fallback:string}}
 */
export function displayImg(item, user = game.user) {
  const conceal = Boolean(profile()?.concealsArt?.(item, user));
  return resolveArt({ art: moduleFlags(item)[FLAGS.ART], img: item?.img }, { conceal });
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
 *   flags:{size?:object, excluded?:boolean, container?:object}}}
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
    }
  };
}

/**
 * Creation data for a container item of the active system.
 * @param {{name:string, description?:string, img?:string, cols:number, rows:number}} spec
 *   name/description already localized
 * @returns {object|null} null on unsupported systems
 */
export function containerItemData({ name, description = "", img, cols, rows }) {
  const p = profile();
  if (!p) return null;
  const data = {
    name,
    type: p.containerType,
    system: p.describe(description ? `<p>${foundry.utils.escapeHTML(description)}</p>` : ""),
    flags: { [MODULE_ID]: { [FLAGS.CONTAINER]: { cols, rows } } }
  };
  if (img) data.img = img;
  return data;
}
