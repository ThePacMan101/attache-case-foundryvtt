/**
 * Pointer-based drag & drop for Attaché Case tiles and chips (no HTML5 DnD).
 *
 * - A ghost follows the cursor, anchored at the grabbed cell; moved with transforms in a
 *   requestAnimationFrame loop, never by re-rendering.
 * - The hovered grid (of this or another Attaché Case window in the same document) shows a
 *   footprint preview; R / right click / mouse wheel rotate; Escape cancels.
 * - Every listener lives on the source element's ownerDocument, so pop-out windows work; drops
 *   on windows in another document are simply not detected.
 */

import { footprint } from "../core/grid.mjs";
import { canMove } from "../core/layout.mjs";
import { isArmor } from "../foundry/system-adapter.mjs";
import { canGiveTo } from "../foundry/inventory.mjs";
import { wornEnabled } from "../settings.mjs";

/** Pixels the pointer must travel before a press becomes a drag. */
const THRESHOLD = 4;
/** Distance from a scroll container edge that triggers auto-scroll, and max speed in px/frame. */
const EDGE = 32;
const SCROLL_SPEED = 14;
/** Minimum delay between two wheel-triggered rotations. */
const WHEEL_MS = 160;
/** Placeholder id for an item that does not belong to the hovered layout yet. */
const INCOMING = "\u0000incoming";

/** @type {DragController|null} the drag in progress, if any (one pointer, one drag) */
let current = null;

/**
 * Screen pixels per CSS pixel of an element. Core scales application windows (UI scale setting,
 * `position.scale`) with a CSS scale, which getBoundingClientRect() includes but the cell size
 * setting does not.
 * @param {HTMLElement} el
 * @returns {number}
 */
