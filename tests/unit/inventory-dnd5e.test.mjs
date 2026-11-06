/**
 * Native bags and Worn on dnd5e (PLAN M4, A1 A2 A3 A4 A7 A8 A11, D-001 D-002 D-005 D-008 D-009), through the
 * real services and hooks on `fake-foundry`. See that file for what it does not model: no AC, no encumbrance, no
 * sheet, no `_preCreate`. Those are in dev/e2e/dnd5e-sync.spec.mjs.
 */

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { installFoundry } from "./helpers/fake-foundry.mjs";

const env = installFoundry({ system: "dnd5e", updateHooks: true });
const svc = await import("../../scripts/foundry/inventory.mjs");
const { placementFields } = await import("../../scripts/foundry/placement.mjs");
const adapter = await import("../../scripts/foundry/system-adapter.mjs");
const { isWearable, bagDims } = await import("../../scripts/core/dnd5e.mjs");
const { registerHooks } = await import("../../scripts/foundry/hooks.mjs");
const { registerQueries } = await import("../../scripts/foundry/queries.mjs");

const M = "attache-case";
const POS = `flags.${M}.pos`;
const pos = (c, x, y, r = false) => ({ c, x, y, r });
const isDel = (v) => v instanceof foundry.data.operators.ForcedDeletion;
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** A bag by capacity, so its grid comes from `bagDims` and not from a flag. */
const bag = (_id, name = "Backpack", extra = {}) => ({
  _id, name, type: "container", ...extra,
  system: { container: null, capacity: { weight: { value: 30, units: "lb" } }, ...extra.system }
});
/** A sized loose thing; `in` is the bag, `at` our pos flag. */
const thing = (_id, w = 1, h = 1, { in: container = null, at, type = "loot", name, ours, system, ...rest } = {}) => ({
  _id, name: name ?? _id, type, system: { container, ...system },
  flags: { [M]: { size: { w, h }, ...(at === undefined ? {} : { pos: at }), ...ours } }, ...rest
});
const armor = (_id, { in: container = null, equipped = false, at, value = "heavy" } = {}) => thing(_id, 4, 4, {
  type: "equipment", name: "Chain Mail", in: container, at, system: { type: { value, baseItem: "chainmail" }, equipped }
});
const tinderbox = (_id, { in: container = null, at } = {}) => thing(_id, 1, 1, {
  type: "equipment", name: "Tinderbox", in: container, at, system: { type: { value: "trinket" }, equipped: true }
});
const waterskin = (_id, { in: container = null, at } = {}) => ({
  _id, name: "Waterskin", type: "container", system: { container, capacity: { weight: { value: 4, units: "lb" } }, identifier: "waterskin" },
  flags: { [M]: { size: { w: 2, h: 1 }, ...(at ? { pos: at } : {}) } }
});

const hero = (items = [], opts = {}) => env.addActor({
  name: "Hero", type: "character", flags: { [M]: { body: { cols: 8, rows: 5 } } }, items, ...opts
});
const updates = (actor) => actor.log.filter((l) => l.op === "update");
const lastFields = (actor) => updates(actor).at(-1)?.updates[0];
const of = (actor, id) => actor.items.get(id);
const place = (actor, id) => svc.getState(actor).layout.placed.get(id);
const inOverflow = (actor, id) => svc.getState(actor).overflow.some((i) => i.id === id);
const hasKey = (o, key) => Object.hasOwn(o ?? {}, key);

beforeAll(() => {
  registerHooks();
  registerQueries();
});

beforeEach(() => {
  env.actors.clear();
  env.notifications.length = 0;
  env.remote = null;
  env.settings.set(`${M}.autoPlace`, true);
  env.settings.set(`${M}.allowWorn`, true);
  game.user.isGM = false;
});

afterEach(() => settle(1));

describe("isWearable (D-005)", () => {
  const eq = (name, value, extra = {}) => ({ name, type: "equipment", system: { type: { value }, ...extra } });
  for (const value of ["light", "medium", "heavy", "natural", "shield", "clothing"]) {
    it(`equipment of type ${value}`, () => expect(isWearable(eq("Zzyzx", value))).toBe(true));
  }
  for (const [name, value] of [["Traveler's Clothes", "trinket"], ["Fine Clothes", "trinket"], ["Robe", "trinket"], ["Costume", "trinket"], ["Vestments", "trinket"]]) {
    it(`Plutonium's clothes as ${value}: ${name}`, () => expect(isWearable(eq(name, value))).toBe(true));
  }
  it("clothes by identity survive a rename", () => {
    const hash = { flags: { plutonium: { page: "items.html", hash: "traveler's%20clothes_xphb" } } };
    expect(isWearable({ ...eq("Roupa Velha 2", "trinket"), ...hash })).toBe(true);
    expect(isWearable(eq("Presente", "trinket", { identifier: "fine-clothes" }))).toBe(true);
  });
  for (const name of ["Exotic Saddle", "Military Saddle", "Pack Saddle", "Riding Saddle", "Bit and Bridle"]) {
    it(`saddles and tack are not worn: ${name}`, () => expect(isWearable(eq(name, "clothing"))).toBe(false));
  }
  for (const [name, value] of [["Tinderbox", "trinket"], ["Rope", "trinket"], ["Lamp", "trinket"], ["Ring of Protection", "ring"], ["Wand of Sparks", "wand"]]) {
    it(`not wearable: ${name}`, () => expect(isWearable(eq(name, value))).toBe(false));
  }
  it("other types never are, even named like clothes", () => {
    expect(isWearable({ name: "Longsword", type: "weapon", system: { type: { value: "martialM" }, equipped: true } })).toBe(false);
    expect(isWearable({ name: "Robe", type: "loot", system: {} })).toBe(false);
    expect(isWearable({ name: "Backpack", type: "container", system: { equipped: true } })).toBe(false);
  });
});

describe("Worn is derived (D-005)", () => {
  it("wearable + equipped + not in a bag = Worn; no flag needed, no grid space", () => {
    const a = hero([armor("mail", { equipped: true })]);
    const s = svc.getState(a);
    expect(s.worn.map((i) => i.id)).toEqual(["mail"]);
    expect(s.entries.has("mail")).toBe(false);
    expect(svc.isWorn(of(a, "mail"))).toBe(true);
  });
  it("an unequipped wearable is a tile", () => {
    const a = hero([armor("mail", { at: pos("body", 0, 0) })]);
    expect(svc.isWorn(of(a, "mail"))).toBe(false);
    expect(place(a, "mail")).toMatchObject({ c: "body" });
  });
  it("a `worn` flag means nothing here", () => {
    const a = hero([thing("mail", 4, 4, { type: "equipment", ours: { worn: true }, system: { type: { value: "heavy" }, equipped: false } })]);
    expect(svc.getState(a).worn).toEqual([]);
  });
  it("equipped weapons, Tinderbox and Rope stay in the grid", () => {
    const a = hero([
      thing("sword", 6, 1, { type: "weapon", at: pos("body", 0, 0), system: { type: { value: "martialM" }, equipped: true } }),
      tinderbox("tb", { at: pos("body", 0, 1) }),
      thing("rope", 2, 2, { type: "equipment", name: "Rope", at: pos("body", 1, 1), system: { type: { value: "trinket" }, equipped: true } })
    ]);
    const s = svc.getState(a);
    expect(s.worn).toEqual([]);
    expect([...s.layout.placed.keys()].sort()).toEqual(["rope", "sword", "tb"]);
  });
  it("contained equipped armor is not Worn and is not rewritten", async () => {
    const a = hero([bag("pack"), armor("mail", { in: "pack", equipped: true, at: pos("pack", 0, 0) })]);
    expect(svc.isWorn(of(a, "mail"))).toBe(false);
    expect(place(a, "mail")).toMatchObject({ c: "pack" });
    await svc.reconcile(a);
    expect(of(a, "mail").system.equipped).toBe(true);
  });
  it("armor in a dangling bag counts as loose, so it can be Worn", () => {
    const a = hero([armor("mail", { in: "gone6789012345", equipped: true })]);
    expect(svc.isWorn(of(a, "mail"))).toBe(true);
  });
  it("Worn disabled: equipped armor is an ordinary tile", () => {
    env.settings.set(`${M}.allowWorn`, false);
    const a = hero([armor("mail", { equipped: true, at: pos("body", 0, 0) })]);
    expect(svc.getState(a).worn).toEqual([]);
    expect(place(a, "mail")).toMatchObject({ c: "body" });
  });
});

describe("which bag: system.container wins (D-001, A2 valid pos)", () => {
  it("a child's tile is valid only in its own bag", () => {
    const a = hero([
      bag("pack"), bag("sack", "Sack"),
      thing("in", 1, 1, { in: "pack", at: pos("pack", 2, 2) }),
      thing("stale", 1, 1, { in: "pack", at: pos("body", 0, 0) }),
      thing("wrong", 1, 1, { in: "pack", at: pos("sack", 0, 0) })
    ]);
    expect(place(a, "in")).toMatchObject({ c: "pack", x: 2, y: 2 });
    expect(inOverflow(a, "stale")).toBe(true);
    expect(inOverflow(a, "wrong")).toBe(true);
  });
  it("a loose item is valid in the body and in a non-native grid, never in a native bag", () => {
    const a = hero([
      bag("pack"),
      thing("crate", 1, 1, { name: "Crate", ours: { container: { cols: 4, rows: 4 } } }),
      thing("a", 1, 1, { at: pos("body", 0, 0) }),
      thing("b", 1, 1, { at: pos("crate", 0, 0) }),
      thing("c", 1, 1, { at: pos("pack", 0, 0) })
    ]);
    expect(place(a, "a")).toMatchObject({ c: "body" });
    expect(place(a, "b")).toMatchObject({ c: "crate" });
    expect(inOverflow(a, "c")).toBe(true);
  });
  it("a dangling id counts as loose, as on the dnd5e sheet", () => {
    const a = hero([thing("lost", 1, 1, { in: "gone6789012345", at: pos("body", 3, 3) })]);
    expect(place(a, "lost")).toMatchObject({ c: "body", x: 3, y: 3 });
  });
  it("an item naming itself counts as loose", () => {
    const a = hero([thing("self", 1, 1, { in: "self", at: pos("body", 1, 1) })]);
    expect(place(a, "self")).toMatchObject({ c: "body" });
  });
  it("Water in a Waterskin: the holder is a tile, the Water has none and is not unstowed", () => {
    const a = hero([
      waterskin("skin", { at: pos("body", 0, 0) }),
      thing("water", 1, 1, { in: "skin", type: "consumable", name: "Water (Pint)" })
    ]);
    const s = svc.getState(a);
    expect(place(a, "skin")).toMatchObject({ c: "body" });
    expect(s.entries.has("water")).toBe(false);
    expect(s.overflow).toEqual([]);
    expect(s.containers.map((c) => c.id)).toEqual(["body"]);
    expect(svc.getLayout(a).held).toEqual(["water"]);
  });
  it("arrows in a Quiver have no tile either", () => {
    const a = hero([
      { _id: "q", name: "Quiver", type: "container", system: { container: null, capacity: { count: 20 } }, flags: { [M]: { pos: pos("body", 0, 0) } } },
      thing("arrows", 2, 1, { in: "q", type: "consumable", name: "Arrow" })
    ]);
    expect(svc.getState(a).entries.has("arrows")).toBe(false);
    expect(svc.getState(a).entries.has("q")).toBe(true);
  });
  it("a pointer to a plain item hides it on the sheet, so the case shows it in Unstowed, and a user move clears it", async () => {
    const a = hero([thing("rock", 1, 1, { at: pos("body", 0, 0) }), thing("pebble", 1, 1, { in: "rock", at: pos("body", 2, 2) })]);
    expect(svc.getState(a).held).toEqual([]);
    expect(inOverflow(a, "pebble")).toBe(true);
    await svc.reconcile(a);
    expect(of(a, "pebble").system.container).toBe("rock");
    expect(await svc.moveItem(a, "pebble", pos("body", 3, 3))).toBe(true);
    expect(of(a, "pebble").system.container).toBeNull();
    expect(place(a, "pebble")).toMatchObject({ c: "body", x: 3, y: 3 });
  });
  it("a pointer to a plain item: the user's Place Unstowed takes it out as well", async () => {
    const a = hero([thing("rock", 1, 1, { at: pos("body", 0, 0) }), thing("pebble", 1, 1, { in: "rock" })]);
    await svc.packUnstowed(a, { userAction: true });
    expect(of(a, "pebble").system.container).toBeNull();
    expect(place(a, "pebble")).toMatchObject({ c: "body" });
  });
  it("Auto-arrange leaves such a pointer alone", async () => {
    const a = hero([thing("rock", 1, 1, { at: pos("body", 0, 0) }), thing("pebble", 1, 1, { in: "rock" })]);
    await svc.autoArrange(a);
    expect(of(a, "pebble").system.container).toBe("rock");
    expect(inOverflow(a, "pebble")).toBe(true);
  });
  it("an excluded item inside a bag stays on the GM's list and has no tile", () => {
    const a = hero([bag("pack"), thing("bite", 1, 1, { in: "pack", type: "weapon", name: "Bite", ours: { size: undefined }, system: { type: { value: "natural" } } })]);
    expect(svc.getState(a).excluded.map((i) => i.id)).toEqual(["bite"]);
  });
});

