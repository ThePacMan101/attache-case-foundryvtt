/**
 * Occupancy grid for one container. Pure module — no Foundry globals.
 * Coordinates are 0-based cells; (x, y) is the top-left cell of a rectangle, x = column, y = row.
 */

const isInt = Number.isInteger;

/**
 * Footprint of an item after optional rotation (rotation swaps width and height).
 * @param {{w:number, h:number}} size unrotated footprint
 * @param {boolean} [rotated=false]
 * @returns {{w:number, h:number}}
 */
export function footprint(size, rotated = false) {
  return rotated ? { w: size.h, h: size.w } : { w: size.w, h: size.h };
}

/** A rectangular occupancy matrix mapping cells to item ids. */
export class Grid {
  /**
   * @param {number} cols columns (>= 0; non-integers are floored, garbage becomes 0)
   * @param {number} rows rows (>= 0)
   */
  constructor(cols, rows) {
    this.cols = Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : 0;
    this.rows = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 0;
    /** @type {Array<string|null>} row-major cell occupants */
    this._cells = new Array(this.cols * this.rows).fill(null);
    /** @type {Map<string, {x:number, y:number, w:number, h:number}>} */
    this._rects = new Map();
  }

  /**
   * Whether the rectangle lies fully inside the grid (w, h must be positive integers).
   * @returns {boolean}
   */
  inBounds(x, y, w, h) {
    return isInt(x) && isInt(y) && isInt(w) && isInt(h)
      && w >= 1 && h >= 1 && x >= 0 && y >= 0
      && x + w <= this.cols && y + h <= this.rows;
  }

  /**
   * Column of the first blocking cell scanning the rectangle row by row, or -1 if it is free.
   * Assumes the rectangle is in bounds.
   */
  _blockingColumn(x, y, w, h, ignoreId) {
    for (let j = y; j < y + h; j++) {
      const row = j * this.cols;
      for (let i = x + w - 1; i >= x; i--) {
        const id = this._cells[row + i];
        if (id !== null && id !== ignoreId) return i;
      }
    }
    return -1;
  }

  /**
   * Whether the rectangle is in bounds and overlaps no item other than `ignoreId`.
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} [ignoreId] item whose own cells count as free (e.g. the item being moved)
   * @returns {boolean}
   */
  canPlace(x, y, w, h, ignoreId) {
    return this.inBounds(x, y, w, h) && this._blockingColumn(x, y, w, h, ignoreId) === -1;
  }

  /**
   * Occupy a rectangle with `id`. If `id` is already in the grid it is moved.
   * @returns {boolean} false (and no change) if the rectangle is out of bounds or occupied
   */
  place(id, x, y, w, h) {
    if (id === null || id === undefined || !this.canPlace(x, y, w, h, id)) return false;
    this.remove(id);
    for (let j = y; j < y + h; j++) {
      const row = j * this.cols;
      for (let i = x; i < x + w; i++) this._cells[row + i] = id;
    }
    this._rects.set(id, { x, y, w, h });
    return true;
  }

  /** Free the cells of `id` (no-op if absent). */
  remove(id) {
    const r = this._rects.get(id);
    if (!r) return;
    for (let j = r.y; j < r.y + r.h; j++) {
      const row = j * this.cols;
      for (let i = r.x; i < r.x + r.w; i++) this._cells[row + i] = null;
    }
    this._rects.delete(id);
  }

  /**
   * @returns {string|null} id occupying the cell, or null (also for out-of-bounds cells)
   */
  occupantAt(x, y) {
    if (!isInt(x) || !isInt(y) || x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return this._cells[y * this.cols + x];
  }

  /** @returns {boolean} whether `id` occupies this grid */
  has(id) {
    return this._rects.has(id);
  }

  /** @returns {{x:number, y:number, w:number, h:number}|null} a copy of the item's rectangle */
  rectOf(id) {
    const r = this._rects.get(id);
    return r ? { ...r } : null;
  }

  /** @returns {string[]} ids placed in this grid, in placement order */
  ids() {
    return [...this._rects.keys()];
  }

  /** @returns {number} number of free cells */
  freeCells() {
    let n = 0;
    for (const c of this._cells) if (c === null) n++;
    return n;
  }

  /**
   * First free top-left position for a w x h rectangle, scanning row-major from (0, 0).
   * @param {number} w
   * @param {number} h
   * @param {string} [ignoreId] item whose own cells count as free
   * @returns {{x:number, y:number}|null}
   */
  findFirstFit(w, h, ignoreId) {
    if (!isInt(w) || !isInt(h) || w < 1 || h < 1 || w > this.cols || h > this.rows) return null;
    for (let y = 0; y + h <= this.rows; y++) {
      for (let x = 0; x + w <= this.cols; x++) {
        const blocked = this._blockingColumn(x, y, w, h, ignoreId);
        if (blocked === -1) return { x, y };
        // Every start column up to the blocking one would overlap it too.
        x = blocked;
      }
    }
    return null;
  }

  /** @returns {Grid} an independent copy */
  clone() {
    const g = new Grid(this.cols, this.rows);
    g._cells = this._cells.slice();
    for (const [id, r] of this._rects) g._rects.set(id, { ...r });
    return g;
  }
}
