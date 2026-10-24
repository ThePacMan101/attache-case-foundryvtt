/**
 * Layout engine: turns persisted placement requests into validated grids + overflow.
 * Pure module — no Foundry globals.
 *
 * Layout object: `{grids: Map<containerId, Grid>, placed: Map<itemId, {c,x,y,r,w,h}>, overflow: itemId[]}`.
 * `w`/`h` in `placed` are the effective (rotated) footprint. Callers must treat layouts as
 * immutable: functions here never mutate their input layout, and withPlacement() returns a
 * new one. Placement entries and the overflow array are frozen.
 */

import { Grid, footprint } from "./grid.mjs";
import { sanitizeSize } from "./sizes.mjs";
import { FALLBACK_SIZE } from "../constants.mjs";

/** Code-unit comparison: locale-independent so every client orders ids identically. */
function compareIds(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareItems(a, b) {
  return a.sort - b.sort || compareIds(a.id, b.id);
}

/** A pos that is structurally usable (it may still be out of bounds or collide). */
function normalizePos(pos) {
  if (!pos || typeof pos !== "object") return null;
  const { c, x, y } = pos;
  if (typeof c !== "string" || !c || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { c, x, y, r: Boolean(pos.r) };
}

function normalizeItem(item) {
  if (!item || typeof item.id !== "string" || !item.id) return null;
  return {
    id: item.id,
    size: sanitizeSize(item.size) ?? { ...FALLBACK_SIZE },
    pos: normalizePos(item.pos),
    sort: Number.isFinite(item.sort) ? item.sort : 0
  };
}

function placedEntry(c, x, y, r, w, h) {
  return Object.freeze({ c, x, y, r, w, h });
}

/**
 * Validate every item's requested placement and compute the overflow.
 * Items with a structurally valid `pos` are placed first in ascending `sort`, then `id`, so
 * conflicting requests resolve identically regardless of input order; the loser of a conflict,
 * items whose container is missing, and items out of bounds go to overflow.
 * Malformed sizes fall back to 1x1; items without a string id are ignored; for duplicate ids
 * only the first (in sort/id order) counts.
 * @param {Array<{id:string, cols:number, rows:number}>} containers display order, "body" first
 * @param {Array<{id:string, size:{w:number,h:number}, pos:({c:string,x:number,y:number,r:boolean}|null), sort:number}>} items
 *   physical, non-container items only
 * @returns {{grids: Map<string, Grid>, placed: Map<string, {c:string,x:number,y:number,r:boolean,w:number,h:number}>, overflow: string[]}}
 *   overflow is in sort/id order
 */
export function buildLayout(containers, items) {
  const grids = new Map();
  for (const ct of containers ?? []) {
    if (!ct || typeof ct.id !== "string" || !ct.id || grids.has(ct.id)) continue;
    grids.set(ct.id, new Grid(ct.cols, ct.rows));
  }

  const seen = new Set();
  const list = [];
  for (const raw of items ?? []) {
    const item = normalizeItem(raw);
    if (item) list.push(item);
  }
  list.sort(compareItems);

  const placed = new Map();
  const overflow = [];
  for (const item of list) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const { pos } = item;
    const grid = pos && grids.get(pos.c);
    const fp = footprint(item.size, pos?.r);
    if (grid && grid.place(item.id, pos.x, pos.y, fp.w, fp.h)) {
      placed.set(item.id, placedEntry(pos.c, pos.x, pos.y, pos.r, fp.w, fp.h));
    } else {
      overflow.push(item.id);
    }
  }
  return { grids, placed, overflow: Object.freeze(overflow) };
}

/** Accept `[{id}]`, `["id"]` or nothing (= every grid of the layout, in layout order). */
function containerIds(layout, containers) {
  if (!Array.isArray(containers)) return [...layout.grids.keys()];
  return containers.map((ct) => (typeof ct === "string" ? ct : ct?.id)).filter((id) => typeof id === "string");
}

/**
 * Find a free spot for an item of the given size.
 * Order: the preferred container first, then the others in display order; in each container
 * the first row-major fit unrotated, then rotated (if allowed and the item is not square).
 * @param {object} layout from buildLayout
 * @param {Array<{id:string}>|string[]} [containers] candidate containers in display order
 *   (default: every grid of the layout)
 * @param {{w:number, h:number}} size unrotated size
 * @param {object} [options]
 * @param {string} [options.preferContainer] container id to try first
 * @param {boolean} [options.allowRotate=true]
 * @param {string} [options.ignoreId] item whose current cells count as free (relocating it)
 * @returns {{c:string, x:number, y:number, r:boolean}|null}
 */
export function findSpot(layout, containers, size, { preferContainer, allowRotate = true, ignoreId } = {}) {
  const s = sanitizeSize(size);
  if (!s || !layout?.grids) return null;
  const ids = containerIds(layout, containers);
  if (preferContainer && ids.includes(preferContainer)) {
    ids.splice(ids.indexOf(preferContainer), 1);
    ids.unshift(preferContainer);
  }
  const rotations = allowRotate && s.w !== s.h ? [false, true] : [false];
  for (const c of ids) {
    const grid = layout.grids.get(c);
    if (!grid) continue;
    for (const r of rotations) {
      const fp = footprint(s, r);
      const spot = grid.findFirstFit(fp.w, fp.h, ignoreId);
      if (spot) return { c, x: spot.x, y: spot.y, r };
    }
  }
  return null;
}

/**
 * Whether an item could be moved to the given placement (the item's own current cells are
 * treated as free). Used for drag previews.
 * @param {object} layout from buildLayout
 * @param {string} itemId
 * @param {{w:number, h:number}} size unrotated size
 * @param {{c:string, x:number, y:number, r:boolean}} pos target placement
 * @returns {boolean}
 */
export function canMove(layout, itemId, size, pos) {
  const s = sanitizeSize(size);
  const p = normalizePos(pos);
  const grid = p && layout?.grids?.get(p.c);
  if (!s || !grid) return false;
  const fp = footprint(s, p.r);
  return grid.canPlace(p.x, p.y, fp.w, fp.h, itemId);
}

/**
 * Return a new layout with one item moved to `pos` (or to overflow when `pos` is null),
 * e.g. to chain several findSpot() calls when auto-placing multiple items. The input layout
 * is not modified.
 * @param {object} layout from buildLayout
 * @param {string} itemId
 * @param {{w:number, h:number}} size unrotated size
 * @param {{c:string, x:number, y:number, r:boolean}|null} pos
 * @returns {object|null} the new layout, or null if `pos` is not a valid move
 */
export function withPlacement(layout, itemId, size, pos) {
  if (pos !== null && !canMove(layout, itemId, size, pos)) return null;
  const grids = new Map();
  for (const [id, grid] of layout.grids) {
    const g = grid.clone();
    g.remove(itemId);
    grids.set(id, g);
  }
  const placed = new Map(layout.placed);
  placed.delete(itemId);
  const overflow = layout.overflow.filter((id) => id !== itemId);
  if (pos === null) {
    overflow.push(itemId);
  } else {
    const p = normalizePos(pos);
    const fp = footprint(sanitizeSize(size), p.r);
    grids.get(p.c).place(itemId, p.x, p.y, fp.w, fp.h);
    placed.set(itemId, placedEntry(p.c, p.x, p.y, p.r, fp.w, fp.h));
  }
  return { grids, placed, overflow: Object.freeze(overflow) };
}

/** Item orderings tried by autoArrange(); the first one is the classic "largest area first". */
const ARRANGE_ORDERS = Object.freeze([
  (a, b) => b.area - a.area || b.long - a.long || compareItems(a, b),
  (a, b) => b.long - a.long || b.area - a.area || compareItems(a, b),
  (a, b) => b.short - a.short || b.area - a.area || compareItems(a, b)
]);

/** One greedy packing pass over `list` in its current order. */
function packOnce(containers, list) {
  const grids = containers.map((ct) => ({ id: ct.id, grid: new Grid(ct.cols, ct.rows) }));
  const placements = new Map();
  const overflow = [];
  let overflowArea = 0;
  for (const item of list) {
    let best = null;
    for (const { id, grid } of grids) {
      for (const r of item.size.w === item.size.h ? [false] : [false, true]) {
        const fp = footprint(item.size, r);
        const spot = grid.findFirstFit(fp.w, fp.h);
        // Topmost, then leftmost; on a tie the unrotated orientation (tried first) wins.
        if (spot && (!best || spot.y < best.y || (spot.y === best.y && spot.x < best.x))) {
          best = { c: id, grid, x: spot.x, y: spot.y, r, fp };
        }
      }
      if (best) break; // fill containers in display order
    }
    if (best) {
      best.grid.place(item.id, best.x, best.y, best.fp.w, best.fp.h);
      placements.set(item.id, Object.freeze({ c: best.c, x: best.x, y: best.y, r: best.r }));
    } else {
      overflow.push(item);
      overflowArea += item.area;
    }
  }
  return { placements, overflow, overflowArea };
}

/**
 * Repack items from scratch into the containers (current positions are ignored).
 * Greedy first-fit in a few deterministic orders (largest area first, longest side first,
 * thickest first); each item goes to the first container, in display order, where it fits,
 * at the topmost-leftmost spot of either orientation. The pass leaving the least overflow
 * area (then fewest overflowing items) wins.
 * @param {Array<{id:string, cols:number, rows:number}>} containers display order, "body" first
 * @param {Array<{id:string, size:{w:number,h:number}, sort?:number}>} items physical,
 *   non-container, non-worn items; malformed sizes count as 1x1, duplicate ids after the first
 *   are ignored
 * @returns {{placements: Map<string, {c:string, x:number, y:number, r:boolean}>, overflow: string[]}}
 *   overflow in sort/id order
 */
export function autoArrange(containers, items) {
  const cts = [];
  const seenCt = new Set();
  for (const ct of containers ?? []) {
    if (!ct || typeof ct.id !== "string" || !ct.id || seenCt.has(ct.id)) continue;
    seenCt.add(ct.id);
    cts.push(ct);
  }
  const seen = new Set();
  const list = [];
  const normalized = [];
  for (const raw of items ?? []) {
    const item = normalizeItem(raw);
    if (item) normalized.push(item);
  }
  normalized.sort(compareItems);
  for (const item of normalized) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const { w, h } = item.size;
    list.push({ ...item, area: w * h, long: Math.max(w, h), short: Math.min(w, h) });
  }

  let best = null;
  for (const order of ARRANGE_ORDERS) {
    const result = packOnce(cts, list.slice().sort(order));
    if (!best || result.overflowArea < best.overflowArea
      || (result.overflowArea === best.overflowArea && result.overflow.length < best.overflow.length)) {
      best = result;
    }
    if (!best.overflow.length) break;
  }
  const overflow = (best?.overflow ?? []).sort(compareItems).map((item) => item.id);
  return { placements: best?.placements ?? new Map(), overflow: Object.freeze(overflow) };
}