describe("placementFields (A1, the only source of pos, container and equipped)", () => {
  it("a user move into a bag: pos and container together", () => {
    const a = hero([bag("pack"), thing("x")]);
    expect(placementFields(of(a, "x"), { pos: pos("pack", 1, 2) }, { actor: a, userAction: true }))
      .toEqual({ [POS]: pos("pack", 1, 2), "system.container": "pack" });
  });
  it("a user move out: pos and null", () => {
    const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
    expect(placementFields(of(a, "x"), { pos: pos("body", 1, 2) }, { actor: a, userAction: true }))
      .toEqual({ [POS]: pos("body", 1, 2), "system.container": null });
  });
  it("into a non-native grid: pos and null", () => {
    const a = hero([bag("pack"), thing("crate", 1, 1, { ours: { container: { cols: 4, rows: 4 } } }), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
    expect(placementFields(of(a, "x"), { pos: pos("crate", 0, 0) }, { actor: a, userAction: true }))
      .toEqual({ [POS]: pos("crate", 0, 0), "system.container": null });
  });
  it("a plain item made a container has no native sync: nothing points at it", () => {
    const a = hero([thing("crate", 1, 1, { ours: { container: { cols: 4, rows: 4 } } }), thing("x")]);
    expect(placementFields(of(a, "x"), { pos: pos("crate", 0, 0) }, { actor: a, userAction: true })).toEqual({ [POS]: pos("crate", 0, 0) });
  });
  it("an automatic path never writes native data", () => {
    const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack" }), armor("mail", { equipped: true })]);
    expect(placementFields(of(a, "x"), { pos: pos("body", 0, 0) }, { actor: a, userAction: false })).toEqual({ [POS]: pos("body", 0, 0) });
    expect(placementFields(of(a, "mail"), { pos: pos("body", 0, 0) }, { actor: a, userAction: false })).toEqual({ [POS]: pos("body", 0, 0) });
  });
  it("nothing to change: no keys", () => {
    const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 1, 1) })]);
    expect(placementFields(of(a, "x"), { pos: pos("pack", 1, 1) }, { actor: a, userAction: true })).toEqual({});
  });
  it("raw data for a copy: a bag on the target actor is resolved there", () => {
    const a = hero([bag("pack")]);
    const data = { name: "Coin", type: "loot", flags: {}, system: { container: null } };
    expect(placementFields(data, { pos: pos("pack", 0, 0) }, { actor: a, userAction: true }))
      .toEqual({ [POS]: pos("pack", 0, 0), "system.container": "pack" });
  });
  it("Worn on raw data: equipped, no pos", () => {
    const a = hero();
    const data = { name: "Chain Mail", type: "equipment", flags: {}, system: { container: null, type: { value: "heavy" } } };
    expect(placementFields(data, { pos: null, worn: true }, { actor: a, userAction: true })).toEqual({ "system.equipped": true });
  });
  it("defaults to the item's own actor", () => {
    const a = hero([bag("pack"), thing("x")]);
    expect(placementFields(of(a, "x"), { pos: pos("pack", 0, 0) }, { userAction: true })["system.container"]).toBe("pack");
  });
});

describe("A3 equipped writes, row by row", () => {
  const moved = async (a, id, p) => {
    expect(await svc.moveItem(a, id, p)).toBe(true);
    return lastFields(a);
  };
  describe("row 1: Worn -> grid or Unstowed writes false", () => {
    it("to a cell", async () => {
      const a = hero([armor("mail", { equipped: true })]);
      const u = await moved(a, "mail", pos("body", 0, 0));
      expect(u["system.equipped"]).toBe(false);
      expect(u[POS]).toEqual(pos("body", 0, 0));
    });
    it("to a cell of a bag: also the container", async () => {
      const a = hero([bag("pack"), armor("mail", { equipped: true })]);
      const u = await moved(a, "mail", pos("pack", 0, 0));
      expect(u["system.equipped"]).toBe(false);
      expect(u["system.container"]).toBe("pack");
    });
    it("to Unstowed", async () => {
      const a = hero([armor("mail", { equipped: true })]);
      await svc.stowItem(a, "mail");
      expect(lastFields(a)["system.equipped"]).toBe(false);
      expect(of(a, "mail").system.equipped).toBe(false);
      expect(inOverflow(a, "mail")).toBe(true);
    });
  });
  describe("row 2: loose, unequipped -> Worn", () => {
    it("true, and the pos goes", async () => {
      const a = hero([armor("mail", { at: pos("body", 0, 0) })]);
      expect(await svc.wearItem(a, "mail")).toBe(true);
      const u = lastFields(a);
      expect(u["system.equipped"]).toBe(true);
      expect(isDel(u[POS])).toBe(true);
      expect(hasKey(u, "system.container")).toBe(false);
      expect(svc.isWorn(of(a, "mail"))).toBe(true);
    });
  });
  describe("row 3: in a bag, stale equipped -> same bag or rotate writes nothing native", () => {
    it("same bag", async () => {
      const a = hero([bag("pack"), armor("mail", { in: "pack", equipped: true, at: pos("pack", 0, 0) })]);
      const u = await moved(a, "mail", pos("pack", 2, 1));
      expect(u).toEqual({ _id: "mail", [POS]: pos("pack", 2, 1) });
    });
    it("rotate", async () => {
      const a = hero([bag("pack"), thing("long", 3, 1, { type: "equipment", name: "Chain Mail", in: "pack", at: pos("pack", 0, 0), system: { type: { value: "heavy" }, equipped: true } })]);
      expect(await svc.rotateInPlace(a, "long")).toBe(true);
      expect(lastFields(a)).toEqual({ _id: "long", [POS]: pos("pack", 0, 0, true) });
    });
  });
  describe("row 4: in a bag, stale equipped -> elsewhere writes false, or it would jump to Worn", () => {
    it("to the body", async () => {
      const a = hero([bag("pack"), armor("mail", { in: "pack", equipped: true, at: pos("pack", 0, 0) })]);
      const u = await moved(a, "mail", pos("body", 0, 0));
      expect(u["system.equipped"]).toBe(false);
      expect(u["system.container"]).toBeNull();
      expect(place(a, "mail")).toMatchObject({ c: "body", x: 0, y: 0 });
    });
    it("to another bag", async () => {
      const a = hero([bag("pack"), bag("sack", "Sack"), armor("mail", { in: "pack", equipped: true, at: pos("pack", 0, 0) })]);
      const u = await moved(a, "mail", pos("sack", 0, 0));
      expect(u["system.equipped"]).toBe(false);
      expect(u["system.container"]).toBe("sack");
    });
    it("to Unstowed", async () => {
      const a = hero([bag("pack"), armor("mail", { in: "pack", equipped: true, at: pos("pack", 0, 0) })]);
      await svc.stowItem(a, "mail");
      expect(lastFields(a)["system.equipped"]).toBe(false);
      expect(lastFields(a)["system.container"]).toBeNull();
      expect(svc.isWorn(of(a, "mail"))).toBe(false);
      expect(inOverflow(a, "mail")).toBe(true);
    });
  });
  describe("row 5: in a bag, any -> Worn writes true and takes it out", () => {
    for (const equipped of [false, true]) {
      it(`equipped was ${equipped}`, async () => {
        const a = hero([bag("pack"), armor("mail", { in: "pack", equipped, at: pos("pack", 0, 0) })]);
        expect(await svc.wearItem(a, "mail")).toBe(true);
        const u = lastFields(a);
        expect(of(a, "mail").system.equipped).toBe(true);
        expect(u["system.container"]).toBeNull();
        expect(isDel(u[POS])).toBe(true);
        expect(svc.isWorn(of(a, "mail"))).toBe(true);
      });
    }
  });
  describe("row 6: not wearable, or Worn disabled: nothing", () => {
    it("a Tinderbox out of a bag keeps equipped", async () => {
      const a = hero([bag("pack"), tinderbox("tb", { in: "pack", at: pos("pack", 0, 0) })]);
      const u = await moved(a, "tb", pos("body", 0, 0));
      expect(hasKey(u, "system.equipped")).toBe(false);
      expect(of(a, "tb").system.equipped).toBe(true);
    });
    it("a Tinderbox to Unstowed keeps equipped", async () => {
      const a = hero([tinderbox("tb", { at: pos("body", 0, 0) })]);
      await svc.stowItem(a, "tb");
      expect(hasKey(lastFields(a), "system.equipped")).toBe(false);
    });
    it("Worn disabled: equipped armor moves and stays equipped", async () => {
      env.settings.set(`${M}.allowWorn`, false);
      const a = hero([armor("mail", { equipped: true, at: pos("body", 0, 0) })]);
      const u = await moved(a, "mail", pos("body", 1, 0));
      expect(hasKey(u, "system.equipped")).toBe(false);
      expect(of(a, "mail").system.equipped).toBe(true);
    });
    it("Worn disabled: wearing is refused", async () => {
      env.settings.set(`${M}.allowWorn`, false);
      const a = hero([armor("mail", { at: pos("body", 0, 0) })]);
      expect(await svc.wearItem(a, "mail")).toBe(false);
      expect(of(a, "mail").system.equipped).toBe(false);
    });
    it("a weapon is refused with a warning", async () => {
      const a = hero([thing("sword", 6, 1, { type: "weapon", at: pos("body", 0, 0), system: { type: { value: "martialM" } } })]);
      expect(await svc.wearItem(a, "sword")).toBe(false);
      expect(env.notifications.at(-1).type).toBe("warn");
    });
  });
  describe("take off", () => {
    it("with room: a placement and false in one update", async () => {
      const a = hero([armor("mail", { equipped: true })]);
      await svc.takeOffItem(a, "mail");
      expect(updates(a)).toHaveLength(1);
      expect(lastFields(a)["system.equipped"]).toBe(false);
      expect(place(a, "mail")).toMatchObject({ c: "body", x: 0, y: 0 });
    });
    it("with no room: only equipped:false still writes", async () => {
      const a = hero([armor("mail", { equipped: true })], { flags: { [M]: { body: { cols: 1, rows: 1 } } } });
      await svc.takeOffItem(a, "mail");
      expect(lastFields(a)).toEqual({ _id: "mail", "system.equipped": false });
      expect(svc.isWorn(of(a, "mail"))).toBe(false);
      expect(inOverflow(a, "mail")).toBe(true);
    });
    it("takes the grids an automatic path may: never into a bag", async () => {
      const a = hero([bag("pack"), armor("mail", { equipped: true })], { flags: { [M]: { body: { cols: 1, rows: 1 } } } });
      await svc.takeOffItem(a, "mail");
      expect(of(a, "mail").system.container).toBeNull();
      expect(inOverflow(a, "mail")).toBe(true);
    });
  });
  describe("inbound on the writing client", () => {
    it("equipped false on the sheet with a stale valid pos: back where it was, no write", async () => {
      const a = hero([armor("mail", { equipped: true, at: pos("body", 2, 0) })]);
      expect(svc.getState(a).worn).toHaveLength(1);
      await of(a, "mail").update({ "system.equipped": false });
      await settle();
      expect(updates(a)).toHaveLength(1);
      expect(place(a, "mail")).toMatchObject({ c: "body", x: 2, y: 0 });
    });
    it("equipped false with no pos: a spot, by one marked update", async () => {
      const a = hero([armor("mail", { equipped: true })]);
      await of(a, "mail").update({ "system.equipped": false });
      await settle();
      expect(updates(a)).toHaveLength(2);
      expect(updates(a)[1].options[M]?.synced).toBe(true);
      expect(place(a, "mail")).toMatchObject({ c: "body", x: 0, y: 0 });
    });
    it("equipped false with its stale cell taken: another spot", async () => {
      const a = hero([armor("mail", { equipped: true, at: pos("body", 0, 0) }), thing("x", 1, 1, { at: pos("body", 0, 0), sort: -1 })]);
      await of(a, "mail").update({ "system.equipped": false });
      await settle();
      expect(place(a, "mail")).toMatchObject({ c: "body", x: 1, y: 0 });
    });
    it("equipped true on the sheet: just shows in Worn", async () => {
      const a = hero([armor("mail", { at: pos("body", 0, 0) })]);
      await of(a, "mail").update({ "system.equipped": true });
      await settle();
      expect(updates(a)).toHaveLength(1);
      expect(svc.getState(a).worn.map((i) => i.id)).toEqual(["mail"]);
    });
  });
});

