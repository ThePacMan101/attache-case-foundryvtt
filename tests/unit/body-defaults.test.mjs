import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundry } from "./helpers/fake-foundry.mjs";

const env = installFoundry({ system: "CoC7" });
const { registerSettings, defaultBody } = await import("../../scripts/settings.mjs");
const adapter = await import("../../scripts/foundry/system-adapter.mjs");
const { defaultBodyFor } = adapter;
const svc = await import("../../scripts/foundry/inventory.mjs");
const { registerHooks } = await import("../../scripts/foundry/hooks.mjs");
const { ResetBodies, resetBodies, registerResetBodiesMenu } = await import("../../scripts/apps/reset-bodies.mjs");
const { AttacheCaseApp } = await import("../../scripts/apps/attache-case-app.mjs");
const { CONTAINER_PRESETS } = await import("../../scripts/data/container-presets.mjs");
const { DEFAULT_REGISTRY } = await import("../../scripts/data/default-sizes.mjs");

const M = "attache-case";
const COLS = `${M}.defaultBodyCols`;
const ROWS = `${M}.defaultBodyRows`;
const customBody = (cols = 2, rows = 2) => ({ [M]: { body: { cols, rows } } });
const hook = (name) => env.hooks.get(name)?.[0];

/** Register for a system on a fresh world: nothing saved yet. */
function freshWorld(system) {
  game.system.id = system;
  env.settings.delete(COLS);
  env.settings.delete(ROWS);
  env.registered.clear();
  env.menus.clear();
  registerSettings(() => {});
}

beforeAll(() => registerHooks());

beforeEach(() => {
  env.actors.clear();
  env.scenes.clear();
  env.notifications.length = 0;
  env.confirms.length = 0;
  env.dialog.answer = true;
  game.user.isGM = true;
  freshWorld("CoC7");
});

describe("defaultBodyFor", () => {
  it("reads the profile member", () => {
    for (const system of ["dnd5e", "CoC7", "deltagreen"]) {
      game.system.id = system;
      expect(defaultBodyFor(system)).toBe(adapter.profile().defaultBody);
    }
  });

  it("is 8x5 on dnd5e, 5x3 on CoC7 and Delta Green", () => {
    expect(defaultBodyFor("dnd5e")).toEqual({ cols: 8, rows: 5 });
    expect(defaultBodyFor("CoC7")).toEqual({ cols: 5, rows: 3 });
    expect(defaultBodyFor("deltagreen")).toEqual({ cols: 5, rows: 3 });
  });

  it("is 5x3 for anything else", () => {
    for (const id of ["pf2e", "", undefined, null, "__proto__", "constructor"]) {
      expect(defaultBodyFor(id), String(id)).toEqual({ cols: 5, rows: 3 });
    }
  });
});

describe("default body settings", () => {
  it.each([["dnd5e", 8, 5], ["CoC7", 5, 3], ["deltagreen", 5, 3]])("a fresh %s world gets %ix%i", (system, cols, rows) => {
    freshWorld(system);
    expect(env.registered.get(COLS).default).toBe(cols);
    expect(env.registered.get(ROWS).default).toBe(rows);
    expect(env.registered.get(COLS).type.initial).toBe(cols);
    expect(env.registered.get(ROWS).type.initial).toBe(rows);
    expect(defaultBody()).toEqual({ cols, rows });
    expect(svc.bodyDims(env.addActor())).toEqual({ cols, rows, custom: false });
  });

  it("a value the GM saved wins over the system default", () => {
    freshWorld("dnd5e");
    env.settings.set(COLS, 12);
    env.settings.set(ROWS, 2);
    expect(defaultBody()).toEqual({ cols: 12, rows: 2 });
    env.settings.set(COLS, 0);
    expect(defaultBody().cols).toBe(0);
  });

  it("a garbage saved value falls back to the system default, not to 5x3", () => {
    freshWorld("dnd5e");
    env.settings.set(COLS, "wide");
    env.settings.set(ROWS, -1);
    expect(defaultBody()).toEqual({ cols: 8, rows: 5 });
  });

  it("an actor flag still wins", () => {
    freshWorld("dnd5e");
    expect(svc.bodyDims(env.addActor({ flags: customBody(3, 4) }))).toEqual({ cols: 3, rows: 4, custom: true });
  });
});

