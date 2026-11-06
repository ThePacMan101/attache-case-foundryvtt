/**
 * A tiny in-memory stand-in for the parts of the Foundry v14 client API that the
 * scripts/foundry services use. Good enough to exercise the service logic in Node; it is NOT
 * a substitute for the real-Foundry E2E tests.
 *
 * With `installFoundry({updateHooks: true})` an update also fires `updateItem`, and a second client can
 * be simulated with `env.remote`: every hook is then delivered again with `game.user` swapped for that
 * client, so a handler missing its writing-client guard writes twice. With `system: "dnd5e"` items also
 * get the small part of dnd5e the module calls: `system.contents`, `system.asGear()`, `Item.createWithContents`
 * and `deleteContents`.
 *
 * What it does NOT model: data preparation (AC, encumbrance, `item.container`), dnd5e's `_preCreate`
 * (`preCreateEquipped`, `preCreateGear`, the identifier), schema cleaning and format checks, sockets,
 * permissions beyond the `owner` switch, `strict` update errors, the sort order core assigns, and the sheets.
 * Those are proven in real Foundry by dev/e2e/dnd5e-sync.spec.mjs, and only there.
 */

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

class ForcedDeletion {}

class DataModel {}

/** Apply a flattened/nested update object to plain data, honouring ForcedDeletion. */
function applyUpdate(target, update) {
  for (const [key, value] of Object.entries(update)) {
    if (key === "_id") continue;
    const path = key.split(".");
    let obj = target;
    for (const part of path.slice(0, -1)) {
      if (typeof obj[part] !== "object" || obj[part] === null) obj[part] = {};
      obj = obj[part];
    }
    const last = path.at(-1);
    if (value instanceof ForcedDeletion) delete obj[last];
    else if (value && typeof value === "object" && !Array.isArray(value) && typeof obj[last] === "object" && obj[last]) {
      applyUpdate(obj[last], value);
    } else obj[last] = clone(value);
  }
}

/** Handles of the installed fake, for the documents above. */
let env = null;

/** Fire a document hook on the writing client, then on the simulated second client, if there is one. */
function deliver(name, doc, ...args) {
  const writer = globalThis.game.user.id;
  globalThis.Hooks.call(name, doc, ...args, writer);
  if (!env?.remote) return;
  const user = globalThis.game.user;
  globalThis.game.user = { ...user, id: env.remote, isGM: false };
  try {
    globalThis.Hooks.call(name, doc, ...args, writer);
  } finally {
    globalThis.game.user = user;
  }
}

/** The `changed` of an update: nested, with a removal under `-=key`. */
function changedOf(update) {
  const changed = {};
  for (const [key, value] of Object.entries(update)) {
    const path = key.split(".");
    let o = changed;
    for (const part of path.slice(0, -1)) o = (o[part] ??= {});
    if (value instanceof ForcedDeletion) o[`-=${path.at(-1)}`] = null;
    else o[path.at(-1)] = value;
  }
  return changed;
}

let idCounter = 0;
const newId = () => `id${String(++idCounter).padStart(14, "0")}`;
/** Global write order across actors, so a test can check who was updated first. */
let writeCounter = 0;

