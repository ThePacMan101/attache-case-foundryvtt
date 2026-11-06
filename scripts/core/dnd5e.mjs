/**
 * What dnd5e and Plutonium data say about an item: identity, weight, whether it is an object at all,
 * and whether a native container is a real bag. Pure module, no Foundry globals. Every function takes an
 * Item document or raw item data, and reads `system` defensively: `container` items have no `system.type`,
 * and `loot` has no `equipped`.
 */

import { FLAGS, MAX_DIM, MODULE_ID } from "../constants.mjs";
import { DND5E_SIZES } from "../data/default-sizes-dnd5e.mjs";
import { normalizeName, sanitizeContainer } from "./sizes.mjs";

/** `CONFIG.DND5E.armorTypes`: equipment of these types may match armor and weapon base names. */
const ARMOR_TYPES = new Set(["light", "medium", "heavy", "natural", "shield"]);

/**
 * dnd5e's `baseItem` keys to the names of our size tables. Keyed on the string rather than on the
 * compendium UUID, which differs between the 2014 and 2024 rules. `net` exists only in the legacy table.
 */
export const BASE_ITEM_NAMES = Object.freeze({
  battleaxe: "battleaxe", blowgun: "blowgun", club: "club", dagger: "dagger", dart: "dart", flail: "flail", glaive: "glaive",
  greataxe: "greataxe", greatclub: "greatclub", greatsword: "greatsword", halberd: "halberd", handaxe: "handaxe",
  handcrossbow: "hand crossbow", heavycrossbow: "heavy crossbow", javelin: "javelin", lance: "lance", lightcrossbow: "light crossbow",
  lighthammer: "light hammer", longbow: "longbow", longsword: "longsword", mace: "mace", maul: "maul", morningstar: "morningstar",
  musket: "musket", net: "net", pike: "pike", pistol: "pistol", quarterstaff: "quarterstaff", rapier: "rapier", scimitar: "scimitar",
  shortsword: "shortsword", sickle: "sickle", spear: "spear", shortbow: "shortbow", sling: "sling", trident: "trident",
  warpick: "war pick", warhammer: "warhammer", whip: "whip",
  breastplate: "breastplate", chainmail: "chain mail", chainshirt: "chain shirt", halfplate: "half plate armor", hide: "hide armor",
  leather: "leather armor", padded: "padded armor", plate: "plate armor", ringmail: "ring mail", scalemail: "scale mail",
  splint: "splint armor", studded: "studded leather armor", shield: "shield",
  alchemist: "alchemist's supplies", bagpipes: "bagpipes", brewer: "brewer's supplies", calligrapher: "calligrapher's supplies",
  card: "playing card set", carpenter: "carpenter's tools", cartographer: "cartographer's tools", chess: "dragonchess set",
  cobbler: "cobbler's tools", cook: "cook's utensils", dice: "dice set", disg: "disguise kit", drum: "drum", dulcimer: "dulcimer",
  flute: "flute", forg: "forgery kit", glassblower: "glassblower's tools", herb: "herbalism kit", horn: "horn",
  jeweler: "jeweler's tools", leatherworker: "leatherworker's tools", lute: "lute", lyre: "lyre", mason: "mason's tools",
  navg: "navigator's tools", painter: "painter's supplies", panflute: "pan flute", pois: "poisoner's kit", potter: "potter's tools",
  shawm: "shawm", smith: "smith's tools", thief: "thieves' tools", tinker: "tinker's tools", viol: "viol", weaver: "weaver's tools",
  woodcarver: "woodcarver's tools",
  arrow: "arrow", crossbowBolt: "crossbow bolt", blowgunNeedle: "blowgun needle", slingBullet: "sling bullet", firearmBullet: "firearm bullet"
});

/** `CONFIG.DND5E.weightUnits` conversions to pounds. */
const POUNDS_PER_UNIT = Object.freeze({ lb: 1, tn: 2000, kg: 2.5, Mg: 2500 });

/** `CONFIG.DND5E.volumeUnits` conversions to cubic feet. */
const CUBIC_FEET_PER_UNIT = Object.freeze({ cubicFoot: 1, liter: 1 / 28.317 });

const UNARMED = new Set(["unarmed strike", "ataque desarmado", "golpe desarmado"]);

