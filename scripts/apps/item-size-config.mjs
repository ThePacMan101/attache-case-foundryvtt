/**
 * Inventory Size dialog for one item: footprint override with live preview, reset to the
 * resolved default, exclusion and container dimensions (GM).
 */

import { MODULE_ID, MAX_DIM, FLAGS } from "../constants.mjs";
import { explainSize, sanitizeContainer, sanitizeSize } from "../core/sizes.mjs";
import { describe, moduleFlags } from "../foundry/system-adapter.mjs";
import { registry, setItemConfig } from "../foundry/inventory.mjs";
import { canEditSizes } from "../settings.mjs";
import { loc, notify } from "../foundry/util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SOURCE_KEYS = {
  id: "ATTACHE.Config.Source.Id",
  name: "ATTACHE.Config.Source.Name",
  keyword: "ATTACHE.Config.Source.Keyword",
  type: "ATTACHE.Config.Source.Type",
  fallback: "ATTACHE.Config.Source.Fallback",
  nonPhysical: "ATTACHE.Config.Source.NonPhysical"
};

/** Largest preview, in cells, before the mini grid is scaled down. */
const PREVIEW_PX = 168;

export class ItemSizeConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "attache-size-{id}",
    classes: ["attache-case-dialog", "attache-size-config", "standard-form"],
    tag: "form",
    window: { title: "ATTACHE.Menu.ItemSize", icon: "fa-solid fa-ruler-combined" },
    position: { width: 420, height: "auto" },
    form: { handler: ItemSizeConfig.#onSubmit, closeOnSubmit: true, submitOnChange: false },
    actions: { resetSize: ItemSizeConfig.#onReset }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/item-size-config.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /**
   * Open (or focus) the dialog for an item.
   * @param {Item} item
   * @param {{container?: boolean}} [options] focus the container section
   */
  static open(item, { container = false } = {}) {
    if (!item || !canEditSizes(item)) return null;
    const id = `attache-size-${item.uuid.replaceAll(".", "-")}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) {
      existing.bringToFront();
      return existing;
    }
    const app = new ItemSizeConfig({ item, focusContainer: container });
    app.render({ force: true });
    return app;
  }

  /** @override - core replaces `uniqueId` with a counter; keep ours so the window id is stable per item. */
  _initializeApplicationOptions(options) {
    const { uniqueId } = options;
    const initialized = super._initializeApplicationOptions(options);
    if (uniqueId) initialized.uniqueId = uniqueId;
    return initialized;
  }

  constructor({ item, focusContainer = false, ...options } = {}) {
    super({ ...options, uniqueId: item.uuid.replaceAll(".", "-") });
    this.item = item;
    this.focusContainer = focusContainer;
  }

  /** @override */
  get title() {
    return loc("ATTACHE.Config.SizeTitle", { name: this.item.name });
  }

  /** Resolved size if this item had no size / exclusion override. */
  #defaults() {
    const d = describe(this.item);
    return explainSize({ ...d, flags: { container: undefined, size: undefined, excluded: undefined } }, registry());
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const flags = moduleFlags(this.item);
    const def = this.#defaults();
    const custom = sanitizeSize(flags[FLAGS.SIZE]);
    const size = custom ?? def.size ?? { w: 1, h: 1 };
    const container = sanitizeContainer(flags[FLAGS.CONTAINER]);
    const source = loc(SOURCE_KEYS[def.source] ?? SOURCE_KEYS.fallback);
    const defaultLabel = def.size
      ? loc("ATTACHE.Config.Default", { size: loc("ATTACHE.Window.Size", { w: def.size.w, h: def.size.h }), source })
      : loc("ATTACHE.Config.DefaultNone", { source });
    const excluded = flags[FLAGS.EXCLUDED] === true || (flags[FLAGS.EXCLUDED] !== false && def.excluded);
    return Object.assign(context, {
      rootId: this.id,
      item: this.item,
      max: MAX_DIM,
      w: size.w,
      h: size.h,
      custom: Boolean(custom),
      defaultW: def.size?.w ?? 1,
      defaultH: def.size?.h ?? 1,
      defaultLabel,
      excluded,
      registryExcluded: def.excluded,
      isGM: game.user.isGM,
      isContainer: Boolean(container) || this.focusContainer,
      cols: container?.cols ?? 6,
      rows: container?.rows ?? 4,
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "ATTACHE.Config.Save" }]
    });
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const form = this.element;
    const onEdit = (event) => {
      if ((event.target.name === "w" || event.target.name === "h") && form.elements.useDefault) {
        form.elements.useDefault.value = "false";
      }
      this.#refresh();
    };
    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#refresh();
  }

  /** Update the live preview and the enabled state of fields (no re-render). */
  #refresh() {
    const f = this.element.elements;
    const isContainer = f.isContainer?.checked ?? false;
    const excluded = f.excluded?.checked ?? false;
    const dim = (el, fallback) => Math.min(MAX_DIM, Math.max(1, Math.trunc(Number(el?.value)) || fallback));
    const w = isContainer ? dim(f.cols, 1) : dim(f.w, 1);
    const h = isContainer ? dim(f.rows, 1) : dim(f.h, 1);
    for (const name of ["w", "h"]) if (f[name]) f[name].disabled = isContainer || excluded;
    for (const name of ["cols", "rows"]) if (f[name]) f[name].disabled = !isContainer;
    if (f.excluded) f.excluded.disabled = isContainer;
    const sizeSection = this.element.querySelector(".attache-size-fields");
    sizeSection?.classList.toggle("is-disabled", isContainer || excluded);
    this.element.querySelector(".attache-container-fields")?.classList.toggle("is-disabled", !isContainer);

    const preview = this.element.querySelector(".attache-preview-grid");
    if (!preview) return;
    const cell = Math.max(8, Math.min(28, Math.floor(PREVIEW_PX / Math.max(w, h))));
    preview.style.setProperty("--cell", `${cell}px`);
    preview.style.setProperty("--w", w);
    preview.style.setProperty("--h", h);
    preview.classList.toggle("is-container", isContainer);
    preview.classList.toggle("is-excluded", excluded && !isContainer);
    const label = this.element.querySelector(".attache-preview-label");
    if (label) label.textContent = loc("ATTACHE.Window.Size", { w, h });
  }

  /** @this {ItemSizeConfig} */
  static #onReset() {
    const f = this.element.elements;
    const def = this.#defaults();
    f.w.value = def.size?.w ?? 1;
    f.h.value = def.size?.h ?? 1;
    f.useDefault.value = "true";
    this.#refresh();
  }

  /** @this {ItemSizeConfig} */
  static async #onSubmit(_event, form, formData) {
    const data = formData.object;
    const def = this.#defaults();
    const cfg = {};
    const isContainer = game.user.isGM && Boolean(data.isContainer);
    if (game.user.isGM) {
      cfg.container = isContainer ? sanitizeContainer({ cols: data.cols, rows: data.rows }) : null;
      if (!isContainer) {
        const excluded = Boolean(data.excluded);
        cfg.excluded = excluded ? (def.excluded ? null : true) : (def.excluded ? false : null);
      }
    }
    if (!isContainer && form.elements.w && !form.elements.w.disabled) {
      const size = sanitizeSize({ w: data.w, h: data.h });
      const isDefault = def.size && size && size.w === def.size.w && size.h === def.size.h;
      cfg.size = data.useDefault === "true" && isDefault ? null : size;
    }
    try {
      await setItemConfig(this.item, cfg);
    } catch (err) {
      console.error(`${MODULE_ID} | size config failed`, err);
      notify("error", "ATTACHE.Notify.SaveFailed");
    }
  }
}
