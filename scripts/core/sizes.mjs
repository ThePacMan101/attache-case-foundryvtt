/**
 * Size resolution: which items take space, and how much.
 * Pure module — no Foundry globals.
 *
 * ## Registry shape
 * A registry is a plain object; every table is optional.
 * `systemId` keys may be `"*"` to apply to every system (system-specific entries win).
 * A size entry is `{w, h}` (also accepted: `"3x4"` or `[3, 4]`) or the string `"excluded"`
 * (a physical-type item that takes no space, e.g. unarmed attacks). Malformed entries are ignored.
 *
 * ```js
 * registry = {
 *   // Item types that occupy space. A system with no list (and no "*") has no physical items.
 *   physicalTypes: { [systemId]: string[] },
 *   // Exact identity: CoC7 `flags.CoC7.cocidFlag.id` (descriptor.coreId) or a compendium source
 *   // UUID (descriptor.sourceId). For `Compendium.*` UUIDs the bare trailing document id is
 *   // also tried, so `{ "JQEMyFfCHx38gupS": "excluded" }` matches
 *   // `Compendium.deltagreen.hand-to-hand-weapons.Item.JQEMyFfCHx38gupS`.
 *   byId:     { [systemId]: { [coreIdOrSourceId]: {w,h} | "excluded" } },
 *   // Exact name. Keys and item names are compared after normalizeName()
 *   // (lowercase, accents stripped, whitespace collapsed).
 *   byName:   { [systemId]: { [name]: {w,h} | "excluded" } },
 *   // Ordered; the first match wins. `pattern` is a RegExp (or a string, compiled with "i"),
 *   // tested against the raw name and the normalized name. `systems`/`types` restrict it.
 *   keywords: [{ systems?: string[], types?: string[], pattern: RegExp|string, size: {w,h} | "excluded" }],
 *   // Fallback per item type.
 *   byType:   { [systemId]: { [itemType]: {w,h} | "excluded" } },
 * }
 * ```
 *
 * ## Descriptor shape
 * `{type, name, systemId, sourceId?, coreId?, flags: {size?, excluded?, container?}}`
 * where `flags` are this module's item flags.
 *
 * ## Precedence (resolveSize)
 * non-physical type -> null; `flags.container` -> null; `flags.excluded === true` -> null;
 * `flags.size` -> byId(coreId) -> byId(sourceId) -> byName -> first matching keyword -> byType
 * -> `{w:1, h:1}`.
 * An explicit `flags.excluded === false` means the GM wants the item to take space: registry
 * `"excluded"` entries are then skipped and resolution continues with the next candidate.
 *
 * Registries are treated as immutable once passed in (compiled lookups are cached per object);
 * build new ones with mergeRegistries().
 */

import { FALLBACK_SIZE, MAX_DIM } from "../constants.mjs";

/** Registry value marking an item as taking no space. */
export const EXCLUDED = "excluded";

const ANY = "*";

/**
 * Coerce one dimension to an integer in [min, max]. Returns null for garbage.
 * @param {*} v
 * @param {number} min
 * @param {number} max
 * @returns {number|null}
 */
