/**
 * A tiny in-memory stand-in for the parts of the Foundry v14 client API that the
 * scripts/foundry services use. Good enough to exercise the service logic in Node; it is NOT
 * a substitute for the real-Foundry E2E tests.
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

export class FakeItem extends DataModel {
  constructor(data, parent = null) {
    super();
    this._source = { flags: {}, sort: 0, system: {}, ...clone(data) };
    this._source._id ??= newId();
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
  get system() { return this._source.system; }
  get uuid() { return this.parent ? `${this.parent.uuid}.Item.${this.id}` : `Item.${this.id}`; }
  get isOwner() { return this.parent ? this.parent.isOwner : true; }
  get actor() { return this.parent; }
  getFlag(scope, key) { return this._source.flags?.[scope]?.[key]; }
  toObject() { return clone(this._source); }
  updateSource(update) { applyUpdate(this._source, update); }
  async update(update) {
    await this.parent.updateEmbeddedDocuments("Item", [{ _id: this.id, ...update }]);
    return this;
  }
  async delete() { return this.parent.deleteEmbeddedDocuments("Item", [this.id]); }
}

export class FakeActor {
  constructor({ name = "Actor", type, owner = true, playerOwner = false, items = [], flags = {} } = {}) {
    this._id = newId();
    this.name = name;
    this.type = type;
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
  async updateEmbeddedDocuments(_name, updates) {
    this.log.push({ op: "update", updates });
    const out = [];
    for (const u of updates) {
      const item = this.items.get(u._id);
      if (!item) continue;
      applyUpdate(item._source, u);
      out.push(item);
    }
    return out;
  }
  async createEmbeddedDocuments(_name, datas, options = {}) {
    // Core v14 writes into the operation object (ClientDocumentMixin#createEmbeddedDocuments sets
    // `operation.parent`), so a frozen or shared options object throws there too.
    options.parent = this;
    this.log.push({ op: "create", datas: clone(datas), options: { ...options, parent: undefined } });
    const pending = datas.map((d) => new FakeItem({ ...clone(d), _id: undefined }, this));
    for (const item of pending) globalThis.Hooks.call("preCreateItem", item, item.toObject(), options, game.user.id);
    for (const item of pending) this.items.set(item.id, item);
    for (const item of pending) globalThis.Hooks.call("createItem", item, options, game.user.id);
    return pending;
  }
  async deleteEmbeddedDocuments(_name, ids) {
    this.log.push({ op: "delete", ids: [...ids] });
    if (this.failDelete) throw new Error("delete refused");
    const out = [];
    for (const id of ids) {
      const item = this.items.get(id);
      if (item) {
        this.items.delete(id);
        out.push(item);
      }
    }
    return out;
  }
}

/**
 * The synthetic actor of an unlinked token: reads fall through to the base actor, writes go to the
 * token's delta, which only holds what the token overrides.
 */
class FakeTokenActor extends FakeActor {
  constructor(base, delta) {
    super({ name: `${base.name} (token)` });
    this.base = base;
    this.delta = delta;
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
export function installFoundry({ system = "CoC7", isGM = false } = {}) {
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
    items: { fromCompendium: (doc) => { const d = doc.toObject(); delete d._id; return d; } },
    keybindings: { register: () => {} },
    modules: new Map([["attache-case", {}]])
  };
  globalThis.ui = {
    notifications: Object.fromEntries(["info", "warn", "error", "success"].map((t) => [t, (msg) => notifications.push({ type: t, msg })]))
  };
  globalThis.CONFIG = { Item: { typeLabels: {} }, queries: {} };
  globalThis.CONST = { SORT_INTEGER_DENSITY: 100000, KEYBINDING_PRECEDENCE: { NORMAL: 1 } };
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
  globalThis.Item = { implementation: { fromDropData: async (data) => globalThis.fromUuid(data.uuid) } };
  globalThis.canvas = { tokens: { controlled: [] } };

  return {
    notifications, hooks, settings, user, gm, actors, scenes, registered, menus, confirms, dialog,
    addActor(opts) {
      const a = new FakeActor(opts);
      actors.set(a.id, a);
      return a;
    },
    /**
     * A scene with one token per spec.
     * @param {Array<{base: FakeActor, linked?: boolean, flags?: object}>} specs
     * @returns {{tokens: Collection}}
     */
    addScene(specs) {
      const tokens = new Collection();
      for (const { base, linked = false, flags = {} } of specs) {
        const delta = linked ? null : { flags: clone(flags) };
        const token = { id: newId(), actorLink: linked, delta, actor: linked ? base : new FakeTokenActor(base, delta) };
        tokens.set(token.id, token);
      }
      const scene = { id: newId(), tokens };
      scenes.set(scene.id, scene);
      return scene;
    }
  };
}
