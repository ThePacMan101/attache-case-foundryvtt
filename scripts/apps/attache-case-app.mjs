/**
 * The Attaché Case window: one per actor. Renders the containers as grids with item tiles, the
 * Worn strip and the Unstowed tray, and wires pointer drag & drop, keyboard shortcuts, context
 * menus and external (HTML5) item drops. All writes go through the InventoryService.
 */

import { MODULE_ID, BODY_ID } from "../constants.mjs";
import * as service from "../foundry/inventory.mjs";
import { isSupportedActor, isArmor } from "../foundry/system-adapter.mjs";
import { cellSize, showNames, wornEnabled, canEditSizes } from "../settings.mjs";
import { loc, notify, typeLabel } from "../foundry/util.mjs";
import { DragController, screenScale } from "./drag-controller.mjs";
import { ItemSizeConfig } from "./item-size-config.mjs";
import { ActorConfig } from "./actor-config.mjs";
import { promptGiveTarget, promptResize, confirmDialog } from "./dialogs.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Delay used to coalesce bursts of document updates into one render. */
const RENDER_DELAY = 20;

/** Inputs where keyboard shortcuts must not fire. */
const TYPING = "input, textarea, select, [contenteditable], [contenteditable=''], [contenteditable='true']";

/**
 * A window size that shows the body and the first container side by side, and every panel and
 * side-column chip without scrolling where possible, clamped to the viewport.
 * @param {import("../foundry/inventory.mjs").InventoryState} state
 * @returns {{width:number, height:number}}
 */
function fitSize(state) {
  const { containers } = state;
  const cell = cellSize();
  const side = 220;
  const chrome = 48;
  const gap = 12;
  const panelW = (ct) => ct.cols * cell + 26;
  const panelH = (ct) => ct.rows * cell + 58;
  const maxW = Math.floor(globalThis.innerWidth * 0.92);
  const maxH = Math.floor(globalThis.innerHeight * 0.88);
  const firstTwo = containers.slice(0, 2).reduce((sum, ct) => sum + panelW(ct) + gap, 0);
  const main = Math.max(340, Math.min(maxW - side - chrome, firstTwo || 340));
  // Simulate the flex-wrap of the panels to estimate the height.
  let rowW = 0;
  let rowH = 0;
  let height = 0;
  for (const ct of containers) {
    const w = panelW(ct) + gap;
    if (rowW && rowW + w > main) {
      height += rowH + gap;
      rowW = 0;
      rowH = 0;
    }
    rowW += w;
    rowH = Math.max(rowH, panelH(ct));
  }
  height += rowH + 2 * gap;
  // Side column: Worn and Unstowed zones (header + one 39 px row per chip, or the empty hint).
  const zone = (n) => 40 + Math.max(1, n) * 39;
  const sideH = (wornEnabled() ? zone(state.worn.length) + gap : 0) + zone(state.overflow.length) + 2 * gap;
  return {
    width: Math.min(maxW, Math.max(560, main + side + chrome)),
    height: Math.min(maxH, Math.max(320, Math.max(height, sideH) + 86))
  };
}

