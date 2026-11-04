/**
 * Inventory Image dialog for one item: another image for the tile, as a path or from the file picker
 * (whose browse button only exists for users with FILES_BROWSE; the text field works for everybody).
 */

import { MODULE_ID, FLAGS } from "../constants.mjs";
import { bindArtFallback, resolveArt, sanitizeArt } from "../core/art.mjs";
import { canEditArt, moduleFlags } from "../foundry/system-adapter.mjs";
import { setItemArt } from "../foundry/inventory.mjs";
import { loc, notify } from "../foundry/util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemArtConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "attache-art-{id}",
    classes: ["attache-case-dialog", "attache-art-config", "standard-form"],
    tag: "form",
    window: { title: "ATTACHE.Menu.ItemArt", icon: "fa-solid fa-image" },
    position: { width: 480, height: "auto" },
    // A refused path keeps the dialog open: the handler closes it only after a successful write.
    form: { handler: ItemArtConfig.#onSubmit, closeOnSubmit: false, submitOnChange: false },
    actions: { resetArt: ItemArtConfig.#onReset }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/item-art-config.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /**
   * Open (or focus) the dialog for an item. Owners only.
   * @param {Item} item
   * @returns {ItemArtConfig|null}
   */
  static open(item) {
    if (!canEditArt(item)) return null;
    const existing = foundry.applications.instances.get(`attache-art-${item.uuid.replaceAll(".", "-")}`);
    if (existing) {
      existing.bringToFront();
      return existing;
    }
    const app = new ItemArtConfig({ item });
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

  constructor({ item, ...options } = {}) {
    super({ ...options, uniqueId: item.uuid.replaceAll(".", "-") });
    this.item = item;
  }

  /** @override */
  get title() {
    return loc("ATTACHE.Config.ArtTitle", { name: this.item.name });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const path = sanitizeArt(moduleFlags(this.item)[FLAGS.ART]) ?? "";
    return Object.assign(context, {
      rootId: this.id,
      path,
      preview: resolveArt({ art: path, img: this.item.img }),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "ATTACHE.Config.Save" }]
    });
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    bindArtFallback(this.element);
    const onEdit = () => this.#refreshPreview();
    this.element.addEventListener("input", onEdit);
    this.element.addEventListener("change", onEdit);
  }

  /** Show what Save would give, or the item's own image for something that would be refused. */
  #refreshPreview() {
    const img = this.element.querySelector(".attache-art-preview img");
    const { src, fallback } = resolveArt({ art: this.element.elements.art?.value, img: this.item.img });
    if (img.getAttribute("src") === src) return;
    img.dataset.fallback = fallback;
    img.src = src;
  }

  /** @this {ItemArtConfig} */
  static #onReset() {
    this.element.elements.art.value = "";
    this.#refreshPreview();
  }

  /** @this {ItemArtConfig} */
  static async #onSubmit(_event, _form, formData) {
    try {
      if (await setItemArt(this.item, formData.object.art ?? "")) await this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | image config failed`, err);
      notify("error", "ATTACHE.Notify.SaveFailed");
    }
  }
}