describe("A2: where each path may put an item", () => {
  describe("automatic paths never put a loose item in a native bag (D-008)", () => {
    it("preCreate: a full body sends it to Unstowed even if a bag has room", async () => {
      const a = hero([bag("pack"), thing("full", 8, 5, { at: pos("body", 0, 0) })]);
      await a.createEmbeddedDocuments("Item", [thing("new", 1, 1)]);
      await settle();
      const item = a.items.find((i) => i.name === "new");
      expect(item.system.container).toBeNull();
      expect(inOverflow(a, item.id)).toBe(true);
    });
    it("a new bag leaves loose unstowed items alone", async () => {
      const a = hero([thing("bow", 1, 1)], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
      await a.createEmbeddedDocuments("Item", [bag("pack")]);
      await settle();
      expect(of(a, "bow").system.container).toBeNull();
      expect(inOverflow(a, "bow")).toBe(true);
    });
    it("a new actor's items stay out of its bags", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1), thing("y", 1, 1, { in: "pack" })], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
      Hooks.call("createActor", a, {}, game.user.id);
      await settle();
      expect(of(a, "x").system.container).toBeNull();
      expect(inOverflow(a, "x")).toBe(true);
      expect(place(a, "y")).toMatchObject({ c: "pack" });
    });
    it("a bag resized by the GM does not pull anything in", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1)], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
      await svc.resizeContainer(a, "pack", { cols: 4, rows: 4 });
      await settle();
      expect(of(a, "x").system.container).toBeNull();
      expect(inOverflow(a, "x")).toBe(true);
    });
    it("a non-native grid is fine", async () => {
      const a = hero([bag("pack"), thing("crate", 1, 1, { ours: { container: { cols: 4, rows: 4 } } })], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
      await a.createEmbeddedDocuments("Item", [thing("new", 1, 1)]);
      await settle();
      expect(a.items.find((i) => i.name === "new").getFlag(M, "pos")).toMatchObject({ c: "crate" });
    });
  });
  describe("automatic, item with a bag: only its own bag", () => {
    it("preCreate places a child in its bag", async () => {
      const a = hero([bag("pack")]);
      await a.createEmbeddedDocuments("Item", [thing("coin", 1, 1, { in: "pack" })]);
      await settle();
      const item = a.items.find((i) => i.name === "coin");
      expect(item.getFlag(M, "pos")).toMatchObject({ c: "pack", x: 0, y: 0 });
    });
    it("a child that does not fit stays Unstowed with its container, and the body is not used", async () => {
      const a = hero([bag("pack", "Pouch", { system: { capacity: { weight: { value: 6, units: "lb" } } } })]);
      await a.createEmbeddedDocuments("Item", [thing("big", 4, 4, { in: "pack" })]);
      await settle(80);
      const item = a.items.find((i) => i.name === "big");
      expect(item.system.container).toBe("pack");
      expect(inOverflow(a, item.id)).toBe(true);
      expect(env.notifications.filter((n) => n.msg.includes("DidNotFit"))).toHaveLength(1);
    });
    it("a child keeps a copied pos only when it is its own bag's", async () => {
      const a = hero([bag("pack")]);
      await a.createEmbeddedDocuments("Item", [thing("keep", 1, 1, { in: "pack", at: pos("pack", 3, 3) }), thing("drop", 1, 1, { in: "pack", at: pos("body", 3, 3) })]);
      await settle();
      expect(a.items.find((i) => i.name === "keep").getFlag(M, "pos")).toMatchObject({ c: "pack", x: 3, y: 3 });
      expect(a.items.find((i) => i.name === "drop").getFlag(M, "pos")).toMatchObject({ c: "pack" });
    });
    it("a held item gets no pos", async () => {
      const a = hero([waterskin("skin", { at: pos("body", 0, 0) })]);
      await a.createEmbeddedDocuments("Item", [thing("water", 1, 1, { in: "skin" })]);
      await settle();
      expect(a.items.find((i) => i.name === "water").getFlag(M, "pos")).toBeUndefined();
      expect(env.notifications).toEqual([]);
    });
  });
  describe("user drag or drop on a cell: any grid, writes the container", () => {
    it("moveItem into a bag", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1, { at: pos("body", 0, 0) })]);
      expect(await svc.moveItem(a, "x", pos("pack", 1, 1))).toBe(true);
      expect(of(a, "x").system.container).toBe("pack");
      expect(place(a, "x")).toMatchObject({ c: "pack", x: 1, y: 1 });
    });
    it("moveItem out of a bag", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
      expect(await svc.moveItem(a, "x", pos("body", 1, 1))).toBe(true);
      expect(of(a, "x").system.container).toBeNull();
      expect(place(a, "x")).toMatchObject({ c: "body" });
    });
    it("a drop from elsewhere on a bag cell carries the container", async () => {
      const a = hero([bag("pack")]);
      const b = hero([thing("x", 1, 1, { type: "weapon", system: { type: { value: "simpleM" } } })]);
      const created = await svc.addFromDrop(a, { type: "Item", uuid: of(b, "x").uuid }, { kind: "cell", pos: pos("pack", 2, 2) });
      expect(created.system.container).toBe("pack");
      expect(place(a, created.id)).toMatchObject({ c: "pack", x: 2, y: 2 });
    });
    it("a give onto a bag cell carries the container", async () => {
      const a = hero([thing("x", 1, 1)]);
      const b = hero([bag("pack")]);
      await svc.executeTransfer(of(a, "x"), b, { kind: "cell", pos: pos("pack", 2, 2) });
      const given = b.items.find((i) => i.name === "x");
      expect(given.system.container).toBe("pack");
      expect(place(b, given.id)).toMatchObject({ c: "pack", x: 2, y: 2 });
    });
    it("an occupied cell in a bag falls back to that bag", async () => {
      const a = hero([thing("x", 1, 1)]);
      const b = hero([bag("pack"), thing("y", 1, 1, { in: "pack", at: pos("pack", 2, 2) })]);
      await svc.executeTransfer(of(a, "x"), b, { kind: "cell", pos: pos("pack", 2, 2) });
      const given = b.items.find((i) => i.name === "x");
      expect(given.system.container).toBe("pack");
      expect(place(b, given.id)).toMatchObject({ c: "pack" });
    });
    it("a give to Worn on the target: equipped, Worn at once", async () => {
      const a = hero([armor("mail", { at: pos("body", 0, 0) })]);
      const b = hero();
      await svc.executeTransfer(of(a, "mail"), b, { kind: "worn" });
      const given = b.items.find((i) => i.name === "Chain Mail");
      expect(given.system.equipped).toBe(true);
      expect(svc.isWorn(given)).toBe(true);
    });
  });
  describe("give with no cell: body and non-native grids", () => {
    it("never a bag", async () => {
      const a = hero([thing("x", 1, 1, { at: pos("body", 0, 0) })]);
      const b = hero([bag("pack")], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
      await svc.executeTransfer(of(a, "x"), b);
      const given = b.items.find((i) => i.name === "x");
      expect(given.system.container ?? null).toBeNull();
      expect(inOverflow(b, given.id)).toBe(true);
    });
    it("a body cell it can reach", async () => {
      const a = hero([thing("x", 1, 1, { at: pos("body", 0, 0) })]);
      const b = hero([bag("pack")]);
      await svc.executeTransfer(of(a, "x"), b);
      expect(place(b, b.items.find((i) => i.name === "x").id)).toMatchObject({ c: "body" });
    });
  });
  describe("Place Unstowed", () => {
    it("the user's click: a loose item may go into a bag, and writes the container", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1)], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
      const r = await svc.packUnstowed(a, { userAction: true });
      expect(r).toEqual({ placed: 1, remaining: 0 });
      expect(of(a, "x").system.container).toBe("pack");
      expect(place(a, "x")).toMatchObject({ c: "pack" });
    });
    it("the user's click: the body first", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1)]);
      await svc.packUnstowed(a, { userAction: true });
      expect(of(a, "x").system.container).toBeNull();
      expect(place(a, "x")).toMatchObject({ c: "body" });
    });
    it("a child only into its own bag", async () => {
      const a = hero([bag("pack", "Pouch", { system: { capacity: { weight: { value: 6, units: "lb" } } } }), bag("sack", "Sack"), thing("big", 4, 4, { in: "pack" })]);
      const r = await svc.packUnstowed(a, { userAction: true });
      expect(r).toEqual({ placed: 0, remaining: 1 });
      expect(of(a, "big").system.container).toBe("pack");
    });
    it("without userAction a loose item stays out of the bag", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1)], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
      const r = await svc.packUnstowed(a);
      expect(r).toEqual({ placed: 0, remaining: 1 });
      expect(of(a, "x").system.container).toBeNull();
    });
    it("packs in one batched update with the marker", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1), thing("y", 1, 1), thing("z", 1, 1, { in: "pack" })]);
      await svc.packUnstowed(a, { userAction: true });
      await settle();
      expect(updates(a)).toHaveLength(1);
      expect(updates(a)[0].updates).toHaveLength(3);
      expect(updates(a)[0].options[M]?.synced).toBe(true);
    });
  });
  describe("Auto-arrange (D-009)", () => {
    it("children rearrange inside their bag, loose items stay out, native data is never written", async () => {
      const a = hero([
        bag("pack"), bag("sack", "Sack"),
        thing("a1", 2, 2, { in: "pack", at: pos("pack", 6, 4) }),
        thing("a2", 1, 1, { in: "pack" }),
        thing("b1", 2, 2, { in: "sack", at: pos("sack", 3, 2) }),
        thing("l1", 2, 2, { at: pos("body", 5, 3) }),
        armor("worn", { equipped: true }),
        armor("stale", { in: "pack", equipped: true, at: pos("pack", 0, 0) })
      ]);
      await svc.autoArrange(a);
      await settle();
      expect(updates(a)).toHaveLength(1);
      const written = updates(a)[0].updates.flatMap((u) => Object.keys(u));
      expect(written.some((k) => k.startsWith("system."))).toBe(false);
      for (const id of ["a1", "a2", "stale"]) {
        expect(place(a, id)).toMatchObject({ c: "pack" });
        expect(of(a, id).system.container).toBe("pack");
      }
      expect(place(a, "b1")).toMatchObject({ c: "sack", x: 0, y: 0 });
      expect(place(a, "l1")).toMatchObject({ c: "body", x: 0, y: 0 });
      expect(of(a, "stale").system.equipped).toBe(true);
      expect(of(a, "worn").system.equipped).toBe(true);
      expect(of(a, "worn").getFlag(M, "pos")).toBeUndefined();
    });
    it("a loose item that does not fit the body stays out of the bag, with no pos pointing there", async () => {
      const a = hero([bag("pack"), thing("loose", 2, 2, { at: pos("body", 0, 0) })], { flags: { [M]: { body: { cols: 1, rows: 1 } } } });
      await svc.autoArrange(a);
      expect(of(a, "loose").getFlag(M, "pos")).toBeUndefined();
      expect(of(a, "loose").system.container).toBeNull();
    });
    it("reports what remains, per bag and for the rest", async () => {
      const a = hero([
        bag("pack", "Pouch", { system: { capacity: { weight: { value: 6, units: "lb" } } } }),
        thing("big", 4, 4, { in: "pack" }),
        thing("loose", 9, 9)
      ]);
      expect(await svc.autoArrange(a)).toEqual({ placed: 0, overflow: 2 });
      expect(of(a, "big").system.container).toBe("pack");
    });
  });
  describe("user moves to Unstowed", () => {
    it("clears the container and the pos, in one update", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
      await svc.stowItem(a, "x");
      await settle();
      expect(updates(a)).toHaveLength(1);
      expect(of(a, "x").system.container).toBeNull();
      expect(inOverflow(a, "x")).toBe(true);
    });
    it("stays there: the reconcile of a later session and a new bag leave it", async () => {
      const a = hero([thing("x", 1, 1, { at: pos("body", 0, 0) })]);
      await svc.stowItem(a, "x");
      await a.createEmbeddedDocuments("Item", [{ _id: "crate", name: "Crate", type: "loot", system: {}, flags: { [M]: { container: { cols: 4, rows: 4 } } } }]);
      await settle();
      await svc.reconcile(a);
      await settle();
      expect(inOverflow(a, "x")).toBe(true);
    });
    it("the user's Place Unstowed still places it", async () => {
      const a = hero([thing("x", 1, 1, { at: pos("body", 0, 0) })]);
      await svc.stowItem(a, "x");
      await svc.packUnstowed(a, { userAction: true });
      expect(place(a, "x")).toMatchObject({ c: "body" });
    });
  });
});