/** The one natural weapon that is an object you carry (2024 rules). */
const CARRIED_NATURAL = "clawed gauntlet";

/** Any weapon or armor name of ours as a whole word: `Spiked Bone Club`, but not `Clubbed Foot`. */
const BASE_WORD = new RegExp(`(?:^|[^a-z0-9])(?:${Object.keys(DND5E_SIZES.baseNames.dnd5e)
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|")})(?:$|[^a-z0-9])`);

/**
 * Split a Plutonium hash into its parts: `encodeURIComponent(name)_source`. Monster actions look like
 * `longsword_soldier_ggr_ggr`, and the last `_` still separates the source.
 * @param {*} hash
 * @returns {{name:string, source:string}|null} name decoded, lowercase as stored
 */
export function parsePlutoniumHash(hash) {
  if (typeof hash !== "string" || !hash) return null;
  const at = hash.lastIndexOf("_");
  const raw = at < 0 ? hash : hash.slice(0, at);
  if (!raw) return null;
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // A malformed escape is still the best name there is.
  }
  return { name, source: at < 0 ? "" : hash.slice(at + 1) };
}

/**
 * One unit's weight in pounds.
 * @param {*} weight `{value, units}`, or a bare number as Plutonium's currency item has it
 * @returns {number|null} null when unknown: 58% of Plutonium's catalog has weight 0
 */
export function weightInPounds(weight) {
  const value = typeof weight === "number" ? weight : weight?.value;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value * (POUNDS_PER_UNIT[weight?.units] ?? 1);
}

/** A `system.properties` holds: a Set at runtime, an array in raw data. */
function hasProperty(item, key) {
  const props = item?.system?.properties;
  if (props instanceof Set) return props.has(key);
  return Array.isArray(props) && props.includes(key);
}

/** The item's real name: dnd5e overwrites `item.name` with the fake one while unidentified. */
const realName = (item) => item?._source?.name ?? item?.name ?? "";

/** The name in the Plutonium hash, only where that hash names the item itself. A scroll's names its spell. */
function plutoniumItemName(item) {
  const { page, hash } = item?.flags?.plutonium ?? {};
  return page === "items.html" ? parsePlutoniumHash(hash)?.name ?? null : null;
}

/** `system.identifier` as a name; it is a slug of the name at creation, so it survives a rename. */
function identifierName(item) {
  const id = item?.system?.identifier;
  return typeof id === "string" && id && !id.includes(".") ? id.replace(/[-_]+/g, " ") : null;
}

/** Every normalized name an item goes by. */
const allNames = (item) => [realName(item), plutoniumItemName(item), identifierName(item)].filter(Boolean).map(normalizeName);

/** What the data says the item is; the name only when it says nothing, so that renaming one changes nothing. */
function identity(item) {
  const names = [plutoniumItemName(item), identifierName(item)].filter(Boolean);
  return (names.length ? names : [realName(item)].filter(Boolean)).map(normalizeName);
}

/**
 * Whether an item's own data says it is not an object anyone carries.
 * A natural attack can sit on any actor, a monster's real weapon keeps `page:"monsterAction"` and has a
 * weight, and dnd5e's own encumbrance skips siege weapons and vehicle equipment. A legacy pack monster
 * has weightless weapons with no mark at all: only the name tells a Scimitar from a Tail Attack.
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isNoSpace(item) {
  const value = item?.system?.type?.value;
  if (item?.type === "equipment") return value === "vehicle";
  if (item?.type !== "weapon") return false;
  const names = allNames(item);
  if (names.includes(CARRIED_NATURAL)) return false;
  if (value === "natural" || value === "siege" || names.some((n) => UNARMED.has(n))) return true;
  if (weightInPounds(item.system?.weight) !== null) return false;
  if (item.flags?.plutonium?.page === "monsterAction") return true;
  return item.parent?.type === "npc" && !hasProperty(item, "gear") && !item.system?.type?.baseItem && !names.some((n) => BASE_WORD.test(n));
}

/**
 * The extra size descriptor fields of a dnd5e item (see scripts/core/sizes.mjs). Nothing here reads the
 * visible name, so identifying an item never changes its size.
 * @param {Item|object} item
 * @returns {{name:string, identityNames:string[], hashName:string|null, baseMatch:boolean,
 *   subtype:string|null, weight:number|null, noSpace:boolean}}
 */