export function screenScale(el) {
  const w = el?.offsetWidth;
  const s = w ? el.getBoundingClientRect().width / w : 1;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

export class DragController {
  /**
   * @param {object} app the owning AttacheCaseApp
   */
  constructor(app) {
    this.app = app;
    this._press = null;
    this._drag = null;
  }

  /** @returns {boolean} whether any Attaché Case drag is in progress */
  static get active() {
    return Boolean(current?._drag);
  }

  /**
   * Listen for presses on draggable items inside `root` (delegated; call once per element).
   * @param {HTMLElement} root
   */
  bind(root) {
    root.addEventListener("pointerdown", (event) => this._onPointerDown(event));
    // Native image/element dragging would fight the pointer drag.
    root.addEventListener("dragstart", (event) => {
      if (event.target.closest?.(".attache-item")) event.preventDefault();
    });
  }

  /* -------------------------------------------- */

  _onPointerDown(event) {
    if (event.button !== 0 || current || !this.app.isEditable) return;
    const el = event.target.closest(".attache-item[data-item-id]");
    if (!el || event.target.closest("button, a, input")) return;
    const itemId = el.dataset.itemId;
    const item = this.app.actor.items.get(itemId);
    const info = this.app.itemInfo(itemId);
    if (!item || !info?.size) return;
    const doc = el.ownerDocument;
    this._press = { el, item, size: info.size, r: info.r, kind: info.kind, x0: event.clientX, y0: event.clientY, pointerId: event.pointerId, doc };
    this._listen(doc, true);
    current = this;
  }

  /** Add or remove the document-level listeners. */
  _listen(doc, on) {
    const fn = on ? "addEventListener" : "removeEventListener";
    this._handlers ??= {
      move: (e) => this._onPointerMove(e),
      up: (e) => this._onPointerUp(e),
      cancel: () => this.cancel(),
      key: (e) => this._onKeyDown(e),
      menu: (e) => this._onContextMenu(e),
      wheel: (e) => this._onWheel(e),
      blur: () => this.cancel()
    };
    const h = this._handlers;
    doc[fn]("pointermove", h.move, true);
    doc[fn]("pointerup", h.up, true);
    doc[fn]("pointercancel", h.cancel, true);
    doc[fn]("keydown", h.key, true);
    doc[fn]("contextmenu", h.menu, true);
    doc[fn]("wheel", h.wheel, { capture: true, passive: false });
    doc.defaultView?.[fn]("blur", h.blur);
  }

  _onPointerMove(event) {
    if (event.pointerId !== this._press?.pointerId) return;
    if (!this._drag) {
      if (Math.hypot(event.clientX - this._press.x0, event.clientY - this._press.y0) < THRESHOLD) return;
      this._start(event);
    }
    event.preventDefault();
    this._drag.px = event.clientX;
    this._drag.py = event.clientY;
  }

  _onPointerUp(event) {
    if (event.pointerId !== this._press?.pointerId) return;
    if (!this._drag) return this._end();
    event.preventDefault();
    event.stopPropagation();
    this._drag.px = event.clientX;
    this._drag.py = event.clientY;
    this._drop();
  }

  _onKeyDown(event) {
    if (!this._drag) {
      if (event.key === "Escape") this._end();
      return;
    }
    if (event.code === "Escape" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    } else if (event.code === "KeyR" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) this.rotate();
    }
  }

  _onContextMenu(event) {
    if (!this._drag) return;
    event.preventDefault();
    event.stopPropagation();
    this.rotate();
  }

  _onWheel(event) {
    if (!this._drag) return;
    event.preventDefault();
    event.stopPropagation();
    const now = performance.now();
    if (now - this._drag.lastWheel < WHEEL_MS || Math.abs(event.deltaY) < 1) return;
    this._drag.lastWheel = now;
    this.rotate();
  }

  /* -------------------------------------------- */

  /** Turn the press into a drag: build the ghost and start the frame loop. */
  _start(event) {
    const p = this._press;
    // On-screen cell size: anchor, ghost and hit-testing all work in screen pixels.
    const cell = this.app.cellSize * screenScale(p.el);
    const fp = footprint(p.size, p.r);
    let ax;
    let ay;
    let fx;
    let fy;
    if (p.kind === "tile") {
      const rect = p.el.getBoundingClientRect();
      const lx = Math.min(Math.max(p.x0 - rect.left, 0), rect.width - 1);
      const ly = Math.min(Math.max(p.y0 - rect.top, 0), rect.height - 1);
      ax = Math.min(fp.w - 1, Math.floor(lx / cell));
      ay = Math.min(fp.h - 1, Math.floor(ly / cell));
      fx = lx - ax * cell;
      fy = ly - ay * cell;
    } else {
      ax = Math.floor((fp.w - 1) / 2);
      ay = Math.floor((fp.h - 1) / 2);
      fx = fy = cell / 2;
    }
    const origin = p.el.getBoundingClientRect();
    this._drag = {
      ...p, cell, ax, ay, fx, fy, origin,
      px: event.clientX, py: event.clientY, lastWheel: 0,
      target: null, targetApp: null, frame: null, ghost: null
    };
    try {
      p.el.setPointerCapture?.(p.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    p.el.addEventListener("lostpointercapture", this._lost = () => {
      if (this._drag && !this._dropping) this._drop();
    }, { once: true });
    p.el.classList.add("is-dragging");
    p.doc.body.classList.add("attache-dragging");
    game.tooltip?.deactivate?.();
    this._buildGhost();
    this._frame();
  }

  _buildGhost() {
    const d = this._drag;
    const ghost = d.doc.createElement("div");
    ghost.className = "attache-ghost";
    const img = d.doc.createElement("img");
    img.src = d.item.img;
    img.alt = "";
    img.draggable = false;
    ghost.append(img);
    ghost.style.setProperty("--attache-cell", `${d.cell}px`);
    d.doc.body.append(ghost);
    d.ghost = ghost;
    this._sizeGhost();
  }

  _sizeGhost() {
    const d = this._drag;
    const fp = footprint(d.size, d.r);
    const s = d.ghost.style;
    s.width = `${fp.w * d.cell}px`;
    s.height = `${fp.h * d.cell}px`;
    s.setProperty("--uw", d.size.w);
    s.setProperty("--uh", d.size.h);
    d.ghost.classList.toggle("is-rotated", d.r);
  }

  /** Rotate the dragged item by 90°, keeping the grabbed point under the cursor. */
  rotate() {
    const d = this._drag;
    if (!d || d.size.w === d.size.h) return;
    const fp = footprint(d.size, d.r);
    const c = d.cell;
    if (!d.r) {
      // Clockwise: (x, y) -> (h-1-y, x); sub-cell offset (fx, fy) -> (c-fy, fx).
      [d.ax, d.ay] = [fp.h - 1 - d.ay, d.ax];
      [d.fx, d.fy] = [c - d.fy, d.fx];
    } else {
      // Counter-clockwise inverse: (x, y) -> (y, w-1-x); (fx, fy) -> (fy, c-fx).
      [d.ax, d.ay] = [d.ay, fp.w - 1 - d.ax];
      [d.fx, d.fy] = [d.fy, c - d.fx];
    }
    d.r = !d.r;
    this._sizeGhost();
    d.dirty = true;
  }

  /** One animation frame: move the ghost, hit-test, preview, auto-scroll. */
  _frame() {
    const d = this._drag;
    if (!d) return;
    const x = d.px - d.ax * d.cell - d.fx;
    const y = d.py - d.ay * d.cell - d.fy;
    d.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this._updateTarget();
    this._autoScroll();
    d.frame = d.doc.defaultView.requestAnimationFrame(() => this._frame());
  }

  /**
   * What is under the cursor right now.
   * @returns {{app:object, kind:"cell"|"overflow"|"worn", pos?:object, valid:boolean}|null}
   */
  _hitTest() {
    const d = this._drag;
    const el = d.doc.elementFromPoint(d.px, d.py);
    const root = el?.closest(".attache-case[data-actor-uuid]");
    const app = root && this.app.constructor.fromElement(root);
    if (!app) return null;
    const foreign = app !== this.app;
    if (foreign && (!canGiveTo(app.actor) || app.actor === this.app.actor)) return { app, kind: "none", valid: false };
    const fp = footprint(d.size, d.r);
    const gridEl = el.closest(".attache-grid[data-container-id]");
    if (gridEl) {
      const rect = gridEl.getBoundingClientRect();
      const cell = app.cellSize * screenScale(gridEl);
      const cx = Math.floor((d.px - rect.left) / cell);
      const cy = Math.floor((d.py - rect.top) / cell);
      const pos = { c: gridEl.dataset.containerId, x: cx - d.ax, y: cy - d.ay, r: d.r };
      const layout = app.inventory?.layout;
      const valid = Boolean(layout && canMove(layout, foreign ? INCOMING : d.item.id, d.size, pos));
      return { app, kind: "cell", pos, fp, gridEl, valid };
    }
    if (el.closest(".attache-overflow")) return { app, kind: "overflow", valid: foreign || d.kind !== "overflow" };
    if (el.closest(".attache-worn")) {
      const valid = wornEnabled() && isArmor(d.item) && (foreign || d.kind !== "worn");
      return { app, kind: "worn", valid };
    }
    return { app, kind: "none", valid: false };
  }

  _updateTarget() {
    const d = this._drag;
    const hit = this._hitTest();
    const prev = d.target;
    const same = prev && hit && prev.app === hit.app && prev.kind === hit.kind && prev.valid === hit.valid
      && (hit.kind !== "cell" || (prev.pos.c === hit.pos.c && prev.pos.x === hit.pos.x && prev.pos.y === hit.pos.y && prev.pos.r === hit.pos.r));
    if (same && !d.dirty) return;
    d.dirty = false;
    if (prev?.app && prev.app !== hit?.app) prev.app.clearPreview();
    d.target = hit;
    if (!hit) return;
    if (hit.kind === "cell") hit.app.showFootprint(hit.gridEl, hit.pos, hit.fp, hit.valid);
    else hit.app.showZone(hit.kind, hit.valid);
    d.ghost.classList.toggle("is-invalid", hit.kind !== "none" && !hit.valid);
  }

  /** Scroll the hovered window's main area when the cursor nears its edges. */
  _autoScroll() {
    const d = this._drag;
    const scroller = d.target?.app?.element?.querySelector(".attache-main");
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    if (d.px < r.left || d.px > r.right || d.py < r.top || d.py > r.bottom) return;
    const speed = (dist) => (dist < EDGE ? Math.ceil(SCROLL_SPEED * (1 - dist / EDGE)) : 0);
    const dy = speed(r.bottom - d.py) - speed(d.py - r.top);
    const dx = speed(r.right - d.px) - speed(d.px - r.left);
    if (dx || dy) {
      scroller.scrollBy(dx, dy);
      d.dirty = true;
    }
  }

  /* -------------------------------------------- */

  /** Finish the drag on pointer up. */
  async _drop() {
    const d = this._drag;
    if (!d || this._dropping) return;
    this._dropping = true;
    d.dirty = true;
    this._updateTarget();
    const hit = d.target;
    if (!hit?.valid) return this.cancel();
    const ghost = d.ghost;
    const sourceApp = this.app;
    const item = d.item;
    const kind = d.kind;
    this._cleanup({ keepGhost: true });
    ghost.classList.add("is-dropped");
    ghost.addEventListener("transitionend", () => ghost.remove(), { once: true });
    setTimeout(() => ghost.remove(), 300);

    let ok = true;
    try {
      if (hit.app !== sourceApp) {
        const target = hit.kind === "cell" ? { kind: "cell", pos: hit.pos } : { kind: hit.kind };
        sourceApp.optimisticHide(item.id);
        ok = await sourceApp.service.transferItem(item, hit.app.actor, target);
      } else if (hit.kind === "cell") {
        sourceApp.optimisticMove(item.id, hit.pos, d.size);
        ok = await sourceApp.service.moveItem(sourceApp.actor, item.id, hit.pos);
        if (!ok) sourceApp.notifyNoSpace(item);
      } else if (hit.kind === "overflow") {
        if (kind !== "overflow") sourceApp.optimisticHide(item.id);
        await sourceApp.service.stowItem(sourceApp.actor, item.id);
      } else if (hit.kind === "worn") {
        sourceApp.optimisticHide(item.id);
        ok = await sourceApp.service.wearItem(sourceApp.actor, item.id);
      }
    } catch (err) {
      ok = false;
      console.error("attache-case | drop failed", err);
    }
    if (!ok) sourceApp.render();
  }

  /** Abort the drag (or press) and animate the ghost back to where it came from. */
  cancel() {
    const d = this._drag;
    if (!d) return this._end();
    const ghost = d.ghost;
    const o = d.origin;
    this._cleanup({ keepGhost: true });
    if (!ghost) return;
    ghost.classList.add("is-returning");
    ghost.style.width = `${o.width}px`;
    ghost.style.height = `${o.height}px`;
    ghost.style.transform = `translate3d(${o.left}px, ${o.top}px, 0)`;
    const done = () => ghost.remove();
    ghost.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 400);
  }

  _cleanup({ keepGhost = false } = {}) {
    const d = this._drag;
    if (d) {
      d.doc.defaultView?.cancelAnimationFrame(d.frame);
      d.target?.app?.clearPreview();
      d.el.classList.remove("is-dragging");
      d.el.removeEventListener("lostpointercapture", this._lost);
      try {
        if (d.el.hasPointerCapture?.(d.pointerId)) d.el.releasePointerCapture(d.pointerId);
      } catch {
        /* ignore */
      }
      d.doc.body.classList.remove("attache-dragging");
      if (!keepGhost) d.ghost?.remove();
    }
    this._end();
  }

  /** Forget the press, detach listeners and flush renders deferred during the drag. */
  _end() {
    const doc = this._press?.doc;
    if (doc) this._listen(doc, false);
    const wasDragging = Boolean(this._drag);
    this._press = null;
    this._drag = null;
    this._dropping = false;
    if (current === this) current = null;
    if (wasDragging) this.app.constructor.flushDeferredRenders();
  }

  /** Abort without animation (window closing). */
  destroy() {
    this._cleanup();
  }
}