describe("D-002: one marked update, the writing client only", () => {
  it("a move is one update holding pos and container, with the marker", async () => {
    const a = hero([bag("pack"), thing("x", 1, 1, { at: pos("body", 0, 0) })]);
    await svc.moveItem(a, "x", pos("pack", 0, 0));
    await settle();
    expect(updates(a)).toHaveLength(1);
    expect(updates(a)[0].updates).toEqual([{ _id: "x", [POS]: pos("pack", 0, 0), "system.container": "pack" }]);
    expect(updates(a)[0].options[M]).toEqual({ synced: true });
  });
  it("every marker is a fresh object: core writes into the operation", async () => {
    const a = hero([thing("x", 1, 1, { at: pos("body", 0, 0) })]);
    await svc.moveItem(a, "x", pos("body", 1, 0));
    await svc.moveItem(a, "x", pos("body", 2, 0));
    expect(updates(a)[0].options).not.toBe(updates(a)[1].options);
  });
  it("our own stow is not taken for a move on the sheet", async () => {
    const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
    await svc.stowItem(a, "x");
    await settle();
    expect(of(a, "x").getFlag(M, "pos") ?? null).toBeNull();
    expect(inOverflow(a, "x")).toBe(true);
    expect(updates(a)).toHaveLength(1);
  });
  describe("inbound: moved on the sheet", () => {
    it("into a bag: the tile follows, by one more marked update", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1, { at: pos("body", 0, 0) })]);
      await of(a, "x").update({ "system.container": "pack" });
      await settle();
      expect(updates(a)).toHaveLength(2);
      expect(updates(a)[1].options[M]?.synced).toBe(true);
      expect(place(a, "x")).toMatchObject({ c: "pack", x: 0, y: 0 });
    });
    it("out of a bag: body or non-native grids", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
      await of(a, "x").update({ "system.container": null });
      await settle();
      expect(place(a, "x")).toMatchObject({ c: "body" });
    });
    it("out of a bag with no room anywhere allowed: Unstowed, and no bag takes it", async () => {
      const a = hero([bag("pack"), bag("sack", "Sack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
      await of(a, "x").update({ "system.container": null });
      await settle();
      expect(of(a, "x").system.container).toBeNull();
      expect(inOverflow(a, "x")).toBe(true);
    });
    it("into a bag that has no room: Unstowed with the native value kept, and no native write", async () => {
      const a = hero([bag("pack", "Pouch", { system: { capacity: { weight: { value: 6, units: "lb" } } } }), thing("big", 4, 4, { at: pos("body", 0, 0) })]);
      await of(a, "big").update({ "system.container": "pack" });
      await settle();
      expect(of(a, "big").system.container).toBe("pack");
      expect(inOverflow(a, "big")).toBe(true);
      expect(updates(a).slice(1).flatMap((l) => l.updates).flatMap((u) => Object.keys(u)).filter((k) => k.startsWith("system."))).toEqual([]);
    });
    it("into a vessel: no tile and no write", async () => {
      const a = hero([waterskin("skin", { at: pos("body", 0, 0) }), thing("x", 1, 1, { at: pos("body", 2, 0) })]);
      await of(a, "x").update({ "system.container": "skin" });
      await settle();
      expect(updates(a)).toHaveLength(1);
      expect(svc.getState(a).entries.has("x")).toBe(false);
    });
    it("a second client changes nothing and writes nothing", async () => {
      env.remote = "user2";
      const a = hero([bag("pack"), thing("x", 1, 1, { at: pos("body", 0, 0) })]);
      await of(a, "x").update({ "system.container": "pack" });
      await settle();
      expect(updates(a)).toHaveLength(2);
    });
    it("autoplace off: the bag still decides, the tile waits in Unstowed", async () => {
      env.settings.set(`${M}.autoPlace`, false);
      const a = hero([bag("pack"), thing("x", 1, 1, { at: pos("body", 0, 0) })]);
      await of(a, "x").update({ "system.container": "pack" });
      await settle();
      expect(updates(a)).toHaveLength(1);
      expect(inOverflow(a, "x")).toBe(true);
    });
  });
  describe("this client did not write it: it reacts to nothing", () => {
    it("another user's move on the sheet", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("body", 0, 0) })]);
      expect(inOverflow(a, "x")).toBe(true);
      Hooks.call("updateItem", of(a, "x"), { system: { container: "pack" } }, {}, "user2");
      await settle();
      expect(updates(a)).toHaveLength(0);
    });
    it("another user's unequip on the sheet", async () => {
      const a = hero([armor("mail")]);
      Hooks.call("updateItem", of(a, "mail"), { system: { equipped: false } }, {}, "user2");
      await settle();
      expect(updates(a)).toHaveLength(0);
    });
    it("another user's new item", async () => {
      const a = hero([thing("x")]);
      Hooks.call("createItem", of(a, "x"), {}, "user2");
      await settle(80);
      expect(updates(a)).toHaveLength(0);
      expect(env.notifications).toEqual([]);
    });
    it("another user's new bag", async () => {
      const a = hero([bag("pack"), thing("x")]);
      Hooks.call("createItem", of(a, "pack"), {}, "user2");
      await settle();
      expect(updates(a)).toHaveLength(0);
    });
    it("another user's deleted bag", async () => {
      const a = hero([thing("x", 1, 1, { in: "gone6789012345" })]);
      Hooks.call("deleteItem", { id: "gone6789012345", parent: a, uuid: "x.y", name: "Bag" }, {}, "user2");
      await settle();
      expect(updates(a)).toHaveLength(0);
    });
    it("this client's own delete does repack", async () => {
      const a = hero([thing("x", 1, 1, { in: "gone6789012345" })]);
      Hooks.call("deleteItem", { id: "gone6789012345", parent: a, uuid: "x.y", name: "Bag" }, {}, game.user.id);
      await settle();
      expect(updates(a)).toHaveLength(1);
    });
  });
  it("two clients: a whole case-driven move is one update per client", async () => {
    env.remote = "user2";
    let count = 0;
    Hooks.on("updateItem", () => { count++; });
    const a = hero([bag("pack"), thing("x", 1, 1, { at: pos("body", 0, 0) })]);
    await svc.moveItem(a, "x", pos("pack", 0, 0));
    await settle();
    expect(count).toBe(2); // the writer and the other client, once each
    expect(updates(a)).toHaveLength(1);
  });
  it("a second client does not place a new item, report it, or repack a deleted bag", async () => {
    env.remote = "user2";
    const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
    await a.deleteEmbeddedDocuments("Item", ["pack"]);
    await settle();
    expect(updates(a)).toHaveLength(1);
  });
});

describe("the cycle check", () => {
  /** A Sack marked "not a bag" is a tile, and holds a Pouch that has a panel. */
  const nested = (extra = []) => hero([
    bag("sack", "Sack", { flags: { [M]: { container: false, size: { w: 2, h: 2 }, pos: pos("body", 0, 0) } } }),
    bag("pouch", "Pouch", { system: { container: "sack", capacity: { weight: { value: 6, units: "lb" } } } }),
    ...extra
  ]);
  it("a move into a bag it holds is refused: nothing changes, with a warning", async () => {
    const a = nested();
    expect(await svc.moveItem(a, "sack", pos("pouch", 0, 0))).toBe(false);
    expect(updates(a)).toHaveLength(0);
    expect(of(a, "sack").system.container).toBeNull();
    expect(env.notifications.at(-1)).toMatchObject({ type: "warn" });
    expect(env.notifications.at(-1).msg).toContain("ATTACHE.Notify.ContainerCycle");
  });
  it("deeper too", async () => {
    const a = nested([bag("deep", "Pouch", { system: { container: "pouch", capacity: { weight: { value: 6, units: "lb" } } } })]);
    expect(await svc.moveItem(a, "sack", pos("deep", 0, 0))).toBe(false);
    expect(updates(a)).toHaveLength(0);
  });
  it("a harmless move is not refused", async () => {
    const a = nested([thing("x", 1, 1, { at: pos("body", 4, 0) })]);
    expect(await svc.moveItem(a, "x", pos("pouch", 0, 0))).toBe(true);
    expect(await svc.moveItem(a, "sack", pos("body", 3, 3))).toBe(true);
    expect(env.notifications).toEqual([]);
  });
  it("Place Unstowed never picks a grid that would close a cycle", async () => {
    const a = nested();
    await svc.stowItem(a, "sack");
    await of(a, "sack").update({ [`flags.${M}.pos`]: null });
    await a.update({ [`flags.${M}.body`]: { cols: 0, rows: 0 } });
    const r = await svc.packUnstowed(a, { userAction: true });
    expect(r).toEqual({ placed: 0, remaining: 1 });
    expect(of(a, "sack").system.container).toBeNull();
    expect(env.notifications.filter((n) => n.type === "warn")).toEqual([]);
  });
  it("the check itself survives an existing cycle", () => {
    const a = hero([bag("a", "Sack", { system: { container: "b" } }), bag("b", "Sack", { system: { container: "a" } }), thing("x")]);
    expect(adapter.wouldCycle(a, of(a, "x"), "a")).toBe(false);
    expect(adapter.wouldCycle(a, of(a, "a"), "b")).toBe(true);
    expect(svc.getState(a).containers.map((c) => c.id).sort()).toEqual(["a", "b", "body"]);
  });
  it("a drop of an item of this actor runs the same check", async () => {
    const a = nested();
    await svc.addFromDrop(a, { type: "Item", uuid: of(a, "sack").uuid }, { kind: "cell", pos: pos("pouch", 0, 0) });
    expect(of(a, "sack").system.container).toBeNull();
    expect(updates(a)).toHaveLength(0);
  });
});