export class AttacheCaseApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {Map<string, AttacheCaseApp>} open windows by actor uuid */
  static #instances = new Map();

  /** @type {Set<AttacheCaseApp>} windows whose render was deferred by a drag */
  static #deferred = new Set();

  /** @type {AttacheCaseApp|null} the window under the pointer, if any */
  static #hovered = null;

  static DEFAULT_OPTIONS = {
    id: "attache-case-{id}",
    classes: ["attache-case"],
    tag: "div",
    window: {
      title: "ATTACHE.Menu.OpenCase",
      icon: "fa-solid fa-briefcase",
      resizable: true,
      minimizable: true,
      contentClasses: ["attache-content"],
      controls: [{ action: "openSheet", icon: "fa-solid fa-user", label: "ATTACHE.Menu.OpenSheet", visible: true }]
    },
    position: { width: 720, height: 520 },
    actions: {
      autoArrange: AttacheCaseApp.#onAutoArrange,
      configure: AttacheCaseApp.#onConfigure,
      packUnstowed: AttacheCaseApp.#onPackUnstowed,
      openSheet: AttacheCaseApp.#onOpenSheet
    }
  };

  static PARTS = {
    case: {
      template: `modules/${MODULE_ID}/templates/attache-case.hbs`,
      templates: [`modules/${MODULE_ID}/templates/item-chip.hbs`],
      scrollable: [".attache-main", ".attache-side"]
    }
  };

  /**
   * Open (or focus) the case of an actor.
   * @param {Actor} actor
   * @returns {AttacheCaseApp|null}
   */
  static open(actor) {
    if (!actor || actor.documentName !== "Actor") {
      notify("warn", "ATTACHE.Notify.NoActor");
      return null;
    }
    if (!isSupportedActor(actor)) {
      notify("warn", "ATTACHE.Notify.Unsupported");
      return null;
    }
    if (!actor.testUserPermission(game.user, "OBSERVER")) {
      notify("warn", "ATTACHE.Notify.NoPermission");
      return null;
    }
    let app = AttacheCaseApp.#instances.get(actor.uuid);
    if (app) {
      // A forced render also maximizes the window and brings it to the front.
      app.render({ force: true });
      return app;
    }
    app = new AttacheCaseApp({ actor });
    AttacheCaseApp.#instances.set(actor.uuid, app);
    app.render({ force: true });
    return app;
  }

  /**
   * @param {Actor} actor
   * @returns {AttacheCaseApp|undefined} the open window of an actor
   */
  static get(actor) {
    return actor ? AttacheCaseApp.#instances.get(actor.uuid) : undefined;
  }

  /** @returns {AttacheCaseApp|null} the window owning a root element */
  static fromElement(el) {
    for (const app of AttacheCaseApp.#instances.values()) if (app.element === el) return app;
    return null;
  }

  /** Re-render every open window (settings / registry changes). */
  static renderAll() {
    for (const app of AttacheCaseApp.#instances.values()) app.scheduleRender();
  }

  /** Render windows whose update arrived during a drag. */
  static flushDeferredRenders() {
    const apps = [...AttacheCaseApp.#deferred];
    AttacheCaseApp.#deferred.clear();
    for (const app of apps) if (app.rendered) app.render();
  }

  /**
   * React to a document change of `actor` (called from the document hooks).
   * @param {Actor} actor
   */
  static refreshFor(actor) {
    const app = AttacheCaseApp.get(actor);
    if (!app) return;
    if (!actor.testUserPermission(game.user, "OBSERVER")) app.close();
    else app.scheduleRender();
  }

  /* -------------------------------------------- */

  /** @override - core replaces `uniqueId` with a counter; keep ours so the window id is stable per actor. */
  _initializeApplicationOptions(options) {
    const { uniqueId } = options;
    const initialized = super._initializeApplicationOptions(options);
    if (uniqueId) initialized.uniqueId = uniqueId;
    return initialized;
  }

  constructor({ actor, ...options } = {}) {
    super({ ...options, uniqueId: actor.uuid.replaceAll(".", "-"), position: { ...fitSize(service.getState(actor)), ...options.position } });
    this.actor = actor;
    this.service = service;
    this.drag = new DragController(this);
    /** @type {import("../foundry/inventory.mjs").InventoryState|null} */
    this.inventory = null;
    this._renderTimer = null;
    this._hoverId = null;
    this._keyDoc = null;
    this._onKey = (event) => this.#onKeyDown(event);
  }

  /** @override */
  get title() {
    return loc("ATTACHE.Window.Title", { actor: this.actor.name });
  }

  /** @returns {boolean} whether the user may change this inventory */
  get isEditable() {
    return this.actor.isOwner;
  }

  /** @returns {number} cell size in px */
  get cellSize() {
    return cellSize();
  }

  /** Coalesce several document updates into one render. */
  scheduleRender() {
    if (!this.rendered) return;
    clearTimeout(this._renderTimer);
    this._renderTimer = setTimeout(() => this.render(), RENDER_DELAY);
  }

  /** @override - never re-render under a running drag; render once it ends. */
  render(options, _options) {
    if (DragController.active && this.rendered) {
      AttacheCaseApp.#deferred.add(this);
      return Promise.resolve(this);
    }
    return super.render(options, _options);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = service.getState(this.actor);
    this.inventory = state;
    const cap = service.capacity(state);
    const editable = this.isEditable;
    const isGM = game.user.isGM;
    const names = showNames();
    const size = (s) => loc("ATTACHE.Window.Size", { w: s.w, h: s.h });

    const panels = state.containers.map((ct) => {
      const fill = cap.perContainer.get(ct.id);
      const tiles = [];
      for (const [id, p] of state.layout.placed) {
        if (p.c !== ct.id) continue;
        const { item, size: s } = state.entries.get(id);
        tiles.push({
          id, name: item.name, img: item.img, x: p.x, y: p.y, w: p.w, h: p.h, uw: s.w, uh: s.h, r: p.r,
          small: p.w === 1 || p.h === 1,
          tooltip: this.#tooltip(item, s)
        });
      }
      return {
        id: ct.id,
        isBody: ct.id === BODY_ID,
        name: ct.item?.name ?? loc("ATTACHE.Window.Body"),
        img: ct.item?.img ?? null,
        cols: ct.cols,
        rows: ct.rows,
        dims: loc("ATTACHE.Window.Size", { w: ct.cols, h: ct.rows }),
        fill: fill.pct,
        fillLabel: loc("ATTACHE.Window.Fill", { pct: fill.pct }),
        tiles,
        narrow: ct.cols * this.cellSize < 200,
        menu: isGM
      };
    });

    const chip = (item, kind) => {
      const s = state.entries.get(item.id)?.size ?? service.itemSize(item).size;
      return {
        id: item.id, name: item.name, img: item.img, kind,
        size: s ? size(s) : "",
        tooltip: this.#tooltip(item, s),
        draggable: editable && Boolean(s)
      };
    };

    return Object.assign(context, {
      actor: this.actor,
      editable,
      isGM,
      showNames: names,
      cell: this.cellSize,
      capacity: { ...cap, label: loc("ATTACHE.Window.Capacity", { used: cap.used, total: cap.total, pct: cap.pct }) },
      panels,
      worn: { enabled: wornEnabled(), items: state.worn.map((i) => chip(i, "worn")) },
      overflow: { items: state.overflow.map((i) => chip(i, "overflow")), count: state.overflow.length },
      excluded: { show: isGM && state.excluded.length > 0, open: this._excludedOpen, items: state.excluded.map((i) => chip(i, "excluded")) }
    });
  }

  /** Tooltip HTML: name, size and type. */
  #tooltip(item, size) {
    const esc = foundry.utils.escapeHTML;
    const meta = [size ? loc("ATTACHE.Window.Size", { w: size.w, h: size.h }) : null, typeLabel(item.type)].filter(Boolean);
    return `<strong>${esc(item.name)}</strong><div class="attache-tip-meta">${esc(meta.join(" · "))}</div>`;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const root = this.element;
    root.dataset.actorUuid = this.actor.uuid;
    this.drag.bind(root);
    root.addEventListener("dblclick", (event) => this.#onDoubleClick(event));
    root.addEventListener("pointerover", (event) => {
      AttacheCaseApp.#hovered = this;
      this._hoverId = event.target.closest?.(".attache-item[data-item-id]")?.dataset.itemId ?? null;
    });
    root.addEventListener("pointerleave", () => {
      if (AttacheCaseApp.#hovered === this) AttacheCaseApp.#hovered = null;
      this._hoverId = null;
    });
    root.addEventListener("dragover", (event) => this.#onExternalDragOver(event));
    root.addEventListener("dragleave", (event) => {
      if (!root.contains(event.relatedTarget)) this.clearPreview();
    });
    root.addEventListener("drop", (event) => this.#onExternalDrop(event));
    // "toggle" does not bubble: listen in the capture phase to remember the <details> state.
    root.addEventListener("toggle", (event) => {
      if (event.target.classList?.contains("attache-excluded")) this._excludedOpen = event.target.open;
    }, true);
    this.#createContextMenus();
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    root.style.setProperty("--attache-cell", `${this.cellSize}px`);
    root.classList.toggle("is-readonly", !this.isEditable);
    if (this.window?.title) this.window.title.textContent = this.title;
    // Detaching moves the element to another document: follow it with the key listener.
    const doc = root.ownerDocument;
    if (this._keyDoc !== doc) {
      this._keyDoc?.removeEventListener("keydown", this._onKey);
      doc.addEventListener("keydown", this._onKey);
      this._keyDoc = doc;
    }
    this.#refit(options);
    if (this._focusId) {
      root.querySelector(`.attache-item[data-item-id="${CSS.escape(this._focusId)}"]`)?.focus({ preventScroll: true });
      this._focusId = null;
    }
  }

  /**
   * Grow the window when its containers change (a bag added or enlarged), so the new grid is not
   * hidden below the fold. Never shrinks: the user may have sized the window on purpose.
   */
  #refit(options) {
    const shape = `${this.cellSize}|${this.inventory.containers.map((c) => `${c.id}:${c.cols}x${c.rows}`).join(",")}`;
    const changed = this._shape !== undefined && this._shape !== shape;
    this._shape = shape;
    if (!changed || options.isFirstRender || this.minimized) return;
    const fit = fitSize(this.inventory);
    const { width, height } = this.position;
    if (fit.width > width || fit.height > height) {
      this.setPosition({ width: Math.max(width, fit.width), height: Math.max(height, fit.height) });
    }
  }

  /** @override */
  async _preRender(context, options) {
    await super._preRender(context, options);
    const active = this.element?.ownerDocument.activeElement;
    if (active && this.element.contains(active)) this._focusId = active.closest(".attache-item")?.dataset.itemId ?? null;
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    clearTimeout(this._renderTimer);
    this.drag.destroy();
    this._keyDoc?.removeEventListener("keydown", this._onKey);
    this._keyDoc = null;
    AttacheCaseApp.#deferred.delete(this);
    if (AttacheCaseApp.#hovered === this) AttacheCaseApp.#hovered = null;
    if (AttacheCaseApp.#instances.get(this.actor.uuid) === this) AttacheCaseApp.#instances.delete(this.actor.uuid);
  }

  /* -------------------------------------------- */
  /*  Helpers used by the drag controller         */
  /* -------------------------------------------- */

  /**
   * @param {string} itemId
   * @returns {{size:{w:number,h:number}, r:boolean, kind:"tile"|"overflow"|"worn"}|null}
   */
  itemInfo(itemId) {
    const s = this.inventory;
    if (!s) return null;
    const entry = s.entries.get(itemId);
    if (entry) {
      const p = s.layout.placed.get(itemId);
      return { size: entry.size, r: Boolean(p?.r), kind: p ? "tile" : "overflow" };
    }
    const worn = s.worn.find((i) => i.id === itemId);
    if (worn) {
      const size = service.itemSize(worn).size;
      return size ? { size, r: false, kind: "worn" } : null;
    }
    return null;
  }

  /** Show the footprint preview in a grid of this window. */
  showFootprint(gridEl, pos, fp, valid) {
    this.#clearZones();
    let el = this._footprint;
    if (!el || el.parentElement !== gridEl) {
      el?.remove();
      el = gridEl.ownerDocument.createElement("div");
      el.className = "attache-footprint";
      gridEl.append(el);
      this._footprint = el;
    }
    el.style.setProperty("--x", pos.x);
    el.style.setProperty("--y", pos.y);
    el.style.setProperty("--w", fp.w);
    el.style.setProperty("--h", fp.h);
    el.classList.toggle("is-valid", valid);
    el.classList.toggle("is-invalid", !valid);
  }

  /** Highlight a drop zone ("overflow" / "worn"); "none" clears. */
  showZone(kind, valid) {
    this._footprint?.remove();
    this._footprint = null;
    this.#clearZones();
    const zone = kind === "overflow" || kind === "worn" ? this.element?.querySelector(`.attache-${kind}`) : null;
    zone?.classList.add(valid ? "is-drop-target" : "is-drop-invalid");
  }

  #clearZones() {
    for (const z of this.element?.querySelectorAll(".is-drop-target, .is-drop-invalid") ?? []) {
      z.classList.remove("is-drop-target", "is-drop-invalid");
    }
  }

  /** Remove every drag preview. */
  clearPreview() {
    this._footprint?.remove();
    this._footprint = null;
    this.#clearZones();
  }

  /** Move a tile immediately (the document update re-renders shortly after). */
  optimisticMove(itemId, pos, size) {
    const tile = this.element?.querySelector(`.attache-tile[data-item-id="${CSS.escape(itemId)}"]`);
    const grid = this.element?.querySelector(`.attache-grid[data-container-id="${CSS.escape(pos.c)}"]`);
    if (!tile || !grid) return;
    if (tile.parentElement !== grid) grid.append(tile);
    const w = pos.r ? size.h : size.w;
    const h = pos.r ? size.w : size.h;
    for (const [k, v] of Object.entries({ x: pos.x, y: pos.y, w, h })) tile.style.setProperty(`--${k}`, v);
    tile.classList.toggle("is-rotated", Boolean(pos.r));
  }

  /** Hide an item element immediately (it is leaving this view). */
  optimisticHide(itemId) {
    for (const el of this.element?.querySelectorAll(`.attache-item[data-item-id="${CSS.escape(itemId)}"]`) ?? []) {
      el.classList.add("is-leaving");
    }
  }

  notifyNoSpace(item) {
    notify("warn", "ATTACHE.Notify.NoSpace", { name: item.name });
  }

  /* -------------------------------------------- */
  /*  Input                                       */
  /* -------------------------------------------- */

  #onDoubleClick(event) {
    const id = event.target.closest(".attache-item[data-item-id]")?.dataset.itemId;
    if (id) this.actor.items.get(id)?.sheet?.render({ force: true });
  }

  /** R rotates the hovered / focused tile; arrows move the focused tile; Enter opens it. */
  #onKeyDown(event) {
    if (DragController.active || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.closest?.(TYPING)) return;
    const doc = this.element?.ownerDocument;
    const focused = doc?.activeElement?.closest?.(".attache-item[data-item-id]");
    const focusId = focused && this.element.contains(focused) ? focused.dataset.itemId : null;
    if (event.code === "KeyR") {
      // The hovered tile wins; a focused tile only counts when the pointer is not over another case.
      const other = AttacheCaseApp.#hovered && AttacheCaseApp.#hovered !== this;
      const id = this._hoverId ?? (other ? null : focusId);
      if (!id || !this.isEditable || !this.inventory?.layout.placed.has(id)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) service.rotateInPlace(this.actor, id);
      return;
    }
    if (!focusId) return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.actor.items.get(focusId)?.sheet?.render({ force: true });
      return;
    }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    const p = this.inventory?.layout.placed.get(focusId);
    if (!delta || !p || !this.isEditable) return;
    event.preventDefault();
    event.stopPropagation();
    const pos = { c: p.c, x: p.x + delta[0], y: p.y + delta[1], r: p.r };
    const { size } = this.inventory.entries.get(focusId);
    this.optimisticMove(focusId, pos, size);
    this._focusId = focusId;
    service.moveItem(this.actor, focusId, pos).then((ok) => {
      if (!ok) this.render();
    });
  }

  /** Where an external drop at this event would land. */
  #dropTarget(event) {
    const el = event.target.closest?.(".attache-grid[data-container-id], .attache-overflow, .attache-worn");
    if (!el) return null;
    if (el.classList.contains("attache-overflow")) return { kind: "overflow" };
    if (el.classList.contains("attache-worn")) return { kind: "worn" };
    const rect = el.getBoundingClientRect();
    const cell = this.cellSize * screenScale(el);
    return {
      kind: "cell", el,
      pos: { c: el.dataset.containerId, x: Math.floor((event.clientX - rect.left) / cell), y: Math.floor((event.clientY - rect.top) / cell), r: false }
    };
  }

  #onExternalDragOver(event) {
    if (!this.isEditable || DragController.active) return;
    const target = this.#dropTarget(event);
    if (!target) return this.clearPreview();
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    if (target.kind === "cell") this.showFootprint(target.el, target.pos, { w: 1, h: 1 }, true);
    else this.showZone(target.kind, true);
  }

  async #onExternalDrop(event) {
    if (!this.isEditable) return;
    const target = this.#dropTarget(event);
    this.clearPreview();
    if (!target) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item") return;
    event.preventDefault();
    event.stopPropagation();
    delete target.el;
    try {
      await service.addFromDrop(this.actor, data, target);
    } catch (err) {
      console.error(`${MODULE_ID} | drop failed`, err);
    }
  }

  /* -------------------------------------------- */
  /*  Context menus                               */
  /* -------------------------------------------- */

  #createContextMenus() {
    const ContextMenu = foundry.applications.ux.ContextMenu.implementation;
    const item = (li) => this.actor.items.get(li.dataset.itemId);
    const placed = (li) => this.inventory?.layout.placed.get(li.dataset.itemId);
    const editable = () => this.isEditable;
    const worn = (li) => li.dataset.kind === "worn";
    const container = (li) => (li.dataset.containerId === BODY_ID ? null : this.actor.items.get(li.dataset.containerId));

    new ContextMenu(this.element, ".attache-item[data-item-id]", [
      { label: "ATTACHE.Menu.Open", icon: "fa-solid fa-book-open", onClick: (_e, li) => item(li)?.sheet?.render({ force: true }) },
      {
        label: "ATTACHE.Menu.Rotate", icon: "fa-solid fa-rotate",
        visible: (li) => editable() && Boolean(placed(li)) && placed(li).w !== placed(li).h,
        onClick: (_e, li) => service.rotateInPlace(this.actor, li.dataset.itemId)
      },
      {
        label: "ATTACHE.Menu.Stow", icon: "fa-solid fa-box-open",
        visible: (li) => editable() && (Boolean(placed(li)) || worn(li)),
        onClick: (_e, li) => service.stowItem(this.actor, li.dataset.itemId)
      },
      {
        label: "ATTACHE.Menu.Wear", icon: "fa-solid fa-shirt",
        visible: (li) => editable() && wornEnabled() && !worn(li) && li.dataset.kind !== "excluded" && isArmor(item(li)),
        onClick: (_e, li) => service.wearItem(this.actor, li.dataset.itemId)
      },
      {
        label: "ATTACHE.Menu.TakeOff", icon: "fa-solid fa-shirt",
        visible: (li) => editable() && worn(li),
        onClick: (_e, li) => service.takeOffItem(this.actor, li.dataset.itemId)
      },
      {
        label: "ATTACHE.Menu.Give", icon: "fa-solid fa-hand-holding",
        visible: (li) => editable() && li.dataset.kind !== "excluded",
        onClick: (_e, li) => this.#give(item(li))
      },
      {
        label: "ATTACHE.Menu.ItemSize", icon: "fa-solid fa-ruler-combined",
        visible: (li) => canEditSizes(item(li)),
        onClick: (_e, li) => ItemSizeConfig.open(item(li))
      },
      {
        label: "ATTACHE.Menu.Exclude", icon: "fa-solid fa-eye-slash",
        visible: (li) => game.user.isGM && li.dataset.kind !== "excluded",
        onClick: (_e, li) => service.toggleExcluded(item(li))
      },
      {
        label: "ATTACHE.Menu.Include", icon: "fa-solid fa-eye",
        visible: (li) => game.user.isGM && li.dataset.kind === "excluded",
        onClick: (_e, li) => service.toggleExcluded(item(li))
      },
      {
        label: "ATTACHE.Menu.MakeContainer", icon: "fa-solid fa-suitcase",
        visible: () => game.user.isGM,
        onClick: (_e, li) => ItemSizeConfig.open(item(li), { container: true })
      },
      {
        label: "ATTACHE.Menu.Delete", icon: "fa-solid fa-trash",
        visible: () => game.user.isGM,
        onClick: (_e, li) => this.#delete(item(li))
      }
    ], { fixed: true, jQuery: false });

    const panelEntries = [
      {
        label: "ATTACHE.Menu.Resize", icon: "fa-solid fa-up-right-and-down-left-from-center",
        onClick: (_e, li) => this.#resize(li.dataset.containerId)
      },
      {
        label: "ATTACHE.Menu.OpenSheet", icon: "fa-solid fa-book-open",
        visible: (li) => Boolean(container(li)),
        onClick: (_e, li) => container(li)?.sheet?.render({ force: true })
      },
      {
        label: "ATTACHE.Menu.RemoveContainer", icon: "fa-solid fa-trash",
        visible: (li) => Boolean(container(li)),
        onClick: (_e, li) => this.#removeContainer(container(li))
      }
    ];
    if (!game.user.isGM) return;
    new ContextMenu(this.element, ".attache-panel-header[data-container-id]", panelEntries, { fixed: true, jQuery: false });
    new ContextMenu(this.element, ".attache-panel-menu[data-container-id]", panelEntries, { fixed: true, jQuery: false, eventName: "click" });
  }

  async #give(item) {
    if (!item) return;
    const target = await promptGiveTarget(item);
    if (target) await service.transferItem(item, target);
  }

  async #delete(item) {
    if (!item) return;
    if (await confirmDialog("ATTACHE.Menu.Delete", "ATTACHE.Config.DeleteConfirm", { name: item.name })) {
      await service.deleteItem(item);
    }
  }

  async #resize(containerId) {
    const isBody = containerId === BODY_ID;
    const ct = this.inventory?.containers.find((c) => c.id === containerId);
    const current = ct ?? (isBody ? service.bodyDims(this.actor) : null);
    if (!current) return;
    const name = isBody ? loc("ATTACHE.Window.Body") : ct.item.name;
    const dims = await promptResize(name, current, { min: isBody ? 0 : 1 });
    if (dims) await service.resizeContainer(this.actor, containerId, dims);
  }

  async #removeContainer(item) {
    if (!item) return;
    if (await confirmDialog("ATTACHE.Menu.RemoveContainer", "ATTACHE.Config.RemoveConfirm", { name: item.name })) {
      await service.removeContainer(this.actor, item.id);
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {AttacheCaseApp} */
  static async #onAutoArrange(_event, target) {
    if (!this.isEditable) return;
    target.disabled = true;
    try {
      const { overflow } = await service.autoArrange(this.actor);
      if (overflow) notify("info", "ATTACHE.Notify.DidNotFitMany", { count: overflow });
    } finally {
      target.disabled = false;
    }
  }

  /** @this {AttacheCaseApp} */
  static #onConfigure() {
    if (game.user.isGM) ActorConfig.open(this.actor);
  }

  /** @this {AttacheCaseApp} */
  static async #onPackUnstowed() {
    if (!this.isEditable) return;
    const { remaining } = await service.packUnstowed(this.actor);
    if (remaining) notify("info", "ATTACHE.Notify.DidNotFitMany", { count: remaining });
  }

  /** @this {AttacheCaseApp} */
  static #onOpenSheet() {
    this.actor.sheet?.render({ force: true });
  }
}