class Collection extends Map {
  filter(fn) {
    return [...this.values()].filter(fn);
  }
  find(fn) {
    return [...this.values()].find(fn);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}

/** dnd5e's `item.system`: the source data, plus what the module calls on a physical item. */
function dnd5eSystem(item) {
  const extras = {
    get contents() {
      if (item.type !== "container") return undefined;
      const pool = item.parent ? item.parent.items : globalThis.game.items;
      return new Collection([...pool.values()].filter((i) => i.system.container === item.id).map((i) => [i.id, i]));
    },
    // As d:14344: only a `gear` item is cloned, and a weapon with a compendium source is rebuilt from that
    // source (here: its flags are gone), so `dnd5e.getAsGear` is the only way our flags survive.
    async asGear() {
      if (!item.system.properties?.includes?.("gear")) return item;
      const change = { flags: { dnd5e: { gearSource: item.uuid } } };
      const fromPack = item.type === "weapon" && item._stats.compendiumSource;
      const data = item.toObject();
      if (fromPack) data.flags = {};
      const gear = new FakeItem(data, item.parent);
      applyUpdate(gear._source, change);
      globalThis.Hooks.callAll("dnd5e.getAsGear", item, gear);
      return gear;
    }
  };
  return new Proxy(item._source.system, {
    get: (target, key) => (key in extras ? extras[key] : target[key]),
    has: (target, key) => key in extras || key in target
  });
}

export class FakeItem extends DataModel {
  constructor(data, parent = null) {
    super();
    this._source = { flags: {}, sort: 0, system: {}, ...clone(data) };
    this._source._id ??= newId();
    this._source.system ??= {};
    this.parent = parent;
    this.documentName = "Item";
    this.pack = null;
  }
  get id() { return this._source._id; }
  get _id() { return this._source._id; }
  get name() { return this._source.name; }
  get type() { return this._source.type; }
  get img() { return this._source.img ?? "icons/svg/item-bag.svg"; }
  get sort() { return this._source.sort ?? 0; }
  get flags() { return this._source.flags; }
  get _stats() { return this._source._stats ?? {}; }
  get system() { return globalThis.game?.system?.id === "dnd5e" ? dnd5eSystem(this) : this._source.system; }
  get uuid() { return this.parent ? `${this.parent.uuid}.Item.${this.id}` : `Item.${this.id}`; }
  get isOwner() { return this.parent ? this.parent.isOwner : true; }
  get actor() { return this.parent; }
  getFlag(scope, key) { return this._source.flags?.[scope]?.[key]; }
  toObject() { return clone(this._source); }
  updateSource(update) { applyUpdate(this._source, update); }
  async update(update, options) {
    await this.parent.updateEmbeddedDocuments("Item", [{ _id: this.id, ...update }], options);
    return this;
  }
  async delete(options) { return this.parent.deleteEmbeddedDocuments("Item", [this.id], options); }
}

export class FakeActor {
  constructor({ name = "Actor", type, owner = true, playerOwner = false, items = [], flags = {} } = {}) {
    this._id = newId();
    this.name = name;
    this.type = type;
    this.system = { isNPC: type === "npc" };
    this.documentName = "Actor";
    this.pack = null;
    this.flags = clone(flags);
    this.owner = owner;
    this.hasPlayerOwner = playerOwner;
    this.items = new Collection();
    this.log = [];
    this.failDelete = false;
    for (const data of items) {
      const item = new FakeItem(data, this);
      this.items.set(item.id, item);
    }
  }
  get id() { return this._id; }
  get uuid() { return `Actor.${this._id}`; }
  get isOwner() { return this.owner; }
  testUserPermission(user, level) {
    if (user?.isGM) return true;
    if (level === "OBSERVER") return this.owner || this.observer === true;
    return this.owner;
  }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  async update(update) {
    this.log.push({ op: "updateActor", update, seq: ++writeCounter });
    const data = { flags: this.flags };
    applyUpdate(data, update);
    this.flags = data.flags;
    return this;
  }
  async updateEmbeddedDocuments(_name, updates, options = {}) {
    this.log.push({ op: "update", updates, options });
    // `writeDelay`: our own writes take this long to come back, as a round trip does. The fake is otherwise synchronous.
    if (this.writeDelay && options["attache-case"]?.synced) await new Promise((r) => setTimeout(r, this.writeDelay));
    const out = [];
    const changes = [];
    for (const u of updates) {
      const item = this.items.get(u._id);
      if (!item) continue;
      applyUpdate(item._source, u);
      out.push(item);
      changes.push([item, changedOf(u)]);
    }
    if (env?.updateHooks) for (const [item, changed] of changes) deliver("updateItem", item, changed, options);
    return out;
  }
  async createEmbeddedDocuments(_name, datas, options = {}) {
    // Core v14 writes into the operation object (ClientDocumentMixin#createEmbeddedDocuments sets
    // `operation.parent`), so a frozen or shared options object throws there too.
    options.parent = this;
    this.log.push({ op: "create", datas: clone(datas), options: { ...options, parent: undefined } });
    if (this.failCreate) throw new Error("create refused");
    const pending = datas.map((d) => new FakeItem({ ...clone(d), _id: options.keepId ? d._id : undefined }, this));
    // preCreateItem runs on the writing client only, before any document of the batch exists.
    const accepted = pending.filter((item) => globalThis.Hooks.call("preCreateItem", item, item.toObject(), options, game.user.id) !== false);
    if (this.createOnly !== undefined) accepted.splice(this.createOnly);
    for (const item of accepted) this.items.set(item.id, item);
    for (const item of accepted) deliver("createItem", item, options);
    return accepted;
  }
  async deleteEmbeddedDocuments(_name, ids, options = {}) {
    this.log.push({ op: "delete", ids: [...ids], options });
    if (this.failDelete) throw new Error("delete refused");
    const out = [];
    for (const id of ids) {
      const item = this.items.get(id);
      if (item) {
        this.items.delete(id);
        out.push(item);
      }
    }
    for (const item of out) deliver("deleteItem", item, options);
    // As dnd5e's ContainerData#_onDelete: on the requesting client, not awaited by the delete, and a round trip
    // to the server later, so a handler of `deleteItem` still finds these items and could write to them.
    if (options.deleteContents && game.system.id === "dnd5e") {
      const contents = [...this.items.values()].filter((i) => out.some((o) => o.id === i.system.container));
      if (contents.length) setTimeout(() => this.deleteEmbeddedDocuments("Item", contents.map((i) => i.id), { deleteContents: true }), 3);
    }
    return out;
  }
  /** Every token built on this actor, linked or not, as core's Actor#getDependentTokens. */
  getDependentTokens() {
    return this.dependentTokens ?? [];
  }
}

/**
 * The synthetic actor of an unlinked token: reads fall through to the base actor, writes go to the
 * token's delta, which only holds what the token overrides.
 */
class FakeTokenActor extends FakeActor {
  constructor(base, delta) {
    super({ name: `${base.name} (token)`, type: base.type });
    this.base = base;
    this.delta = delta;
    this.isToken = true;
    // As core: only the delta's own collection tells inherited from forked. `actor.items.manages` says yes to all.
    delta.items = { manages: (id) => this.ownItems.has(id) };
  }
  /** As core's collection delta: the base's items show through until a write forks one into the token. */
  set items(own) { this.ownItems = own; }
  get items() {
    const merged = new Collection();
    for (const item of this.base?.items.values() ?? []) merged.set(item.id, new FakeItem(item.toObject(), this));
    for (const item of this.ownItems.values()) merged.set(item.id, item);
    merged.manages = (id) => merged.has(id);
    return merged;
  }
  async updateEmbeddedDocuments(_name, updates) {
    for (const { _id } of updates) {
      if (!this.ownItems.has(_id) && this.base.items.has(_id)) this.ownItems.set(_id, new FakeItem(this.base.items.get(_id).toObject(), this));
    }
    this.log.push({ op: "tokenWrite", ids: updates.map((u) => u._id) });
    for (const u of updates) applyUpdate(this.ownItems.get(u._id)._source, u);
    return updates.map((u) => this.ownItems.get(u._id));
  }
  getFlag(scope, key) {
    return this.delta.flags?.[scope]?.[key] ?? this.base.getFlag(scope, key);
  }
  async update(update) {
    this.log.push({ op: "updateActor", update, seq: ++writeCounter });
    applyUpdate(this.delta, update);
    return this;
  }
}

/**
 * Install the fake globals. Returns handles to inspect notifications, hooks, settings.
 * @param {object} [options]
 */
export function installFoundry({ system = "CoC7", isGM = false, updateHooks = false } = {}) {
  const notifications = [];
  const hooks = new Map();
  const settings = new Map([
    ["attache-case.defaultBodyCols", 5],
    ["attache-case.defaultBodyRows", 3],
    ["attache-case.autoPlace", true],
    ["attache-case.allowWorn", true],
    ["attache-case.playersCanEditSizes", false],
    ["attache-case.cellSize", 48],
    ["attache-case.showNames", true]
  ]);
  const user = { id: "user1", isGM, documentName: "User" };
  const gm = { id: "gm1", isGM: true, documentName: "User", queries: [], async query(name, data) {
    this.queries.push({ name, data });
    // Run the handler "on the GM client": same fake world, GM identity, player as sender.
    const sender = { ...user };
    const wasGM = user.isGM;
    user.isGM = true;
    try {
      return await globalThis.CONFIG.queries[name](structuredClone(data), { user: sender });
    } finally {
      user.isGM = wasGM;
    }
  } };
  const actors = new Collection();
  const scenes = new Collection();
  const registered = new Map();
  const menus = new Map();
  const confirms = [];
  const dialog = { answer: true };

  class Field {
    constructor(options = {}) {
      this.options = options;
      this.initial = options.initial;
    }
  }

  class DialogV2 {
    static async confirm(config) {
      confirms.push(config);
      return dialog.answer;
    }
  }

  globalThis.foundry = {
    data: { operators: { ForcedDeletion }, fields: { NumberField: class extends Field {}, BooleanField: class extends Field {} } },
    abstract: { DataModel },
    utils: {
      deepClone: clone,
      escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
      hasProperty: (obj, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" && k in o ? o[k] : undefined), obj) !== undefined,
      setProperty: (obj, path, value) => {
        const parts = path.split(".");
        let o = obj;
        for (const part of parts.slice(0, -1)) o = (o[part] && typeof o[part] === "object") ? o[part] : (o[part] = {});
        o[parts.at(-1)] = value;
        return true;
      },
      expandObject: (obj) => {
        const out = {};
        for (const [k, v] of Object.entries(obj)) applyUpdate(out, { [k]: v });
        return out;
      }
    },
    applications: {
      api: {
        ApplicationV2: class {},
        HandlebarsApplicationMixin: (Base) => class extends Base {},
        DialogV2
      },
      ux: { ContextMenu: { implementation: class {} }, TextEditor: { implementation: { getDragEventData: () => ({}) } } },
      sidebar: { apps: { Compendium: class {} } },
      instances: new Map()
    }
  };
  globalThis.game = {
    system: { id: system },
    user,
    users: { activeGM: gm, get: (id) => (id === user.id ? user : id === gm.id ? gm : undefined) },
    settings: {
      // As in core: a value nobody saved reads as the registered default.
      get: (ns, key) => (settings.has(`${ns}.${key}`) ? settings.get(`${ns}.${key}`) : registered.get(`${ns}.${key}`)?.default),
      register: (ns, key, config) => registered.set(`${ns}.${key}`, config),
      registerMenu: (ns, key, config) => menus.set(`${ns}.${key}`, config)
    },
    i18n: { lang: "en", localize: (key, data) => (data ? `${key}${JSON.stringify(data)}` : key) },
    actors,
    scenes,
    items: Object.assign(new Collection(), {
      fromCompendium: (doc, { keepId = false } = {}) => {
        const d = doc.toObject();
        if (!keepId) delete d._id;
        return d;
      }
    }),
    keybindings: { register: () => {} },
    modules: new Map([["attache-case", {}]])
  };
  globalThis.ui = {
    notifications: Object.fromEntries(["info", "warn", "error", "success"].map((t) => [t, (msg) => notifications.push({ type: t, msg })]))
  };
  globalThis.CONFIG = { Item: { typeLabels: {} }, queries: {} };
  globalThis.CONST = {
    SORT_INTEGER_DENSITY: 100000,
    KEYBINDING_PRECEDENCE: { NORMAL: 1 },
    IMAGE_FILE_EXTENSIONS: { apng: "image/apng", avif: "image/avif", bmp: "image/bmp", gif: "image/gif", jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml", tiff: "image/tiff", webp: "image/webp" }
  };
  globalThis.Hooks = {
    on: (name, fn) => {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name).push(fn);
    },
    once: () => {},
    call: (name, ...args) => {
      for (const fn of hooks.get(name) ?? []) if (fn(...args) === false) return false;
      return true;
    },
    callAll: (name, ...args) => {
      for (const fn of hooks.get(name) ?? []) fn(...args);
    }
  };
  globalThis.fromUuid = async (uuid) => {
    for (const actor of actors.values()) {
      if (actor.uuid === uuid) return actor;
      for (const item of actor.items.values()) if (item.uuid === uuid) return item;
    }
    return null;
  };
  globalThis.Item = {
    implementation: {
      fromDropData: async (data) => globalThis.fromUuid(data.uuid),
      // As d:24153, without its transformers: parent first, new ids, children point at their parent's new id, and
      // nothing below MAX_DEPTH (d:14087) is copied, silently.
      async createWithContents(items) {
        const created = [];
        const walk = async (item, container, depth) => {
          const data = globalThis.game.items.fromCompendium(item, { keepId: true });
          data.system.container = container;
          data._id = newId();
          created.push(data);
          const contents = await item.system.contents;
          if (!contents || depth >= 5) return;
          for (const doc of contents.values()) await walk(doc, data._id, depth + 1);
        };
        for (const item of items) await walk(item, undefined, 0);
        return created;
      }
    }
  };
  globalThis.canvas = { tokens: { controlled: [] } };

  env = {
    updateHooks,
    /** Id of a second client that receives every document hook; null = none. */
    remote: null,
    notifications, hooks, settings, user, gm, actors, scenes, registered, menus, confirms, dialog,
    addActor(opts) {
      const a = new FakeActor(opts);
      actors.set(a.id, a);
      return a;
    },
    /**
     * A scene with one token per spec.
     * @param {Array<{base: FakeActor, linked?: boolean, flags?: object, noActor?: boolean}>} specs
     *   A linked token given `flags` keeps them as a leftover delta. `noActor`: the base is gone.
     * @returns {{tokens: Collection}}
     */
    addScene(specs) {
      const tokens = new Collection();
      for (const { base, linked = false, flags, noActor = false } of specs) {
        const delta = linked && !flags ? null : { flags: clone(flags ?? {}) };
        const actor = noActor ? null : linked ? base : new FakeTokenActor(base, delta);
        const token = { id: newId(), actorLink: linked, delta, actor, baseActor: base };
        if (actor && !linked) actor.token = token;
        tokens.set(token.id, token);
        if (actor && base) (base.dependentTokens ??= []).push(token);
        if (actor && !linked) actor.dependentTokens = [token]; // core: a synthetic actor lists its own token
      }
      const scene = { id: newId(), tokens };
      scenes.set(scene.id, scene);
      return scene;
    }
  };
  return env;
}