describe("reconcile on opening the case", () => {
  /** A real world's character: dnd5e data, none of our flags. */
  const filled = () => hero([
    bag("pack"),
    thing("tent", 4, 2, { in: "pack" }),
    thing("rope", 2, 2, { in: "pack" }),
    waterskin("skin", { in: "pack" }),
    thing("water", 1, 1, { in: "skin", type: "consumable" }),
    thing("sword", 6, 1, { type: "weapon", system: { type: { value: "martialM" } } }),
    armor("mail", { equipped: true })
  ]);
  it("places everything in one batched update, setting only pos", async () => {
    const a = filled();
    await svc.reconcile(a);
    await settle();
    expect(updates(a)).toHaveLength(1);
    const list = updates(a)[0].updates;
    expect(list.map((u) => u._id).sort()).toEqual(["rope", "skin", "sword", "tent"]);
    for (const u of list) expect(Object.keys(u).sort()).toEqual([POS, "_id"].sort());
    expect(updates(a)[0].options[M]?.synced).toBe(true);
    for (const id of ["tent", "rope", "skin"]) expect(place(a, id)).toMatchObject({ c: "pack" });
    expect(place(a, "sword")).toMatchObject({ c: "body" });
    expect(svc.getState(a).overflow).toEqual([]);
  });
  it("once per session per actor", async () => {
    const a = filled();
    await svc.reconcile(a);
    of(a, "sword").updateSource({ [`flags.${M}.pos`]: pos("nope", 0, 0) });
    await svc.reconcile(a);
    expect(updates(a)).toHaveLength(1);
    const other = filled();
    await svc.reconcile(other);
    expect(updates(other)).toHaveLength(1);
  });
  it("needs an owner", async () => {
    const a = hero([thing("x")], { owner: false });
    await svc.reconcile(a);
    expect(a.log).toEqual([]);
  });
  it("needs autoplace", async () => {
    env.settings.set(`${M}.autoPlace`, false);
    const a = filled();
    await svc.reconcile(a);
    expect(a.log).toEqual([]);
  });
  it("skips an actor in a pack", async () => {
    const a = filled();
    a.pack = "dnd5e.heroes";
    await svc.reconcile(a);
    expect(a.log).toEqual([]);
  });
  it("nothing to do: no update", async () => {
    const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
    await svc.reconcile(a);
    expect(a.log).toEqual([]);
  });
  it("a loose item never goes into a bag", async () => {
    const a = hero([bag("pack"), thing("x")], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
    await svc.reconcile(a);
    expect(of(a, "x").system.container).toBeNull();
    expect(of(a, "x").getFlag(M, "pos")).toBeUndefined();
    expect(inOverflow(a, "x")).toBe(true);
  });
  it("a child that does not fit stays Unstowed with its container", async () => {
    const a = hero([bag("pack", "Pouch", { system: { capacity: { weight: { value: 6, units: "lb" } } } }), thing("big", 4, 4, { in: "pack" })]);
    await svc.reconcile(a);
    expect(of(a, "big").system.container).toBe("pack");
    expect(of(a, "big").getFlag(M, "pos")).toBeUndefined();
  });
  it("a stale pos is fixed, but an item displaced by a shrunk bag keeps its pos", async () => {
    const a = hero([
      bag("pack", "Backpack", { flags: { [M]: { container: { cols: 2, rows: 2 } } } }),
      thing("stale", 1, 1, { in: "pack", at: pos("body", 0, 0) }),
      thing("moved", 1, 1, { at: pos("pack", 1, 1) }),
      thing("displaced", 1, 1, { in: "pack", at: pos("pack", 5, 5) })
    ]);
    await svc.reconcile(a);
    expect(place(a, "stale")).toMatchObject({ c: "pack" });
    expect(place(a, "moved")).toMatchObject({ c: "body" });
    expect(of(a, "displaced").getFlag(M, "pos")).toEqual(pos("pack", 5, 5));
  });
  it("is not for the systems with no native bags", async () => {
    game.system.id = "deltagreen";
    try {
      const a = env.addActor({ type: "agent", items: [{ _id: "x", name: "Rope", type: "gear", flags: { [M]: { size: { w: 1, h: 1 } } } }] });
      await svc.reconcile(a);
      expect(a.log).toEqual([]);
    } finally {
      game.system.id = "dnd5e";
    }
  });
});

describe("A8: batches and deletes", () => {
  it("a filled pack through the sheet route: one write, no false report", async () => {
    const a = hero();
    await a.createEmbeddedDocuments("Item", [
      bag("B000000000000001", "Explorer's Pack"),
      thing("C000000000000001", 4, 2, { name: "Bedroll", in: "B000000000000001" }),
      thing("C000000000000002", 2, 2, { name: "Rope", in: "B000000000000001" }),
      waterskin("C000000000000003", { in: "B000000000000001" }),
      thing("C000000000000004", 1, 1, { name: "Water", in: "C000000000000003" })
    ], { keepId: true });
    await settle();
    const bagId = "B000000000000001";
    expect(updates(a)).toHaveLength(1);
    expect(env.notifications).toEqual([]);
    for (const id of ["C000000000000001", "C000000000000002", "C000000000000003"]) expect(place(a, id)).toMatchObject({ c: bagId });
    expect(of(a, "C000000000000004").getFlag(M, "pos")).toBeUndefined();
    expect(a.items.size).toBe(5);
  });
  it("children come before their bag in the batch: the same", async () => {
    const a = hero();
    await a.createEmbeddedDocuments("Item", [
      thing("C000000000000001", 4, 2, { in: "B000000000000001" }),
      bag("B000000000000001", "Explorer's Pack")
    ], { keepId: true });
    await settle();
    expect(place(a, "C000000000000001")).toMatchObject({ c: "B000000000000001" });
    expect(env.notifications).toEqual([]);
  });
  it("several bags in one batch: still one write", async () => {
    const a = hero();
    await a.createEmbeddedDocuments("Item", [
      bag("B000000000000001", "Handy Haversack", { system: { properties: ["weightlessContents"], capacity: {} } }),
      bag("B000000000000002", "Left Pouch", { system: { container: "B000000000000001", capacity: { weight: { value: 200, units: "lb" } } } }),
      bag("B000000000000003", "Central Pouch", { system: { container: "B000000000000001", capacity: { weight: { value: 500, units: "lb" } } } }),
      thing("C000000000000001", 1, 1, { in: "B000000000000002" }),
      thing("C000000000000002", 1, 1, { in: "B000000000000003" })
    ], { keepId: true });
    await settle();
    expect(updates(a)).toHaveLength(1);
    expect(env.notifications).toEqual([]);
  });
  it("a child whose bag never arrives counts as loose, once the batch is over", async () => {
    const a = hero();
    await a.createEmbeddedDocuments("Item", [thing("x", 1, 1, { in: "gone6789012345" })]);
    expect(a.items.find((i) => i.name === "x").getFlag(M, "pos")).toBeUndefined();
    await settle();
    expect(a.items.find((i) => i.name === "x").getFlag(M, "pos")).toMatchObject({ c: "body" });
    expect(a.items.find((i) => i.name === "x").system.container).toBe("gone6789012345");
  });
  it("a child that really does not fit is reported once the batch is over", async () => {
    const a = hero();
    await a.createEmbeddedDocuments("Item", [
      bag("B000000000000001", "Pouch", { system: { capacity: { weight: { value: 6, units: "lb" } } } }),
      thing("C000000000000001", 4, 4, { in: "B000000000000001" })
    ], { keepId: true });
    expect(env.notifications).toEqual([]);
    await settle(80);
    expect(env.notifications.filter((n) => n.msg.includes("DidNotFit"))).toHaveLength(1);
  });
  it("a second loose create while the body is full is reported as before", async () => {
    const a = hero([thing("full", 8, 5, { at: pos("body", 0, 0) })]);
    await a.createEmbeddedDocuments("Item", [thing("x")]);
    await settle(80);
    expect(env.notifications.filter((n) => n.msg.includes("DidNotFit"))).toHaveLength(1);
  });
  describe("a bag deleted from the sheet", () => {
    it("default: nothing is lost, its contents repack by the writing client", async () => {
      const a = hero([
        bag("pack"),
        thing("x", 2, 2, { in: "pack", at: pos("pack", 0, 0) }),
        thing("too", 1, 1, { in: "pack", at: pos("pack", 2, 0) }),
        thing("big", 9, 9, { in: "pack", at: pos("pack", 3, 0) })
      ]);
      await a.deleteEmbeddedDocuments("Item", ["pack"]);
      await settle();
      expect(a.items.size).toBe(3);
      expect(place(a, "x")).toMatchObject({ c: "body" });
      expect(place(a, "too")).toMatchObject({ c: "body" });
      expect(inOverflow(a, "big")).toBe(true);
      expect(updates(a)).toHaveLength(1);
      // dnd5e leaves the dangling id; we never rewrite native data on our own.
      expect(of(a, "x").system.container).toBe("pack");
    });
    it("not into another bag", async () => {
      const a = hero([bag("pack"), bag("sack", "Sack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
      await a.deleteEmbeddedDocuments("Item", ["pack"]);
      await settle();
      expect(inOverflow(a, "x")).toBe(true);
    });
    it("with deleteContents: no repack, no write to doomed items", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
      await a.deleteEmbeddedDocuments("Item", ["pack"], { deleteContents: true });
      expect(updates(a)).toHaveLength(0);
      await settle(20);
      expect(updates(a)).toHaveLength(0);
      expect(a.items.size).toBe(0);
    });
    it("a vessel too: its contents get tiles", async () => {
      const a = hero([waterskin("skin", { at: pos("body", 0, 0) }), thing("water", 1, 1, { in: "skin" })]);
      await a.deleteEmbeddedDocuments("Item", ["skin"]);
      await settle();
      expect(place(a, "water")).toMatchObject({ c: "body" });
    });
  });
});

describe("removeContainer", () => {
  it("clears the children in one update before the delete, then repacks; nothing is lost", async () => {
    const a = hero([
      bag("pack"),
      thing("x", 2, 2, { in: "pack", at: pos("pack", 0, 0) }),
      waterskin("skin", { in: "pack", at: pos("pack", 2, 0) }),
      thing("water", 1, 1, { in: "skin" })
    ]);
    await svc.removeContainer(a, "pack");
    await settle();
    const ops = a.log.map((l) => l.op);
    expect(ops[0]).toBe("update");
    expect(ops[1]).toBe("delete");
    expect(a.log[0].updates.map((u) => u._id).sort()).toEqual(["skin", "x"]);
    for (const u of a.log[0].updates) expect(u["system.container"]).toBeNull();
    expect(a.log[0].options[M]?.synced).toBe(true);
    expect(a.log[1].options.deleteContents).toBeFalsy();
    expect(a.items.size).toBe(3);
    expect(place(a, "x")).toMatchObject({ c: "body" });
    expect(place(a, "skin")).toMatchObject({ c: "body" });
    expect(of(a, "water").system.container).toBe("skin");
  });
  it("A11: removing the outer bag keeps the inner one, with its contents", async () => {
    const a = hero([
      bag("outer", "Handy Haversack", { system: { properties: ["weightlessContents"] } }),
      bag("inner", "Pouch", { system: { container: "outer", capacity: { weight: { value: 6, units: "lb" } } } }),
      thing("gem", 1, 1, { in: "inner", at: pos("inner", 1, 1) })
    ]);
    expect(svc.getState(a).containers.map((c) => c.id).sort()).toEqual(["body", "inner", "outer"]);
    await svc.removeContainer(a, "outer");
    await settle();
    expect(of(a, "inner").system.container).toBeNull();
    expect(svc.getState(a).containers.map((c) => c.id)).toEqual(["body", "inner"]);
    expect(place(a, "gem")).toMatchObject({ c: "inner", x: 1, y: 1 });
  });
  it("what does not fit goes to Unstowed with its pos gone; no other bag takes it", async () => {
    const a = hero([bag("pack"), bag("sack", "Sack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })], { flags: { [M]: { body: { cols: 0, rows: 0 } } } });
    await svc.removeContainer(a, "pack");
    await settle();
    expect(of(a, "x").system.container).toBeNull();
    expect(of(a, "x").getFlag(M, "pos")).toBeUndefined();
    expect(inOverflow(a, "x")).toBe(true);
  });
});

describe("A4: transfers", () => {
  const given = (actor, name) => actor.items.find((i) => i.name === name);
  describe("the copy", () => {
    it("strips container, equipped and attuned", async () => {
      const a = hero([bag("pack"), armor("mail", { in: "pack", equipped: true, at: pos("pack", 0, 0) })]);
      of(a, "mail").updateSource({ "system.attuned": true });
      const b = hero();
      await svc.executeTransfer(of(a, "mail"), b);
      const item = given(b, "Chain Mail");
      expect(item.system.container ?? null).toBeNull();
      expect(item.system.equipped).toBe(false);
      expect(item.system.attuned).toBeUndefined();
      expect(item.getFlag(M, "pos")).toMatchObject({ c: "body" });
      expect(of(a, "mail")).toBeUndefined();
    });
    it("a Worn item arrives as a tile, not Worn", async () => {
      const a = hero([armor("mail", { equipped: true })]);
      const b = hero();
      await svc.executeTransfer(of(a, "mail"), b, { kind: "cell", pos: pos("body", 1, 0) });
      const item = given(b, "Chain Mail");
      expect(svc.isWorn(item)).toBe(false);
      expect(item.getFlag(M, "pos")).toEqual(pos("body", 1, 0));
    });
    it("a Plutonium-style weapon: equipped goes, so dnd5e decides by the actor", async () => {
      const a = hero([thing("sword", 6, 1, { type: "weapon", system: { type: { value: "martialM" }, equipped: true, attuned: true } })]);
      const b = hero();
      await svc.executeTransfer(of(a, "sword"), b);
      expect("equipped" in b.log.find((l) => l.op === "create").datas[0].system).toBe(false);
      expect("attuned" in b.log.find((l) => l.op === "create").datas[0].system).toBe(false);
    });
    it("our position flags never travel; art and sizes do", async () => {
      const a = hero([thing("x", 3, 2, { at: pos("body", 0, 0), ours: { art: "icons/svg/sword.svg", worn: true } })]);
      const b = hero();
      await svc.executeTransfer(of(a, "x"), b, { kind: "overflow" });
      const flags = given(b, "x").flags[M];
      expect(flags.art).toBe("icons/svg/sword.svg");
      expect(flags.size).toEqual({ w: 3, h: 2 });
      expect(flags.pos ?? null).toBeNull();
      expect(flags.worn).toBeUndefined();
    });
  });
  describe("contents", () => {
    it("giving a Waterskin brings its Water: one list, keepId, the source deleted with its contents", async () => {
      const a = hero([waterskin("skin", { at: pos("body", 0, 0) }), thing("water", 1, 1, { in: "skin", name: "Water", at: pos("skin", 0, 0), ours: { art: "icons/svg/water.svg" } })]);
      const b = hero();
      await svc.executeTransfer(of(a, "skin"), b);
      await settle(20);
      const creates = b.log.filter((l) => l.op === "create");
      expect(creates).toHaveLength(1);
      expect(creates[0].datas).toHaveLength(2);
      expect(creates[0].options.keepId).toBe(true);
      const skin = given(b, "Waterskin");
      const water = given(b, "Water");
      expect(water.system.container).toBe(skin.id);
      expect(water.flags[M].art).toBe("icons/svg/water.svg");
      expect(water.flags[M].pos).toBeUndefined();
      expect(place(b, skin.id)).toMatchObject({ c: "body" });
      expect(svc.getState(b).entries.has(water.id)).toBe(false);
      expect(a.log.find((l) => l.op === "delete").options.deleteContents).toBe(true);
      expect(a.items.size).toBe(0);
      expect(env.notifications).toEqual([]);
    });
    it("nested contents come along; their attuned goes, and equipped is written false, or dnd5e would equip them on an npc", async () => {
      const a = hero([
        bag("sack", "Sack", { flags: { [M]: { container: false, size: { w: 2, h: 2 }, pos: pos("body", 0, 0) } } }),
        tinderbox("tb", { in: "sack" }),
        waterskin("skin", { in: "sack" }),
        thing("water", 1, 1, { in: "skin", name: "Water" })
      ]);
      const b = hero();
      await svc.executeTransfer(of(a, "sack"), b);
      await settle(20);
      expect(b.items.size).toBe(4);
      expect(a.items.size).toBe(0);
      expect(given(b, "Tinderbox").system.equipped).toBe(false);
      expect(given(b, "Water").system.container).toBe(given(b, "Waterskin").id);
    });
    it("a real bag by the API: children keep their arrangement in the new bag, with no write", async () => {
      const a = hero([bag("pack"), thing("x", 2, 2, { in: "pack", at: pos("pack", 3, 3) })]);
      const b = hero();
      await svc.executeTransfer(of(a, "pack"), b);
      await settle(20);
      const pack = given(b, "Backpack");
      const x = given(b, "x");
      expect(x.system.container).toBe(pack.id);
      expect(place(b, x.id)).toMatchObject({ c: pack.id, x: 3, y: 3 });
      expect(updates(b)).toHaveLength(0);
    });
    it("art survives a give through a bag", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0), ours: { art: "icons/svg/sword.svg" } })]);
      const b = hero([bag("other", "Sack")]);
      await svc.executeTransfer(of(a, "x"), b, { kind: "cell", pos: pos("other", 1, 1) });
      const item = given(b, "x");
      expect(item.system.container).toBe("other");
      expect(item.flags[M].art).toBe("icons/svg/sword.svg");
    });
  });
  describe("rollback", () => {
    it("a failed source delete deletes every created id", async () => {
      const a = hero([waterskin("skin", { at: pos("body", 0, 0) }), thing("water", 1, 1, { in: "skin", name: "Water" })]);
      const b = hero();
      a.failDelete = true;
      await expect(svc.executeTransfer(of(a, "skin"), b)).rejects.toThrow();
      expect(b.items.size).toBe(0);
      const del = b.log.find((l) => l.op === "delete");
      expect(del.ids).toHaveLength(2);
      expect(a.items.size).toBe(2);
    });
    it("a partial create rolls back too", async () => {
      const a = hero([waterskin("skin", { at: pos("body", 0, 0) }), thing("water", 1, 1, { in: "skin", name: "Water" })]);
      const b = hero();
      b.createOnly = 1;
      await expect(svc.executeTransfer(of(a, "skin"), b)).rejects.toThrow();
      expect(b.items.size).toBe(0);
      expect(a.items.size).toBe(2);
    });
    it("transferItem reports it and keeps the source", async () => {
      const a = hero([waterskin("skin", { at: pos("body", 0, 0) }), thing("water", 1, 1, { in: "skin", name: "Water" })]);
      const b = hero();
      a.failDelete = true;
      expect(await svc.transferItem(of(a, "skin"), b)).toBe(false);
      expect(env.notifications.at(-1).type).toBe("error");
      expect(a.items.size).toBe(2);
      expect(b.items.size).toBe(0);
    });
    it("a lost race leaves one copy", async () => {
      const a = hero([thing("x", 1, 1, { at: pos("body", 0, 0) })]);
      const b = hero();
      const c = hero();
      const results = await Promise.all([svc.transferItem(of(a, "x"), b), svc.transferItem(of(a, "x"), c)]);
      await settle();
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(b.items.size + c.items.size).toBe(1);
    });
  });
  describe("GM relay", () => {
    it("does the same: contents, stripping, delete with contents", async () => {
      const a = hero([waterskin("skin", { at: pos("body", 0, 0) }), thing("water", 1, 1, { in: "skin", name: "Water" })]);
      of(a, "skin").updateSource({ "system.equipped": true, "system.attuned": true });
      const b = env.addActor({ name: "Friend", type: "character", owner: false, playerOwner: true });
      env.gm.queries.length = 0;
      expect(await svc.transferItem(of(a, "skin"), b)).toBe(true);
      await settle(20);
      expect(env.gm.queries).toHaveLength(1);
      expect(given(b, "Water").system.container).toBe(given(b, "Waterskin").id);
      const data = b.log.find((l) => l.op === "create").datas[0];
      expect("equipped" in data.system || "attuned" in data.system).toBe(false);
      expect(a.items.size).toBe(0);
    });
    it("keeps art, and lands on a bag cell", async () => {
      const a = hero([thing("x", 1, 1, { at: pos("body", 0, 0), ours: { art: "icons/svg/sword.svg" } })]);
      const b = env.addActor({ name: "Friend", type: "character", owner: false, playerOwner: true, items: [bag("pack")] });
      expect(await svc.transferItem(of(a, "x"), b, { kind: "cell", pos: pos("pack", 0, 0) })).toBe(true);
      expect(given(b, "x").system.container).toBe("pack");
      expect(given(b, "x").flags[M].art).toBe("icons/svg/sword.svg");
    });
  });
  describe("from an npc: asGear", () => {
    const monster = (items) => env.addActor({ name: "Bandit", type: "npc", items });
    const scimitar = (ours = {}) => thing("sc", 4, 1, {
      type: "weapon", name: "Scimitar", ours: { art: "icons/svg/sword.svg", ...ours },
      system: { type: { value: "martialM" }, properties: ["gear"], equipped: true }, _stats: { compendiumSource: "Compendium.dnd5e.items.Item.sc" }
    });
    it("uses it, and our flags survive it", async () => {
      const a = monster([scimitar({ size: { w: 5, h: 1 } })]);
      const b = hero();
      const uuid = of(a, "sc").uuid;
      await svc.executeTransfer(of(a, "sc"), b);
      const item = given(b, "Scimitar");
      expect(item.flags.dnd5e?.gearSource).toBe(uuid);
      expect(item.flags[M].art).toBe("icons/svg/sword.svg");
      expect(item.flags[M].size).toEqual({ w: 5, h: 1 });
      expect(item.system.equipped).toBeUndefined();
      expect(a.items.size).toBe(0);
    });
    it("the hook is what carries the flags, for the sheet's route as well", async () => {
      const a = monster([scimitar()]);
      const gear = await of(a, "sc").system.asGear();
      expect(gear.flags[M].art).toBe("icons/svg/sword.svg");
      expect(gear.flags[M].pos).toBeUndefined();
    });
    it("works relayed by the GM", async () => {
      const a = env.addActor({ name: "Bandit", type: "npc", owner: true, items: [scimitar()] });
      const b = env.addActor({ name: "Friend", type: "character", owner: false, playerOwner: true });
      const uuid = of(a, "sc").uuid;
      expect(await svc.transferItem(of(a, "sc"), b)).toBe(true);
      expect(given(b, "Scimitar").flags.dnd5e?.gearSource).toBe(uuid);
      expect(given(b, "Scimitar").flags[M].art).toBe("icons/svg/sword.svg");
    });
    it("a character's item does not go through it", async () => {
      const a = hero([scimitar()]);
      const b = hero();
      await svc.executeTransfer(of(a, "sc"), b);
      expect(given(b, "Scimitar").flags.dnd5e?.gearSource).toBeUndefined();
    });
  });
  describe("Plutonium's exemption flag (D-006)", () => {
    const droppable = () => thing("x", 1, 1, { flags: undefined, at: pos("body", 0, 0) });
    it("a give sets isStandardDragDrop where propDroppable is set", async () => {
      const a = hero([droppable()]);
      of(a, "x").updateSource({ "flags.plutonium": { propDroppable: "item", page: "items.html" } });
      const b = hero();
      await svc.executeTransfer(of(a, "x"), b);
      expect(given(b, "x").flags.plutonium.isStandardDragDrop).toBe(true);
    });
    it("nothing added to an item without it", async () => {
      const a = hero([droppable()]);
      of(a, "x").updateSource({ "flags.plutonium": { page: "items.html" } });
      const b = hero();
      await svc.executeTransfer(of(a, "x"), b);
      expect(given(b, "x").flags.plutonium.isStandardDragDrop).toBeUndefined();
    });
    it("a drop keeps the GM's setting: no exemption", async () => {
      const a = hero([droppable()]);
      of(a, "x").updateSource({ "flags.plutonium": { propDroppable: "item", page: "items.html" } });
      const b = hero();
      const created = await svc.addFromDrop(b, { type: "Item", uuid: of(a, "x").uuid }, { kind: "auto" });
      expect(created.flags.plutonium.isStandardDragDrop).toBeUndefined();
    });
  });
  describe("drops", () => {
    it("a filled bag from elsewhere keeps its contents, and the source stays", async () => {
      const a = hero([bag("pack"), thing("x", 2, 2, { in: "pack", at: pos("pack", 0, 0) }), waterskin("skin", { in: "pack" }), thing("water", 1, 1, { in: "skin", name: "Water" })]);
      const b = hero();
      const created = await svc.addFromDrop(b, { type: "Item", uuid: of(a, "pack").uuid }, { kind: "cell", pos: pos("body", 0, 0) });
      await settle();
      expect(a.items.size).toBe(4);
      expect(b.items.size).toBe(4);
      expect(created.name).toBe("Backpack");
      expect(place(b, given(b, "x").id)).toMatchObject({ c: created.id });
      expect(given(b, "Water").system.container).toBe(given(b, "Waterskin").id);
      expect(env.notifications).toEqual([]);
    });
    it("a stale pointer on a single item from a pack is dropped", async () => {
      const a = hero([bag("pack"), thing("x", 1, 1, { in: "pack" })]);
      const b = hero();
      const created = await svc.addFromDrop(b, { type: "Item", uuid: of(a, "x").uuid }, { kind: "auto" });
      expect(created.system.container ?? null).toBeNull();
      expect(place(b, created.id)).toMatchObject({ c: "body" });
    });
    it("a drop on Worn from elsewhere: equipped", async () => {
      const a = hero([armor("mail")]);
      const b = hero();
      const created = await svc.addFromDrop(b, { type: "Item", uuid: of(a, "mail").uuid }, { kind: "worn" });
      expect(created.system.equipped).toBe(true);
      expect(svc.isWorn(created)).toBe(true);
    });
  });
});