export function describeDnd5e(item) {
  const type = item?.type;
  const { value, subtype, baseItem } = item?.system?.type ?? {};
  const hashName = plutoniumItemName(item);
  const identityNames = [hashName, baseItem ? BASE_ITEM_NAMES[baseItem] ?? baseItem : null, identifierName(item)].filter(Boolean);
  return {
    name: realName(item),
    identityNames: [...new Set(identityNames)],
    hashName,
    baseMatch: type === "weapon" || (type === "equipment" && ARMOR_TYPES.has(value)),
    subtype: value ? [type, value, subtype].filter(Boolean).join(":") : null,
    weight: weightInPounds(item?.system?.weight),
    noSpace: isNoSpace(item)
  };
}

/** Holders of one kind of thing, in English and Portuguese. Whole words, on normalized names. */
const VESSELS = /(?:^|[^a-z0-9])(?:waterskin|jugs?|pots?|pitchers?|buckets?|tankards?|flasks?|vials?|bottles?|quivers?|compartments?|bolt case|case, crossbow bolt|scroll case|map case|map or scroll case|case, map or scroll|odres?|jarros?|jarras?|panelas?|baldes?|canecas?|frascos?|ampolas?|garrafas?|aljavas?|estojos?)(?:$|[^a-z0-9])/;

/** A capacity no vessel has: the largest real one, a Bucket, holds 25 lb. */
const REAL_CAPACITY_LB = 30;

/** Below this a named bag is a pocket, not a grid: Pouch holds exactly 6 lb, Jug 8.4 by the vessel rule. */
const MIN_BAG_LB = 6;

/** Cubic feet to pounds, only to choose a band: 1 cu ft is about what a 30 lb backpack holds. */
const LB_PER_CUBIC_FOOT = 30;

/** Exact names: the grid of the bag, as opposed to `Left Pouch` or `Explorer's Pack`. */
const BAG_NAMES = Object.freeze({
  pouch: { cols: 3, rows: 2 },
  sack: { cols: 6, rows: 4 },
  backpack: { cols: 8, rows: 6 },
  basket: { cols: 6, rows: 5 },
  saddlebags: { cols: 8, rows: 5 },
  chest: { cols: 12, rows: 8 },
  barrel: { cols: 8, rows: 8 },
  "bag of holding": { cols: 12, rows: 8 },
  // The same bag in both rule sets, one with 120 lb and one with no capacity; its pouches fit inside it.
  "handy haversack": { cols: 8, rows: 6 },
  "left pouch": { cols: 4, rows: 3 },
  "right pouch": { cols: 4, rows: 3 },
  "central pouch": { cols: 6, rows: 4 }
});

/** Grid by capacity; the 30 lb "Packs" have to reach Backpack size for their contents to fit. */
const BAG_BANDS = Object.freeze([
  { max: 6, cols: 3, rows: 2 },
  { max: 12, cols: 4, rows: 3 },
  { max: 20, cols: 6, rows: 4 },
  { max: 60, cols: 8, rows: 6 },
  { max: 150, cols: 8, rows: 8 },
  { max: Infinity, cols: 12, rows: 8 }
]);

/** The grid of a magic bag that states no capacity. */
const WEIGHTLESS_BAG = Object.freeze({ cols: 8, rows: 6 });

/**
 * What a bag's data says it holds.
 * @param {Item|object} item
 * @returns {{pounds:number, cubicFeet:number, total:number}} each 0 when not stated; `total` is the larger of
 *   the two, in pounds, for choosing a band
 */
function capacityPounds(item) {
  const { weight, volume } = item?.system?.capacity ?? {};
  const pounds = weightInPounds(weight) ?? 0;
  const value = volume?.value;
  const cubicFeet = typeof value === "number" && value > 0 ? value * (CUBIC_FEET_PER_UNIT[volume.units] ?? 1) : 0;
  return { pounds, cubicFeet, total: Math.max(pounds, cubicFeet * LB_PER_CUBIC_FOOT) };
}

/**
 * Whether a native container holds one kind of thing rather than being a bag (D-004). Matched over the
 * identifier too, so that a Jug renamed "Jarro" stays one.
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isVessel(item) {
  return identity(item).some((n) => VESSELS.test(n));
}

/** The module's `container` flag: dims, `false` for "not a bag", or undefined. */
const containerFlag = (item) => item?.flags?.[MODULE_ID]?.[FLAGS.CONTAINER];