function sanitizeDim(v, min, max) {
  if (typeof v === "string" && v.trim() !== "") v = Number(v);
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Normalize a size value to `{w, h}` with integers clamped to [1, MAX_DIM].
 * Accepts `{w, h}` (numbers or numeric strings), `[w, h]` or `"WxH"`.
 * @param {*} value
 * @returns {{w:number, h:number}|null} null when the value is not a usable size
 */
export function sanitizeSize(value) {
  let w;
  let h;
  if (Array.isArray(value)) [w, h] = value;
  else if (typeof value === "string") {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i.exec(value);
    if (!m) return null;
    [w, h] = [m[1], m[2]];
  } else if (value && typeof value === "object") ({ w, h } = value);
  else return null;
  w = sanitizeDim(w, 1, MAX_DIM);
  h = sanitizeDim(h, 1, MAX_DIM);
  return w === null || h === null ? null : { w, h };
}

/**
 * Normalize container/body grid dimensions to `{cols, rows}` clamped to [min, MAX_DIM].
 * @param {*} value `{cols, rows}`
 * @param {object} [options]
 * @param {number} [options.min=1] use 0 for the body grid (0x0 = no body grid)
 * @returns {{cols:number, rows:number}|null}
 */
export function sanitizeContainer(value, { min = 1 } = {}) {
  if (!value || typeof value !== "object") return null;
  const cols = sanitizeDim(value.cols, min, MAX_DIM);
  const rows = sanitizeDim(value.rows, min, MAX_DIM);
  return cols === null || rows === null ? null : { cols, rows };
}

/**
 * Canonical form used for name comparisons: lowercase, diacritics stripped, whitespace collapsed.
 * @param {*} name
 * @returns {string}
 */
export function normalizeName(name) {
  if (typeof name !== "string") return "";
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** @returns {{w:number,h:number}|"excluded"|null} */
function sanitizeEntry(entry) {
  if (entry === EXCLUDED) return EXCLUDED;
  const size = sanitizeSize(entry);
  return size ? Object.freeze(size) : null;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Compile `{system: {key: entry}}` into `Map<system, Map<key, entry>>`. */
function compileTable(table, keyFn = (k) => k) {
  const out = new Map();
  if (!isPlainObject(table)) return out;
  for (const [system, entries] of Object.entries(table)) {
    if (!isPlainObject(entries)) continue;
    const map = new Map();
    for (const [key, raw] of Object.entries(entries)) {
      const entry = sanitizeEntry(raw);
      const k = keyFn(key);
      if (entry && k) map.set(k, entry);
    }
    out.set(system, map);
  }
  return out;
}

function toRegExp(pattern) {
  if (pattern instanceof RegExp) {
    // Stateful flags would make test() depend on previous calls.
    return pattern.global || pattern.sticky
      ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""))
      : pattern;
  }
  if (typeof pattern === "string" && pattern) {
    try {
      return new RegExp(pattern, "i");
    } catch {
      return null;
    }
  }
  return null;
}

function toSet(list) {
  return Array.isArray(list) && list.length ? new Set(list) : null;
}

const compiledCache = new WeakMap();
const EMPTY = Object.freeze({});

/** Build (and cache) fast lookup structures for a registry. */
function compile(registry) {
  const reg = isPlainObject(registry) ? registry : EMPTY;
  let c = compiledCache.get(reg);
  if (c) return c;
  const physicalTypes = new Map();
  if (isPlainObject(reg.physicalTypes)) {
    for (const [system, types] of Object.entries(reg.physicalTypes)) {
      if (Array.isArray(types)) physicalTypes.set(system, new Set(types));
    }
  }
  const keywords = [];
  if (Array.isArray(reg.keywords)) {
    for (const kw of reg.keywords) {
      if (!isPlainObject(kw)) continue;
      const pattern = toRegExp(kw.pattern);
      const entry = sanitizeEntry(kw.size);
      if (!pattern || !entry) continue;
      keywords.push({ pattern, entry, systems: toSet(kw.systems), types: toSet(kw.types) });
    }
  }
  c = {
    physicalTypes,
    byId: compileTable(reg.byId),
    byName: compileTable(reg.byName, normalizeName),
    byType: compileTable(reg.byType),
    keywords
  };
  compiledCache.set(reg, c);
  return c;
}

/** Look a key up in the system table, then in the "*" table. */
function lookup(table, systemId, key) {
  if (!key) return null;
  return table.get(systemId)?.get(key) ?? table.get(ANY)?.get(key) ?? null;
}

/** Candidate byId keys for a compendium UUID: the full UUID, then the bare document id. */
function sourceKeys(sourceId) {
  if (typeof sourceId !== "string" || !sourceId) return [];
  if (!sourceId.startsWith("Compendium.")) return [sourceId];
  const last = sourceId.slice(sourceId.lastIndexOf(".") + 1);
  return last && last !== sourceId ? [sourceId, last] : [sourceId];
}

/**
 * Whether the descriptor's item type occupies space in this system (ignores exclusion and
 * container flags — see resolveSize for that).
 * @param {object} descriptor
 * @param {object} registry
 * @returns {boolean}
 */
export function isPhysical(descriptor, registry) {
  if (!descriptor || typeof descriptor.type !== "string") return false;
  const { physicalTypes } = compile(registry);
  return Boolean(
    physicalTypes.get(descriptor.systemId)?.has(descriptor.type)
    || physicalTypes.get(ANY)?.has(descriptor.type)
  );
}

/**
 * Whether the descriptor carries a valid container flag (container items are worn, not placed).
 * @param {object} descriptor
 * @returns {boolean}
 */
export function isContainer(descriptor) {
  return sanitizeContainer(descriptor?.flags?.container) !== null;
}

/**
 * Resolve a size and report where it came from (for config dialogs / debugging).
 * @param {object} descriptor see module docs
 * @param {object} registry see module docs
 * @returns {{size: {w:number,h:number}|null, excluded: boolean,
 *   source: "nonPhysical"|"container"|"flag"|"id"|"name"|"keyword"|"type"|"fallback"}}
 *   `size` is null when the item takes no space; `excluded` is true when that is due to an
 *   exclusion (flag or registry), in which case `source` tells which level excluded it.
 */
export function explainSize(descriptor, registry) {
  if (!isPhysical(descriptor, registry)) return { size: null, excluded: false, source: "nonPhysical" };
  const flags = isPlainObject(descriptor.flags) ? descriptor.flags : EMPTY;
  if (sanitizeContainer(flags.container)) return { size: null, excluded: false, source: "container" };
  if (flags.excluded === true) return { size: null, excluded: true, source: "flag" };
  const flagSize = sanitizeSize(flags.size);
  if (flagSize) return { size: flagSize, excluded: false, source: "flag" };

  const allowExcluded = flags.excluded !== false;
  const result = (entry, source) => {
    if (entry === EXCLUDED) return allowExcluded ? { size: null, excluded: true, source } : null;
    return { size: { w: entry.w, h: entry.h }, excluded: false, source };
  };

  const c = compile(registry);
  const { systemId, type } = descriptor;
  const idKeys = [];
  if (typeof descriptor.coreId === "string" && descriptor.coreId) idKeys.push(descriptor.coreId);
  idKeys.push(...sourceKeys(descriptor.sourceId));
  for (const key of idKeys) {
    const entry = lookup(c.byId, systemId, key);
    const r = entry && result(entry, "id");
    if (r) return r;
  }

  const rawName = typeof descriptor.name === "string" ? descriptor.name : "";
  const name = normalizeName(rawName);
  const byName = lookup(c.byName, systemId, name);
  const nameResult = byName && result(byName, "name");
  if (nameResult) return nameResult;

  if (name) {
    for (const kw of c.keywords) {
      if (kw.systems && !kw.systems.has(systemId)) continue;
      if (kw.types && !kw.types.has(type)) continue;
      if (!kw.pattern.test(rawName) && !kw.pattern.test(name)) continue;
      const r = result(kw.entry, "keyword");
      if (r) return r;
    }
  }

  const byType = lookup(c.byType, systemId, type);
  const typeResult = byType && result(byType, "type");
  if (typeResult) return typeResult;

  return { size: { ...FALLBACK_SIZE }, excluded: false, source: "fallback" };
}

/**
 * Resolve how many cells an item occupies.
 * @param {object} descriptor `{type, name, systemId, sourceId?, coreId?, flags:{size?, excluded?, container?}}`
 * @param {object} registry see module docs
 * @returns {{w:number, h:number}|null} null = takes no space (non-physical, container or excluded)
 */
export function resolveSize(descriptor, registry) {
  return explainSize(descriptor, registry).size;
}

/**
 * Merge registries into a new one (inputs are not modified; null/undefined are skipped).
 * Later registries win: their map entries override earlier ones, their keywords are checked
 * before earlier keywords, and physical type lists are unioned.
 * @param {...object} regs
 * @returns {object} a registry
 */
export function mergeRegistries(...regs) {
  const out = { physicalTypes: {}, byId: {}, byName: {}, keywords: [], byType: {} };
  const keywordGroups = [];
  for (const reg of regs) {
    if (!isPlainObject(reg)) continue;
    if (isPlainObject(reg.physicalTypes)) {
      for (const [system, types] of Object.entries(reg.physicalTypes)) {
        if (!Array.isArray(types)) continue;
        out.physicalTypes[system] = [...new Set([...(out.physicalTypes[system] ?? []), ...types])];
      }
    }
    for (const key of ["byId", "byName", "byType"]) {
      if (!isPlainObject(reg[key])) continue;
      for (const [system, entries] of Object.entries(reg[key])) {
        if (!isPlainObject(entries)) continue;
        const target = (out[key][system] ??= {});
        for (const [k, v] of Object.entries(entries)) {
          target[key === "byName" ? normalizeName(k) : k] = v;
        }
      }
    }
    if (Array.isArray(reg.keywords)) keywordGroups.unshift(reg.keywords);
  }
  out.keywords = keywordGroups.flat();
  return out;
}