describe("A7: auto bags, custom dims, off", () => {
  it("resolved everywhere: state, itemSize, the three states", () => {
    const a = hero([
      bag("auto"),
      bag("custom", "Backpack", { flags: { [M]: { container: { cols: 2, rows: 3 } } } }),
      bag("off", "Backpack", { flags: { [M]: { container: false, size: { w: 4, h: 4 } } } })
    ]);
    const s = svc.getState(a);
    expect(s.containers.map((c) => [c.id, c.cols, c.rows])).toEqual([["body", 8, 5], ["auto", 8, 6], ["custom", 2, 3]]);
    expect(svc.itemSize(of(a, "auto"))).toMatchObject({ size: null, container: true });
    expect(svc.itemSize(of(a, "off")).container).toBe(false);
    expect(adapter.containerMode(of(a, "auto"))).toBe("auto");
    expect(adapter.containerMode(of(a, "custom"))).toBe("custom");
    expect(adapter.containerMode(of(a, "off"))).toBe("off");
    expect(adapter.autoContainerDims(of(a, "off"))).toEqual({ cols: 8, rows: 6 });
    expect(adapter.autoContainerDims(of(a, "custom"))).toEqual({ cols: 8, rows: 6 });
    expect(adapter.containerDims(of(a, "auto"))).toEqual({ cols: 8, rows: 6 });
  });
  it("a plain item is none, a flagged plain item custom", () => {
    const a = hero([thing("x"), thing("crate", 1, 1, { ours: { container: { cols: 2, rows: 2 } } })]);
    expect(adapter.containerMode(of(a, "x"))).toBe("none");
    expect(adapter.containerMode(of(a, "crate"))).toBe("custom");
    expect(adapter.autoContainerDims(of(a, "crate"))).toBeNull();
  });
  it("resizeContainers works on an auto bag, and leaves it alone when unchanged", async () => {
    const a = hero([bag("pack"), bag("sack", "Sack")]);
    await svc.resizeContainers(a, { pack: { cols: 4, rows: 4 }, sack: { cols: 6, rows: 4 } });
    expect(updates(a)).toHaveLength(1);
    expect(updates(a)[0].updates).toEqual([{ _id: "pack", [`flags.${M}.container`]: { cols: 4, rows: 4 } }]);
    expect(of(a, "sack").getFlag(M, "container")).toBeUndefined();
  });
  it("setItemConfig stores false, and removes it", async () => {
    const a = hero([bag("pack")]);
    await svc.setItemConfig(of(a, "pack"), { container: false });
    expect(of(a, "pack").getFlag(M, "container")).toBe(false);
    expect(svc.getState(a).containers.map((c) => c.id)).toEqual(["body"]);
    await svc.setItemConfig(of(a, "pack"), { container: null });
    expect(of(a, "pack").getFlag(M, "container")).toBeUndefined();
    expect(svc.getState(a).containers.map((c) => c.id)).toEqual(["body", "pack"]);
  });
  it("A11: container:false: children lose tiles and stay on the sheet; the bag is a tile, placed; back on, all return", async () => {
    const a = hero([bag("pack"), thing("x", 2, 2, { in: "pack", at: pos("pack", 3, 3) })]);
    await svc.setItemConfig(of(a, "pack"), { container: false });
    await settle();
    expect(a.items.size).toBe(2);
    expect(of(a, "x").system.container).toBe("pack");
    expect(svc.getState(a).entries.has("x")).toBe(false);
    expect(svc.getState(a).overflow.map((i) => i.id)).not.toContain("x");
    expect(place(a, "pack")).toMatchObject({ c: "body" });
    await svc.setItemConfig(of(a, "pack"), { container: null });
    await settle();
    expect(place(a, "x")).toMatchObject({ c: "pack", x: 3, y: 3 });
    expect(of(a, "pack").getFlag(M, "pos")).toBeUndefined();
  });
  describe("nested bags have sensible grids (M3 review)", () => {
    const dims = (name, system) => bagDims({ name, type: "container", system });
    const lb = (value) => ({ capacity: { weight: { value, units: "lb" } } });
    it("Handy Haversack is the same bag in both rule sets", () => {
      const weightless = { properties: ["weightlessContents"], capacity: {} };
      expect(dims("Handy Haversack", weightless)).toEqual({ cols: 8, rows: 6 });
      expect(dims("Handy Haversack", { ...weightless, ...lb(120) })).toEqual({ cols: 8, rows: 6 });
    });
    it("its pouches fit inside it", () => {
      const parent = dims("Handy Haversack", lb(120));
      for (const [name, system] of [["Left Pouch", lb(200)], ["Right Pouch", lb(200)], ["Central Pouch", lb(500)]]) {
        const d = dims(name, system);
        expect(d.cols, name).toBeLessThan(parent.cols);
        expect(d.rows, name).toBeLessThan(parent.rows);
      }
    });
    it("survive a rename through the identifier", () => {
      expect(dims("Bolso", { ...lb(200), identifier: "left-pouch" })).toEqual(dims("Left Pouch", lb(200)));
    });
  });
  it("A11: renaming a bag or an item changes nothing about place", async () => {
    const a = hero([
      bag("sack", "Sack", { system: { identifier: "sack" } }),
      bag("pouch", "Pouch", { system: { identifier: "pouch", capacity: { weight: { value: 6, units: "lb" } } } }),
      thing("x", 2, 2, { in: "sack", at: pos("sack", 4, 2) }),
      thing("gem", 1, 1, { in: "pouch", at: pos("pouch", 2, 1) }),
      thing("y", 1, 1, { at: pos("body", 1, 1) })
    ]);
    const before = svc.getLayout(a);
    const same = () => {
      expect(svc.getLayout(a).placed).toEqual(before.placed);
      expect(svc.getLayout(a).containers.map((c) => [c.id, c.cols, c.rows])).toEqual(before.containers.map((c) => [c.id, c.cols, c.rows]));
    };
    for (const [id, name] of [["sack", "Backpack"], ["pouch", "Frasco"], ["pouch", "Chest"], ["x", "Zzyzx"], ["y", "Backpack"]]) {
      await of(a, id).update({ name });
      await settle();
      same();
    }
  });
  it("A11: a stack does not grow with quantity", async () => {
    const a = hero([{ _id: "arrows", name: "Arrow", type: "consumable", system: { container: null, quantity: 1, type: { value: "ammo", subtype: "arrow" } }, flags: { [M]: { pos: pos("body", 0, 0) } } }]);
    const before = svc.itemSize(of(a, "arrows")).size;
    await of(a, "arrows").update({ "system.quantity": 400 });
    expect(svc.itemSize(of(a, "arrows")).size).toEqual(before);
    expect(place(a, "arrows")).toMatchObject({ c: "body" });
  });
  it("A plain item made a container: loose items stay loose in it", async () => {
    const a = hero([thing("crate", 1, 1, { ours: { container: { cols: 4, rows: 4 } } }), thing("x", 1, 1, { at: pos("body", 0, 0) })]);
    await svc.moveItem(a, "x", pos("crate", 1, 1));
    expect(of(a, "x").system.container).toBeNull();
    expect(place(a, "x")).toMatchObject({ c: "crate", x: 1, y: 1 });
  });
  it("a move from a native bag to a plain grid clears the container", async () => {
    const a = hero([bag("pack"), thing("crate", 1, 1, { ours: { container: { cols: 4, rows: 4 } } }), thing("x", 1, 1, { in: "pack", at: pos("pack", 0, 0) })]);
    await svc.moveItem(a, "x", pos("crate", 1, 1));
    expect(of(a, "x").system.container).toBeNull();
    expect(place(a, "x")).toMatchObject({ c: "crate" });
  });
});