/** Whether a native container's own data makes it a bag. Vessels win unless the capacity is real. */
function isAutoBag(item) {
  if (item?.type !== "container" && item?.type !== "backpack") return false;
  const { pounds, cubicFeet } = capacityPounds(item);
  if (isVessel(item)) return pounds >= REAL_CAPACITY_LB || cubicFeet >= 1;
  return hasProperty(item, "weightlessContents") || pounds >= MIN_BAG_LB || cubicFeet >= 1;
}

/**
 * Whether an item gets a grid (D-004, PLAN A7).
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isBag(item) {
  const flag = containerFlag(item);
  if (flag === false) return false;
  return Boolean(sanitizeContainer(flag)) || isAutoBag(item);
}

/**
 * The grid a native container's own data gives it, whatever the module's flag says: exact name, else capacity.
 * @param {Item|object} item
 * @returns {{cols:number, rows:number}|null} null when its data does not make it a bag
 */
export function autoBagDims(item) {
  if (!isAutoBag(item)) return null;
  for (const name of identity(item)) {
    if (Object.hasOwn(BAG_NAMES, name)) return { ...BAG_NAMES[name] };
  }
  const { total } = capacityPounds(item);
  if (!total) return { ...WEIGHTLESS_BAG };
  const { cols, rows } = BAG_BANDS.find((band) => total <= band.max);
  return { cols: Math.min(cols, MAX_DIM), rows: Math.min(rows, MAX_DIM) };
}

/**
 * The grid of a bag: flag, else exact name, else capacity.
 * @param {Item|object} item
 * @returns {{cols:number, rows:number}|null} null when it is not a bag
 */
export function bagDims(item) {
  const flag = containerFlag(item);
  if (flag === false) return null;
  return sanitizeContainer(flag) ?? autoBagDims(item);
}

/** The equipment types worn on the body. `CONFIG.DND5E.armorTypes`, plus `clothing` from `miscEquipmentTypes`. */
const WORN_TYPES = new Set([...ARMOR_TYPES, "clothing"]);

/** Plutonium has no `clothing`: clothes arrive as `trinket`, so only their name says what they are. */
const CLOTHES = /(?:^|[^a-z0-9])(?:clothes|clothing|robes?|costumes?|vestments?|roupas?|trajes?|vestes?|tunicas?)(?:$|[^a-z0-9])/;

/** dnd5e's 2014 `clothing` also holds what a horse wears. */
const TACK = /(?:^|[^a-z0-9])(?:saddles?|bridles?|barding|harness|selas?|arreios?)(?:$|[^a-z0-9])/;

/**
 * Whether an item goes in the Worn strip when equipped (D-005). Plutonium marks Tinderbox, Rope and every weapon
 * as equipped, so `equipped` alone cannot say it.
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isWearable(item) {
  if (item?.type !== "equipment") return false;
  const names = identity(item);
  if (names.some((n) => TACK.test(n))) return false;
  return WORN_TYPES.has(item.system?.type?.value) || names.some((n) => CLOTHES.test(n));
}

/**
 * Make item data ready to be created on another actor: what says it is being carried stays behind. Mutates and
 * returns `data`. The first entry loses `equipped`, so that dnd5e chooses by the receiver, as on a sheet drop (d:57594).
 * Anything inside it keeps `false` where it had the key: dnd5e resets only the first entry, and an absent key on an npc
 * means equipped (d:13929), so armor in a bag would raise that npc's AC.
 * @param {object} data
 * @param {object} [options]
 * @param {boolean} [options.give=false] a give, not a drop: Plutonium's drop prompt must not cancel the create (D-006)
 * @param {boolean} [options.root=true] the item itself, not something inside it
 * @returns {object}
 */
export function cleanCopy(data, { give = false, root = true } = {}) {
  const { system } = data;
  if (system) {
    delete system.attuned;
    if (system.crew) delete system.crew.value;
    if (root) delete system.equipped;
    else if ("equipped" in system) system.equipped = false;
  }
  const plutonium = data.flags?.plutonium;
  if (give && plutonium?.propDroppable) plutonium.isStandardDragDrop = true;
  return data;
}