describe("reset menu registration", () => {
  it("settings.mjs does not import the app: no settings -> reset-bodies -> inventory -> settings cycle", () => {
    const source = readFileSync(new URL("../../scripts/settings.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+"[^"]*apps\//);
    expect(env.menus.size).toBe(0); // registerSettings alone adds no menu
  });

  it("registers a GM-only menu with the application core will construct and render", () => {
    registerResetBodiesMenu();
    const menu = env.menus.get(`${M}.resetBodies`);
    expect(menu).toBeTruthy();
    expect(menu.restricted).toBe(true);
    expect(menu.type).toBe(ResetBodies);
    for (const key of ["name", "label", "hint"]) expect(menu[key]).toMatch(/^ATTACHE\.Settings\.ResetBodies\./);
  });
});

describe("reset of custom sizes", () => {
  it("with no custom size shows an info notification and no dialog", async () => {
    env.addActor();
    env.addScene([{ base: env.addActor() }]);
    await resetBodies();
    expect(env.confirms).toEqual([]);
    expect(env.notifications.map((n) => [n.type, n.msg])).toEqual([["info", "ATTACHE.Notify.NoCustomBodies"]]);
  });

  it("counts world actors and unlinked tokens with their own size, once each", async () => {
    const a = env.addActor({ flags: customBody() });
    env.addActor({ flags: customBody() });
    env.addActor();
    const plain = env.addActor();
    env.addScene([
      { base: plain, flags: customBody(9, 9) }, // own size: counts
      { base: a }, // only inherits from a, which is already counted
      { base: plain }, // no size
      { base: a, linked: true } // linked: it is the world actor itself
    ]);
    env.dialog.answer = false;
    await resetBodies();
    expect(env.confirms).toHaveLength(1);
    expect(env.confirms[0].content.replaceAll("&#34;", '"')).toContain('{"count":3}');
  });

  it("Cancel writes nothing", async () => {
    const a = env.addActor({ flags: customBody() });
    const scene = env.addScene([{ base: env.addActor(), flags: customBody() }]);
    env.dialog.answer = false;
    await resetBodies();
    expect(a.log).toEqual([]);
    expect([...scene.tokens.values()][0].actor.log).toEqual([]);
    expect(a.getFlag(M, "body")).toEqual({ cols: 2, rows: 2 });
    expect(env.notifications).toEqual([]);
  });

  it("Confirm clears world actors first, then token actors, in one action", async () => {
    const a = env.addActor({ flags: customBody() });
    const b = env.addActor({ flags: customBody() });
    const scene = env.addScene([{ base: a, flags: customBody(9, 9) }, { base: b }, { base: env.addActor(), flags: customBody(7, 7) }]);
    const tokens = [...scene.tokens.values()].map((t) => t.actor);
    await resetBodies();
    expect(env.confirms).toHaveLength(1);
    for (const actor of [a, b, ...tokens]) expect(actor.getFlag(M, "body")).toBeUndefined();
    const lastBase = Math.max(a.log[0].seq, b.log[0].seq);
    const written = tokens.filter((t) => t.log.length);
    expect(written).toHaveLength(2); // the token that only inherited needs no write of its own
    for (const t of written) expect(t.log[0].seq).toBeGreaterThan(lastBase);
    expect(svc.bodyDims(tokens[0])).toEqual({ cols: 5, rows: 3, custom: false });
    expect(env.notifications.at(-1).type).toBe("info");
    expect(env.notifications.at(-1).msg).toContain("ATTACHE.Notify.BodiesCleared");
    expect(env.notifications.at(-1).msg).toContain('"count":4');
  });

  it("uses the v14 deletion operator", async () => {
    const a = env.addActor({ flags: customBody() });
    await resetBodies();
    expect(a.log[0].update[`flags.${M}.body`]).toBeInstanceOf(foundry.data.operators.ForcedDeletion);
  });

  it("one failed actor does not stop the others and is reported", async () => {
    const a = env.addActor({ flags: customBody() });
    const b = env.addActor({ flags: customBody() });
    a.update = async () => { throw new Error("refused"); };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await resetBodies();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    expect(b.getFlag(M, "body")).toBeUndefined();
    expect(env.notifications.map((n) => n.type)).toContain("error");
  });

  it("does nothing for a non-GM, even when reached directly, and says why", async () => {
    game.user.isGM = false;
    const a = env.addActor({ flags: customBody() });
    await resetBodies();
    await new ResetBodies().render(true);
    expect(env.confirms).toEqual([]);
    expect(a.log).toEqual([]);
    expect(env.notifications.map((n) => [n.type, n.msg])).toEqual([
      ["warn", "ATTACHE.Notify.NoPermission"], ["warn", "ATTACHE.Notify.NoPermission"]
    ]);
  });

  it("ignores a linked token's leftover delta flags: only the world actor counts", async () => {
    const plain = env.addActor();
    const scene = env.addScene([{ base: plain, linked: true, flags: customBody(9, 9) }]);
    await resetBodies();
    expect(env.confirms).toEqual([]);
    expect(env.notifications.at(-1).msg).toBe("ATTACHE.Notify.NoCustomBodies");
    expect([...scene.tokens.values()][0].delta.flags[M].body).toEqual({ cols: 9, rows: 9 });
  });

  it("skips a token whose base actor is gone", async () => {
    env.addScene([{ base: null, noActor: true, flags: customBody(9, 9) }]);
    await resetBodies();
    expect(env.confirms).toEqual([]);
    expect(env.notifications.at(-1).msg).toBe("ATTACHE.Notify.NoCustomBodies");
    expect(svc.actorsWithCustomBody().tokens).toEqual([]);
  });

  it("the menu application renders no window: it runs the reset", async () => {
    await new ResetBodies().render(true);
    expect(env.notifications.at(-1).msg).toBe("ATTACHE.Notify.NoCustomBodies");
  });
});

describe("updateActor and the unlinked tokens that depend on the actor", () => {
  it("refreshes the windows of the actor and of its unlinked tokens, not of linked ones", () => {
    const refresh = vi.spyOn(AttacheCaseApp, "refreshFor").mockImplementation(() => {});
    const base = env.addActor({ flags: customBody() });
    const scene = env.addScene([{ base }, { base }, { base, linked: true }]);
    const [t1, t2] = [...scene.tokens.values()].map((t) => t.actor);
    hook("updateActor")(base, { flags: customBody(3, 3) });
    expect(refresh.mock.calls.map(([a]) => a)).toEqual([base, t1, t2]);
    refresh.mockRestore();
  });

  it("an update of a token's own actor refreshes only that window", () => {
    const refresh = vi.spyOn(AttacheCaseApp, "refreshFor").mockImplementation(() => {});
    const base = env.addActor();
    const scene = env.addScene([{ base }, { base }]);
    const [t1] = [...scene.tokens.values()].map((t) => t.actor);
    hook("updateActor")(t1, { flags: customBody(3, 3) });
    expect(refresh.mock.calls.map(([a]) => a)).toEqual([t1]);
    refresh.mockRestore();
  });

  it("an update nothing shows refreshes nothing", () => {
    const refresh = vi.spyOn(AttacheCaseApp, "refreshFor").mockImplementation(() => {});
    const base = env.addActor();
    env.addScene([{ base }]);
    hook("updateActor")(base, { system: { hp: 1 } });
    expect(refresh).not.toHaveBeenCalled();
    refresh.mockRestore();
  });
});

describe("dnd5e skeleton", () => {
  beforeEach(() => {
    game.system.id = "dnd5e";
  });

  it("is a supported system with the physical types and 1x1 fallbacks", () => {
    expect(adapter.isSupportedSystem("dnd5e")).toBe(true);
    const types = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];
    expect(DEFAULT_REGISTRY.physicalTypes.dnd5e).toEqual(types);
    for (const type of types) {
      expect(DEFAULT_REGISTRY.byType.dnd5e[type], type).toEqual({ w: 1, h: 1 });
      expect(svc.itemSize({ name: "Zzyzx", type, flags: {} }).size, type).toEqual({ w: 1, h: 1 });
    }
    for (const type of ["spell", "feat", "class", "background", "race", "subclass", "facility"]) {
      expect(svc.itemSize({ name: "Zzyzx", type, flags: {} }).size, type).toBeNull();
    }
  });

  it("the profile has what M3 and M4 will build on", () => {
    const p = adapter.profile();
    expect(p.actorTypes).toEqual(["character", "npc", "vehicle"]);
    expect(p.defaultBody).toEqual({ cols: 8, rows: 5 });
    expect(p.armorTypes).toEqual([]);
    expect(p.containerType).toBe("container");
    expect(p.coreId({ flags: { CoC7: { cocidFlag: { id: "x" } } } })).toBeNull();
  });

  it("supports character, npc and vehicle actors, not group or encounter", () => {
    for (const type of ["character", "npc", "vehicle"]) expect(adapter.isSupportedActor({ documentName: "Actor", type }), type).toBe(true);
    for (const type of ["group", "encounter"]) expect(adapter.isSupportedActor({ documentName: "Actor", type }), type).toBe(false);
  });

  it("builds a container with dnd5e's description shape", () => {
    expect(adapter.containerItemData({ name: "Bag", description: "Big", cols: 4, rows: 3 })).toEqual({
      name: "Bag", type: "container",
      system: { description: { value: "<p>Big</p>" } },
      flags: { [M]: { container: { cols: 4, rows: 3 } } }
    });
  });

  it("offers a short subset of the presets, and only those can be added", async () => {
    const list = adapter.containerPresets();
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThan(CONTAINER_PRESETS.length);
    for (const p of list) expect(CONTAINER_PRESETS).toContain(p);
    const actor = env.addActor({ type: "character" });
    const left = CONTAINER_PRESETS.find((p) => !list.includes(p));
    expect(await svc.addPresetContainer(actor, left.key)).toBeNull();
    const bag = await svc.addPresetContainer(actor, list[0].key);
    expect(bag.type).toBe("container");
    expect(bag.getFlag(M, "container")).toEqual({ cols: list[0].cols, rows: list[0].rows });
  });

  it("a group actor gets no sheet entry and no directory entry; a character gets both", () => {
    const controlsOf = (actor) => {
      const controls = [];
      hook("getHeaderControlsActorSheetV2")({ document: actor, options: { actions: {} } }, controls);
      return controls;
    };
    const character = env.addActor({ type: "character" });
    const group = env.addActor({ type: "group" });
    expect(controlsOf(character).map((c) => c.action)).toEqual(["attacheCaseOpen"]);
    expect(controlsOf(group)).toEqual([]);

    const entries = [];
    hook("getActorContextOptions")({}, entries);
    const [entry] = entries;
    expect(entry.visible({ dataset: { entryId: character.id } })).toBe(true);
    expect(entry.visible({ dataset: { entryId: group.id } })).toBe(false);
  });

  it("registers the item sheet hook of dnd5e", () => {
    expect(hook("getHeaderControlsItemSheet5e")).toBeTypeOf("function");
  });
});

describe("CoC7 and Delta Green stay as they were", () => {
  it.each(["CoC7", "deltagreen"])("%s has no actor type limit and the full preset list", (system) => {
    game.system.id = system;
    expect(adapter.profile().actorTypes).toBeUndefined();
    expect(adapter.profile().defaultBody).toEqual({ cols: 5, rows: 3 });
    for (const type of ["character", "container", "creature", "agent", "unnatural", "group", undefined]) {
      expect(adapter.isSupportedActor({ documentName: "Actor", type }), String(type)).toBe(true);
    }
    expect(adapter.containerPresets()).toBe(CONTAINER_PRESETS);
  });
});