describe("rotate, take off, arrange and pack stay consistent on two clients", () => {
  it("rotate writes one marked update and no native key", async () => {
    const a = hero([bag("pack"), thing("x", 3, 1, { in: "pack", at: pos("pack", 0, 0) })]);
    await svc.rotateInPlace(a, "x");
    await settle();
    expect(updates(a)).toHaveLength(1);
    expect(updates(a)[0].options[M]?.synced).toBe(true);
    expect(Object.keys(updates(a)[0].updates[0]).sort()).toEqual([POS, "_id"].sort());
  });
  it("the same data gives the same layout, whichever client reads it", () => {
    const items = () => [bag("pack"), thing("x", 2, 2, { in: "pack", at: pos("pack", 1, 1) }), thing("y", 2, 2, { in: "pack", at: pos("pack", 1, 1), sort: 5 }), thing("z")];
    const one = hero(items());
    const two = hero(items());
    expect(svc.getLayout(one).placed).toEqual(svc.getLayout(two).placed);
    expect(svc.getLayout(one).overflow).toEqual(svc.getLayout(two).overflow);
  });
});

describe("review of M4", () => {
  const given = (actor, name) => actor.items.find((i) => i.name === name);
  describe("M1: a give that would lose what lies below dnd5e's depth limit moves nothing", () => {
    /** A tile holding `n` bags in a chain, the last one holding a Dagger. */
    const chain = (n) => {
      const items = [bag("root", "Sack", { flags: { [M]: { container: false, size: { w: 2, h: 2 }, pos: pos("body", 0, 0) } } })];
      let parent = "root";
      for (let i = 0; i < n; i++) {
        items.push(bag(`b${i}`, `Sack${i}`, { system: { container: parent } }));
        parent = `b${i}`;
      }
      items.push(thing("dagger", 1, 1, { in: parent, name: "Dagger" }));
      return items;
    };
    it("transferItem refuses before creating anything", async () => {
      const a = hero(chain(7));
      const b = hero();
      expect(await svc.transferItem(of(a, "root"), b)).toBe(false);
      await settle(20);
      expect(b.log).toEqual([]);
      expect(a.items.size).toBe(9);
      expect(a.log.filter((l) => l.op === "delete")).toEqual([]);
      expect(env.notifications.at(-1).type).toBe("error");
      expect(env.notifications.at(-1).msg).toContain("ATTACHE.Notify.TransferFailed");
    });
    it("the same through the GM relay", async () => {
      const a = hero(chain(7));
      const b = env.addActor({ name: "Friend", type: "character", owner: false, playerOwner: true });
      expect(await svc.transferItem(of(a, "root"), b)).toBe(false);
      await settle(20);
      expect(b.items.size).toBe(0);
      expect(a.items.size).toBe(9);
    });
    it("what fits the limit still moves whole", async () => {
      const a = hero(chain(4));
      const b = hero();
      expect(await svc.transferItem(of(a, "root"), b)).toBe(true);
      // Wait for the outcome, not a fixed time: CI runners are slower than local Docker.
      await vi.waitFor(() => {
        expect(b.items.size).toBe(6);
        expect(a.items.size).toBe(0);
      }, { timeout: 2000 });
    });
    it("an outside cycle is refused too, and the walk ends", async () => {
      const a = hero([
        bag("root", "Sack", { system: { container: "loop" }, flags: { [M]: { container: false, size: { w: 2, h: 2 }, pos: pos("body", 0, 0) } } }),
        bag("loop", "Sack", { system: { container: "root" } })
      ]);
      const b = hero();
      expect(await svc.transferItem(of(a, "root"), b)).toBe(false);
      expect(b.log).toEqual([]);
      expect(a.items.size).toBe(2);
    });
    it("a drop deletes nothing: it copies what it can, and warns", async () => {
      const a = hero(chain(7));
      const b = hero();
      const created = await svc.addFromDrop(b, { type: "Item", uuid: of(a, "root").uuid }, { kind: "auto" });
      await settle();
      expect(created.name).toBe("Sack");
      expect(a.items.size).toBe(9);
      expect(b.items.size).toBe(6);
      expect(env.notifications.at(-1).type).toBe("warn");
      expect(env.notifications.at(-1).msg).toContain("ATTACHE.Notify.TooDeep");
    });
    it("a drop within the limit does not warn", async () => {
      const a = hero(chain(1));
      const b = hero();
      await svc.addFromDrop(b, { type: "Item", uuid: of(a, "root").uuid }, { kind: "auto" });
      await settle();
      expect(env.notifications).toEqual([]);
    });
  });
  describe("M2: a copy's contents keep equipped false where they had the key", () => {
    const holder = () => bag("sack", "Sack", { flags: { [M]: { container: false, size: { w: 2, h: 2 }, pos: pos("body", 0, 0) } } });
    it("a give: unequipped and stale-equipped armor both arrive false, attuned goes", async () => {
      const a = hero([holder(), armor("mail", { in: "sack" }), armor("worn", { in: "sack", equipped: true })]);
      of(a, "worn").updateSource({ "system.attuned": true, name: "Stale" });
      const b = env.addActor({ name: "Bandit", type: "npc" });
      await svc.executeTransfer(of(a, "sack"), b);
      const datas = b.log.find((l) => l.op === "create").datas;
      const stale = datas.find((d) => d.name === "Stale");
      expect(datas.find((d) => d.name === "Chain Mail").system.equipped).toBe(false);
      expect(stale.system.equipped).toBe(false);
      expect("attuned" in stale.system).toBe(false);
    });
    it("a drop does the same", async () => {
      const a = hero([holder(), armor("mail", { in: "sack" })]);
      const b = env.addActor({ name: "Bandit", type: "npc" });
      await svc.addFromDrop(b, { type: "Item", uuid: of(a, "sack").uuid }, { kind: "auto" });
      expect(b.log.find((l) => l.op === "create").datas.find((d) => d.name === "Chain Mail").system.equipped).toBe(false);
    });
    it("a child with no such key, as loot, gets none", async () => {
      const a = hero([holder(), thing("gem", 1, 1, { in: "sack", name: "Gem" })]);
      const b = hero();
      await svc.executeTransfer(of(a, "sack"), b);
      expect("equipped" in b.log.find((l) => l.op === "create").datas.find((d) => d.name === "Gem").system).toBe(false);
    });
    it("the root still loses the key, so dnd5e decides by the receiver", async () => {
      const a = hero([holder()]);
      of(a, "sack").updateSource({ "system.equipped": true });
      const b = hero();
      await svc.executeTransfer(of(a, "sack"), b);
      expect("equipped" in b.log.find((l) => l.op === "create").datas[0].system).toBe(false);
    });
  });
  describe("S1: a pack reads state after the previous write came back", () => {
    it("two moves nearby, with a write in flight, take different cells", async () => {
      const a = hero([bag("pack"), thing("a1", 2, 2, { at: pos("body", 0, 0) }), thing("a2", 2, 2, { at: pos("body", 2, 0) })]);
      a.writeDelay = 15;
      await of(a, "a1").update({ "system.container": "pack" });
      await settle(2);
      await of(a, "a2").update({ "system.container": "pack" });
      await settle(60);
      expect(place(a, "a1")).toMatchObject({ c: "pack", x: 0, y: 0 });
      expect(place(a, "a2")).toMatchObject({ c: "pack", x: 2, y: 0 });
      expect(svc.getState(a).overflow).toEqual([]);
    });
    it("a failed pack does not stop the next one", async () => {
      const a = hero([bag("pack"), thing("a1", 1, 1), thing("a2", 1, 1)], { flags: { [M]: { body: { cols: 8, rows: 5 } } } });
      const real = a.updateEmbeddedDocuments.bind(a);
      let first = true;
      a.updateEmbeddedDocuments = async (...args) => {
        if (first && args[2]?.[M]?.synced) { first = false; throw new Error("refused"); }
        return real(...args);
      };
      const error = console.error;
      console.error = () => {};
      try {
        await a.createEmbeddedDocuments("Item", [thing("n1", 1, 1, { at: pos("nope", 0, 0) })]);
        await settle();
        await a.createEmbeddedDocuments("Item", [thing("n2", 1, 1, { at: pos("nope", 0, 0) })]);
        await settle();
      } finally {
        console.error = error;
      }
      expect(a.items.find((i) => i.name === "n2").getFlag(M, "pos")).toMatchObject({ c: "body" });
    });
  });
  describe("S2: a drop on a full cell", () => {
    it("of the body stays out of every bag", async () => {
      const a = hero([thing("x", 1, 1)]);
      const b = hero([bag("pack"), thing("full", 1, 1, { at: pos("body", 0, 0) })], { flags: { [M]: { body: { cols: 1, rows: 1 } } } });
      const created = await svc.addFromDrop(b, { type: "Item", uuid: of(a, "x").uuid }, { kind: "cell", pos: pos("body", 0, 0) });
      expect(created.system.container ?? null).toBeNull();
      expect(inOverflow(b, created.id)).toBe(true);
      expect(env.notifications.at(-1).msg).toContain("ATTACHE.Notify.DidNotFit");
    });
    it("of the body: another cell of the body or a plain grid is fine", async () => {
      const a = hero([thing("x", 1, 1)]);
      const b = hero([bag("pack"), thing("full", 1, 1, { at: pos("body", 0, 0) })], { flags: { [M]: { body: { cols: 2, rows: 1 } } } });
      const created = await svc.addFromDrop(b, { type: "Item", uuid: of(a, "x").uuid }, { kind: "cell", pos: pos("body", 0, 0) });
      expect(place(b, created.id)).toMatchObject({ c: "body", x: 1 });
    });
    it("of a bag stays in that bag, and no other", async () => {
      const a = hero([thing("x", 1, 1)]);
      const b = hero([
        bag("full", "Pouch", { flags: { [M]: { container: { cols: 1, rows: 1 } } } }), bag("sack", "Sack"),
        thing("in", 1, 1, { in: "full", at: pos("full", 0, 0) })
      ]);
      const created = await svc.addFromDrop(b, { type: "Item", uuid: of(a, "x").uuid }, { kind: "cell", pos: pos("full", 0, 0) });
      expect(created.system.container ?? null).toBeNull();
      expect(inOverflow(b, created.id)).toBe(true);
    });
  });
  describe("S3: opening an unlinked token's case does not fork its items", () => {
    const tokenOf = (base) => env.addScene([{ base }]).tokens.find(() => true).actor;
    it("the base is reconciled, and the token writes nothing it inherits", async () => {
      const base = hero([thing("x", 1, 1), bag("pack"), thing("y", 1, 1, { in: "pack" })]);
      const token = tokenOf(base);
      await svc.reconcile(token);
      expect(updates(base)).toHaveLength(1);
      expect(of(base, "x").getFlag(M, "pos")).toMatchObject({ c: "body" });
      expect(token.log.filter((l) => l.op === "tokenWrite")).toEqual([]);
      expect(token.delta.items.manages("x")).toBe(false);
      expect(svc.getState(token).overflow).toEqual([]);
    });
    it("a rename on the base still reaches it", async () => {
      const base = hero([thing("x", 1, 1)]);
      const token = tokenOf(base);
      await svc.reconcile(token);
      await of(base, "x").update({ name: "Renamed On Base" });
      expect(token.items.get("x").name).toBe("Renamed On Base");
    });
    it("what only the token has is placed there, around what it inherits", async () => {
      const base = hero([thing("x", 8, 1)]);
      const token = tokenOf(base);
      token.ownItems.set("own", new (of(base, "x").constructor)(thing("own", 1, 1), token));
      await svc.reconcile(token);
      expect(token.log.find((l) => l.op === "tokenWrite").ids).toEqual(["own"]);
      expect(token.items.get("own").getFlag(M, "pos")).toMatchObject({ c: "body", x: 0, y: 1 });
      expect(token.delta.items.manages("x")).toBe(false);
    });
    it("a base the user does not own: nothing is written, items stay in Unstowed", async () => {
      const base = hero([thing("x", 1, 1)], { owner: false });
      const token = tokenOf(base);
      token.owner = true;
      await svc.reconcile(token);
      expect(base.log).toEqual([]);
      expect(token.log.filter((l) => l.op === "tokenWrite")).toEqual([]);
      expect(inOverflow(token, "x")).toBe(true);
    });
    it("a user action on it still places it", async () => {
      const base = hero([thing("x", 1, 1)], { owner: false });
      const token = tokenOf(base);
      token.owner = true;
      await svc.moveItem(token, "x", pos("body", 2, 2));
      expect(token.log.find((l) => l.op === "tokenWrite").ids).toEqual(["x"]);
      expect(token.items.get("x").getFlag(M, "pos")).toEqual(pos("body", 2, 2));
    });
  });
  describe("S4: nobody wears anything on a vehicle", () => {
    const vehicle = (items = []) => env.addActor({ name: "Cart", type: "vehicle", items, flags: { [M]: { body: { cols: 8, rows: 5 } } } });
    it("not wearable there, and equipped armor is a tile", async () => {
      const v = vehicle([armor("mail", { equipped: true, at: pos("body", 0, 0) })]);
      expect(adapter.isWearable(of(v, "mail"))).toBe(false);
      expect(svc.isWorn(of(v, "mail"))).toBe(false);
      expect(svc.getState(v).worn).toEqual([]);
      expect(svc.getState(v).layout.placed.has("mail")).toBe(true);
    });
    it("wearing is refused with a warning", async () => {
      const v = vehicle([armor("mail", { at: pos("body", 0, 0) })]);
      expect(await svc.wearItem(v, "mail")).toBe(false);
      expect(of(v, "mail").system.equipped).toBe(false);
      expect(env.notifications.at(-1).type).toBe("warn");
    });
    it("a move writes nothing about equipped", async () => {
      const v = vehicle([armor("mail", { equipped: true, at: pos("body", 0, 0) })]);
      await svc.moveItem(v, "mail", pos("body", 1, 0));
      expect(hasKey(lastFields(v), "system.equipped")).toBe(false);
    });
    it("on a copy the target decides: to a vehicle's Worn is a place in its grid, from it to a character is wearable", async () => {
      const a = hero([armor("mail", { at: pos("body", 0, 0) })]);
      const v = vehicle();
      await svc.executeTransfer(of(a, "mail"), v, { kind: "worn" });
      const onCart = given(v, "Chain Mail");
      expect(onCart.system.equipped ?? false).toBe(false);
      expect(svc.getState(v).layout.placed.get(onCart.id)).toMatchObject({ c: "body" });
      const back = hero();
      await svc.executeTransfer(onCart, back, { kind: "worn" });
      expect(svc.isWorn(given(back, "Chain Mail"))).toBe(true);
    });
    it("adapter: wearsOn", () => {
      expect(adapter.wearsOn(vehicle())).toBe(false);
      expect(adapter.wearsOn(hero())).toBe(true);
      expect(adapter.wearsOn(env.addActor({ type: "npc" }))).toBe(true);
    });
  });
  describe("a copied pos with no spot", () => {
    it("removes the flag, so reconcile tries it again", async () => {
      const a = hero([thing("full", 8, 5, { at: pos("body", 0, 0) })]);
      await a.createEmbeddedDocuments("Item", [thing("new", 1, 1, { at: pos("body", 0, 0) })]);
      await settle();
      const item = a.items.find((i) => i.name === "new");
      expect(item.getFlag(M, "pos")).toBeUndefined();
      await a.deleteEmbeddedDocuments("Item", ["full"]);
      await svc.reconcile(a);
      expect(place(a, item.id)).toMatchObject({ c: "body" });
    });
  });
  it("N1: a weapon the user stowed stays stowed when it is unequipped on the sheet", async () => {
    const a = hero([thing("sword", 6, 1, { type: "weapon", at: pos("body", 0, 0), system: { type: { value: "martialM" }, equipped: true } })]);
    await svc.stowItem(a, "sword");
    await of(a, "sword").update({ "system.equipped": false });
    await settle();
    expect(inOverflow(a, "sword")).toBe(true);
    expect(updates(a)).toHaveLength(2);
  });
  it("N2: an actor deleted during the debounce gets no write", async () => {
    const a = hero([thing("x", 1, 1), bag("pack")]);
    Hooks.call("createItem", of(a, "x"), {}, game.user.id);
    Hooks.call("deleteActor", a);
    await settle();
    expect(updates(a)).toEqual([]);
  });
  describe("N7: a copy keeps the arrangement inside a bag", () => {
    it("children's pos follows the new bag id", async () => {
      const a = hero([bag("pack"), thing("x", 2, 2, { in: "pack", at: pos("pack", 3, 3) }), thing("y", 1, 1, { in: "pack", at: pos("pack", 0, 0, true) })]);
      const b = hero();
      await svc.addFromDrop(b, { type: "Item", uuid: of(a, "pack").uuid }, { kind: "auto" });
      await settle();
      const id = given(b, "Backpack").id;
      expect(given(b, "x").getFlag(M, "pos")).toEqual(pos(id, 3, 3));
      expect(given(b, "y").getFlag(M, "pos")).toEqual(pos(id, 0, 0, true));
    });
    it("a stale pos outside its bag, and one in a holder with no grid, do not travel", async () => {
      const a = hero([
        bag("pack"), thing("stale", 1, 1, { in: "pack", at: pos("body", 1, 1) }),
        waterskin("skin", { in: "pack" }), thing("water", 1, 1, { in: "skin", name: "Water", at: pos("skin", 0, 0) })
      ]);
      const b = hero();
      await svc.addFromDrop(b, { type: "Item", uuid: of(a, "pack").uuid }, { kind: "auto" });
      await settle();
      expect(given(b, "stale").getFlag(M, "pos")).toMatchObject({ c: given(b, "Backpack").id });
      expect(given(b, "Water").getFlag(M, "pos")).toBeUndefined();
    });
  });
  it("N9: crew.value stays behind, as on a sheet drop", async () => {
    const a = hero([thing("x", 1, 1, { system: { crew: { value: ["Actor.a"], max: 2 } } })]);
    const b = hero();
    await svc.executeTransfer(of(a, "x"), b);
    const { crew } = b.log.find((l) => l.op === "create").datas[0].system;
    expect("value" in crew).toBe(false);
    expect(crew.max).toBe(2);
  });
});

