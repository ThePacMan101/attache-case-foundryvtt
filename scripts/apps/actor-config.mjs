/**
 * GM dialog for one actor's Attaché Case: body grid size and the list of container items
 * (resize, open, edit, remove, add from presets).
 */

import { MODULE_ID, MAX_DIM, BODY_ID } from "../constants.mjs";
import { CONTAINER_PRESETS } from "../data/container-presets.mjs";
import * as service from "../foundry/inventory.mjs";
import { defaultBody } from "../settings.mjs";
import { loc, notify } from "../foundry/util.mjs";
import { confirmDialog } from "./dialogs.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ActorConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {Map<string, ActorConfig>} open dialogs by actor uuid */
  static #instances = new Map();

  static DEFAULT_OPTIONS = {
    id: "attache-config-{id}",
    classes: ["attache-case-dialog", "attache-actor-config", "standard-form"],
    tag: "form",
    window: { title: "ATTACHE.Window.Configure", icon: "fa-solid fa-briefcase", resizable: true },
    position: { width: 480, height: "auto" },
    form: { handler: ActorConfig.#onSubmit, closeOnSubmit: true, submitOnChange: false },
    actions: {
      addContainer: ActorConfig.#onAddContainer,
      removeContainer: ActorConfig.#onRemoveContainer,
      openContainer: ActorConfig.#onOpenContainer
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/actor-config.hbs`, scrollable: [".attache-config-containers"] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /**
   * Open (or focus) the dialog for an actor. GM only.
   * @param {Actor} actor
   */
  static open(actor) {
    if (!game.user.isGM || !actor) return null;
    let app = ActorConfig.#instances.get(actor.uuid);
    if (!app) {
      app = new ActorConfig({ actor });
      ActorConfig.#instances.set(actor.uuid, app);
    }
    // A forced render also maximizes the window and brings it to the front.
    app.render({ force: true });
    return app;
  }

  /** Re-render the open dialog of an actor after its items changed. */
  static refreshFor(actor) {
    const app = actor && ActorConfig.#instances.get(actor.uuid);
    if (app?.rendered) app.render({ parts: ["form"] });
  }

  /** @override - core replaces `uniqueId` with a counter; keep ours so the window id is stable per actor. */
  _initializeApplicationOptions(options) {
    const { uniqueId } = options;
    const initialized = super._initializeApplicationOptions(options);
    if (uniqueId) initialized.uniqueId = uniqueId;
    return initialized;
  }

  /** @type {Map<string, string|boolean>} values the GM typed and has not saved yet, by input name */
  #edits = new Map();

  constructor({ actor, ...options } = {}) {
    super({ ...options, uniqueId: actor.uuid.replaceAll(".", "-") });
    this.actor = actor;
  }

  /** @override */
  get title() {
    return loc("ATTACHE.Config.ActorTitle", { actor: this.actor.name });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const body = service.bodyDims(this.actor);
    const def = defaultBody();
    const state = service.getState(this.actor);
    const size = (w, h) => loc("ATTACHE.Window.Size", { w, h });
    return Object.assign(context, {
      rootId: this.id,
      max: MAX_DIM,
      body: { cols: body.cols, rows: body.rows, useDefault: !body.custom },
      defaultLabel: loc("ATTACHE.Config.UseDefault", { size: size(def.cols, def.rows) }),
      containers: state.containers.filter((c) => c.id !== BODY_ID).map((c) => ({
        id: c.id, name: c.item.name, img: c.item.img, cols: c.cols, rows: c.rows
      })),
      presets: CONTAINER_PRESETS.map((p) => ({ key: p.key, label: `${loc(p.name)} (${size(p.cols, p.rows)})` })),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "ATTACHE.Config.Save" }]
    });
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Toggling "use world default" greys out the body fields without a re-render.
    this.element.addEventListener("change", (event) => {
      if (event.target.name === "body.useDefault") this.#syncBody();
    });
    // Remember unsaved edits: adding or removing a container re-renders the form.
    const remember = ({ target: el }) => {
      if (el.name && el.name !== "preset") this.#edits.set(el.name, el.type === "checkbox" ? el.checked : el.value);
    };
    this.element.addEventListener("input", remember);
    this.element.addEventListener("change", remember);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const f = this.element.elements;
    for (const [name, value] of this.#edits) {
      const el = f[name];
      if (!el) continue;
      if (el.type === "checkbox") el.checked = value;
      else el.value = value;
    }
    this.#syncBody();
  }

  #syncBody() {
    const f = this.element.elements;
    const useDefault = f["body.useDefault"]?.checked;
    for (const k of ["body.cols", "body.rows"]) if (f[k]) f[k].disabled = useDefault;
    if (useDefault) {
      const def = defaultBody();
      f["body.cols"].value = def.cols;
      f["body.rows"].value = def.rows;
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if (ActorConfig.#instances.get(this.actor.uuid) === this) ActorConfig.#instances.delete(this.actor.uuid);
  }

  /** @this {ActorConfig} */
  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    try {
      await service.setBody(this.actor, data.body?.useDefault ? null : { cols: data.body?.cols, rows: data.body?.rows });
      if (data.containers) await service.resizeContainers(this.actor, data.containers);
    } catch (err) {
      console.error(`${MODULE_ID} | actor config failed`, err);
      notify("error", "ATTACHE.Notify.SaveFailed");
    }
  }

  /** @this {ActorConfig} */
  static async #onAddContainer(_event, target) {
    const key = this.element.elements.preset?.value;
    if (!key) return;
    target.disabled = true;
    try {
      await service.addPresetContainer(this.actor, key);
    } finally {
      target.disabled = false;
    }
  }

  /** @this {ActorConfig} */
  static async #onRemoveContainer(_event, target) {
    const item = this.actor.items.get(target.closest("[data-container-id]")?.dataset.containerId);
    if (!item) return;
    if (await confirmDialog("ATTACHE.Menu.RemoveContainer", "ATTACHE.Config.RemoveConfirm", { name: item.name })) {
      await service.removeContainer(this.actor, item.id);
    }
  }

  /** @this {ActorConfig} */
  static #onOpenContainer(_event, target) {
    this.actor.items.get(target.closest("[data-container-id]")?.dataset.containerId)?.sheet?.render({ force: true });
  }
}