describe("CoC7 and Delta Green: every row reduces to today's behaviour", () => {
  beforeAll(() => { game.system.id = "deltagreen"; });
  afterAll(() => { game.system.id = "dnd5e"; });
  const agent = (items) => env.addActor({ name: "Agent", type: "agent", items });
  const gear = (_id, extra = {}) => ({ _id, name: _id, type: "gear", flags: { [M]: { size: { w: 1, h: 1 } } }, system: {}, ...extra });
  const box = (_id) => ({ _id, name: _id, type: "gear", system: {}, flags: { [M]: { container: { cols: 4, rows: 4 } } } });

  it("placementFields: pos only, and the worn flag stays", () => {
    const a = agent([box("case"), gear("x"), { _id: "vest", name: "Vest", type: "armor", system: { equipped: true }, flags: { [M]: { worn: true } } }]);
    expect(placementFields(of(a, "x"), { pos: pos("case", 0, 0) }, { actor: a, userAction: true })).toEqual({ [POS]: pos("case", 0, 0) });
    const off = placementFields(of(a, "vest"), { pos: pos("body", 0, 0) }, { actor: a, userAction: true });
    expect(Object.keys(off).sort()).toEqual([`flags.${M}.pos`, `flags.${M}.worn`].sort());
    expect(placementFields(of(a, "x"), { pos: null, worn: true }, { actor: a, userAction: true })).toEqual({ [`flags.${M}.worn`]: true });
  });
  it("S5: a copy with Worn off keeps its worn flag, as at 1.0.0, and is Worn again when the setting returns", async () => {
    env.settings.set(`${M}.allowWorn`, false);
    const a = agent([]);
    await a.createEmbeddedDocuments("Item", [{ name: "Vest", type: "armor", system: {}, flags: { [M]: { worn: true, size: { w: 1, h: 1 } } } }]);
    const vest = a.items.find((i) => i.name === "Vest");
    expect(vest.getFlag(M, "worn")).toBe(true);
    expect(vest.getFlag(M, "pos")).toMatchObject({ c: "body" });
    env.settings.set(`${M}.allowWorn`, true);
    expect(svc.isWorn(vest)).toBe(true);
  });
  it("a copied pos with no spot still stores null, as at 1.0.0", async () => {
    const a = agent([gear("full", { flags: { [M]: { size: { w: 5, h: 3 }, pos: pos("body", 0, 0) } } })]);
    await a.createEmbeddedDocuments("Item", [{ name: "New", type: "gear", system: {}, flags: { [M]: { size: { w: 1, h: 1 }, pos: pos("body", 0, 0) } } }]);
    expect(a.items.find((i) => i.name === "New").getFlag(M, "pos")).toBeNull();
  });
  it("system.equipped means nothing: Delta Green defaults it to true", () => {
    const a = agent([{ _id: "vest", name: "Vest", type: "armor", system: { equipped: true }, flags: { [M]: { pos: pos("body", 0, 0), size: { w: 1, h: 1 } } } }]);
    expect(svc.isWorn(of(a, "vest"))).toBe(false);
    expect(svc.getState(a).worn).toEqual([]);
  });
  it("a `system.container` field means nothing", () => {
    const a = agent([box("case"), gear("x", { system: { container: "case" }, flags: { [M]: { size: { w: 1, h: 1 }, pos: pos("body", 0, 0) } } })]);
    expect(place(a, "x")).toMatchObject({ c: "body" });
  });
  it("any grid is open to every path, as before", async () => {
    const a = agent([box("case")]);
    await a.update({ [`flags.${M}.body`]: { cols: 0, rows: 0 } });
    await a.createEmbeddedDocuments("Item", [{ name: "New", type: "gear", flags: { [M]: { size: { w: 1, h: 1 } } } }]);
    await settle();
    expect(a.items.find((i) => i.name === "New").getFlag(M, "pos")).toMatchObject({ c: "case" });
  });
  it("a stow deletes the pos, with no native keys", async () => {
    const a = agent([gear("x", { flags: { [M]: { size: { w: 1, h: 1 }, pos: pos("body", 0, 0) } } })]);
    await svc.stowItem(a, "x");
    const u = lastFields(a);
    expect(isDel(u[POS])).toBe(true);
    expect(Object.keys(u).sort()).toEqual([POS, "_id"].sort());
  });
  it("a transfer: one create, no keepId, no deleteContents", async () => {
    const a = agent([gear("x", { flags: { [M]: { size: { w: 1, h: 1 }, pos: pos("body", 0, 0) } } })]);
    const b = agent([]);
    await svc.executeTransfer(of(a, "x"), b);
    const create = b.log.find((l) => l.op === "create");
    expect(create.datas).toHaveLength(1);
    expect(create.options.keepId).toBeUndefined();
    expect(a.log.find((l) => l.op === "delete").options.deleteContents).toBeUndefined();
  });
  it("deleting a box from a sheet does not repack, as before", async () => {
    const a = agent([box("case"), gear("x", { flags: { [M]: { size: { w: 1, h: 1 }, pos: pos("case", 0, 0) } } })]);
    await a.deleteEmbeddedDocuments("Item", ["case"]);
    await settle();
    expect(updates(a)).toHaveLength(0);
  });
  it("Worn writes only the flag", async () => {
    const a = agent([{ _id: "vest", name: "Vest", type: "armor", system: { equipped: false }, flags: { [M]: { size: { w: 1, h: 1 }, pos: pos("body", 0, 0) } } }]);
    await svc.wearItem(a, "vest");
    const u = lastFields(a);
    expect(u[`flags.${M}.worn`]).toBe(true);
    expect(isDel(u[POS])).toBe(true);
    expect(Object.keys(u).some((k) => k.startsWith("system."))).toBe(false);
  });
});
