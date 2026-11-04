import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { describeDnd5e, parsePlutoniumHash, weightInPounds, isNoSpace, isBag, isVessel, bagDims, BASE_ITEM_NAMES } from "../../scripts/core/dnd5e.mjs";
import { DND5E_PRESETS, CONTAINER_PRESETS, PRESET_STRINGS } from "../../scripts/data/container-presets.mjs";
import { installFoundry } from "./helpers/fake-foundry.mjs";
import { item, LONGSWORD } from "./helpers/dnd5e-items.mjs";

const env = installFoundry("dnd5e");
const adapter = await import("../../scripts/foundry/system-adapter.mjs");
const svc = await import("../../scripts/foundry/inventory.mjs");
const { registerHooks } = await import("../../scripts/foundry/hooks.mjs");
const { AttacheCaseApp } = await import("../../scripts/apps/attache-case-app.mjs");

const M = "attache-case";
registerHooks();
const hook = (name) => env.hooks.get(name)?.[0];

describe("parsePlutoniumHash", () => {
  it.each([
    ["shield_phb", "shield", "phb"],
    ["shield_xphb", "shield", "xphb"],
    ["%2b1%20longsword_xdmg", "+1 longsword", "xdmg"], // the lowercase form seen live
    ["%2B1%20longsword_xdmg", "+1 longsword", "xdmg"],
    ["dagger_xphb", "dagger", "xphb"],
    ["traveler's%20clothes_xphb", "traveler's clothes", "xphb"],
    ["unarmed%20strike_xphb", "unarmed strike", "xphb"],
    ["longsword_soldier_ggr_ggr", "longsword_soldier_ggr", "ggr"] // split on the LAST underscore
  ])("%s", (hash, name, source) => {
    expect(parsePlutoniumHash(hash)).toEqual({ name, source });
  });

  it("takes a hash with no underscore as all name", () => {
    expect(parsePlutoniumHash("dagger")).toEqual({ name: "dagger", source: "" });
  });

  it("survives a malformed escape instead of throwing", () => {
    expect(parsePlutoniumHash("100%_xphb")).toEqual({ name: "100%", source: "xphb" });
  });

  it.each([[undefined], [null], [""], [42], ["_xphb"], [{}]])("is null for %j", (hash) => {
    expect(parsePlutoniumHash(hash)).toBeNull();
  });
});

describe("weightInPounds", () => {
  it.each([
    [{ value: 3, units: "lb" }, 3],
    [{ value: 4, units: "kg" }, 10], // dnd5e's own factor, 2.5, not 2.2
    [{ value: 1, units: "tn" }, 2000],
    [{ value: 1, units: "Mg" }, 2500],
    [{ value: 3 }, 3],
    [3, 3], // Plutonium's currency item holds a bare number
    [{ value: 2, units: "furlong" }, 2]
  ])("%j -> %d", (weight, expected) => {
    expect(weightInPounds(weight)).toBe(expected);
  });

  it.each([[{ value: 0, units: "lb" }], [0], [undefined], [null], [{ value: -1 }], [{ value: "x" }], [{}], [{ value: Infinity }]])(
    "%j is unknown, never tiny", (weight) => {
      expect(weightInPounds(weight)).toBeNull();
    });
});

describe("describeDnd5e", () => {
  it("gives the hash name as identity only for items.html, then the base item, then the identifier", () => {
    const d = describeDnd5e(item({ name: "Espada Longa", ...LONGSWORD, page: "items.html", hash: "%2b1%20longsword_xdmg", identifier: "espada-longa" }));
    expect(d.identityNames).toEqual(["+1 longsword", "longsword", "espada longa"]);
    expect(d.hashName).toBe("+1 longsword");
  });

  it("ignores the hash on spells.html and monsterAction", () => {
    const scroll = describeDnd5e(item({ name: "Spell Scroll: Thunderwave", type: "consumable", value: "scroll", page: "spells.html", hash: "thunderwave_xphb" }));
    expect(scroll.identityNames).toEqual([]);
    expect(scroll.hashName).toBeNull();
    const action = describeDnd5e(item({ name: "Longsword", ...LONGSWORD, page: "monsterAction", hash: "longsword_soldier_ggr_ggr" }));
    expect(action.identityNames).toEqual(["longsword"]);
    expect(action.hashName).toBeNull();
  });

  it.each([
    [{ type: "weapon", value: "martialM" }, true],
    [{ type: "weapon", value: "" }, true],
    [{ type: "equipment", value: "heavy" }, true],
    [{ type: "equipment", value: "shield" }, true],
    [{ type: "equipment", value: "wondrous" }, false],
    [{ type: "equipment", value: "" }, false],
    [{ type: "consumable", value: "ammo" }, false],
    [{ type: "loot", value: "gear" }, false],
    [{ type: "container" }, false]
  ])("whole-word matching for %j: %s", (spec, expected) => {
    expect(describeDnd5e(item({ name: "x", ...spec })).baseMatch).toBe(expected);
  });

  it.each([
    [{ type: "weapon", value: "martialM" }, "weapon:martialM"],
    [{ type: "consumable", value: "ammo", subtype: "arrow" }, "consumable:ammo:arrow"],
    [{ type: "consumable", value: "potion" }, "consumable:potion"],
    [{ type: "loot", value: "" }, null],
    [{ type: "container" }, null]
  ])("subtype of %j is %s", (spec, expected) => {
    expect(describeDnd5e(item({ name: "x", ...spec })).subtype).toBe(expected);
  });

  it("never reads a container's missing system.type", () => {
    expect(() => describeDnd5e(item({ name: "Backpack", type: "container", weight: 5 }))).not.toThrow();
    expect(describeDnd5e({ name: "bare", type: "loot" }).weight).toBeNull();
  });

  it("reads the real name from the source, not the fake unidentified one", () => {
    const doc = { ...item({ name: "Unidentified Sword", type: "weapon", value: "martialM" }), _source: { name: "Vorpal Sword" } };
    expect(describeDnd5e(doc).name).toBe("Vorpal Sword");
  });

  it("maps every base item key of dnd5e 5.3.3 to a name", () => {
    const keys = ["battleaxe", "blowgun", "club", "dagger", "dart", "flail", "glaive", "greataxe", "greatclub", "greatsword", "halberd", "handaxe", "handcrossbow",
      "heavycrossbow", "javelin", "lance", "lightcrossbow", "lighthammer", "longbow", "longsword", "mace", "maul", "morningstar", "musket", "pike", "pistol", "quarterstaff",
      "rapier", "scimitar", "shortsword", "sickle", "spear", "shortbow", "sling", "trident", "warpick", "warhammer", "whip", "net",
      "breastplate", "chainmail", "chainshirt", "halfplate", "hide", "leather", "padded", "plate", "ringmail", "scalemail", "splint", "studded", "shield",
      "alchemist", "bagpipes", "brewer", "calligrapher", "card", "carpenter", "cartographer", "chess", "cobbler", "cook", "dice", "disg", "drum", "dulcimer", "flute", "forg",
      "glassblower", "herb", "horn", "jeweler", "leatherworker", "lute", "lyre", "mason", "navg", "painter", "panflute", "pois", "potter", "shawm", "smith", "thief", "tinker",
      "viol", "weaver", "woodcarver",
      "arrow", "crossbowBolt", "blowgunNeedle", "slingBullet", "firearmBullet"]; // ammoIds
    expect(keys.filter((k) => !BASE_ITEM_NAMES[k])).toEqual([]);
  });
});

describe("isNoSpace", () => {
  const natural = { type: "weapon", value: "natural" };

  it.each([
    ["a natural weapon on any actor", { name: "Bite", ...natural, actorType: "character" }],
    ["a natural weapon on an npc", { name: "Rend", ...natural, actorType: "npc", page: "monsterAction", hash: "rend_sphinx%20of%20wonder_xmm_xmm" }],
    ["a weightless monster action", { name: "Hurl Rock", type: "weapon", value: "simpleR", page: "monsterAction" }],
    ["a weightless monster action, even with a base item", { name: "Claw Sword", type: "weapon", value: "martialM", baseItem: "longsword", page: "monsterAction" }],
    ["a weightless npc weapon with no gear and no base", { name: "Tail Attack", type: "weapon", value: "simpleM", actorType: "npc" }],
    ["Unarmed Strike by hash", { name: "Golpe", type: "weapon", value: "simpleM", page: "items.html", hash: "unarmed%20strike_xphb" }],
    ["Unarmed Strike by name", { name: "Unarmed Strike", type: "weapon", value: "simpleM" }],
    ["Unarmed Strike in Portuguese", { name: "Ataque Desarmado", type: "weapon", value: "simpleM" }],
    ["a siege weapon", { name: "Ballista", type: "weapon", value: "siege", weight: 100 }],
    ["vehicle equipment", { name: "Hull Plating", type: "equipment", value: "vehicle", weight: 100 }]
  ])("%s takes no space", (_label, spec) => {
    expect(isNoSpace(item(spec))).toBe(true);
    expect(describeDnd5e(item(spec)).noSpace).toBe(true);
  });

  it.each([
    ["Clawed Gauntlet by name", { name: "Clawed Gauntlet", ...natural }],
    ["Clawed Gauntlet renamed, by identifier", { name: "Manopla", ...natural, identifier: "clawed-gauntlet" }],
    ["Clawed Gauntlet renamed, by hash", { name: "Manopla", ...natural, page: "items.html", hash: "clawed%20gauntlet_xphb" }],
    ["a monster's real longsword (page says monsterAction, weight says real)", { name: "Longsword", ...LONGSWORD, page: "monsterAction", hash: "longsword_soldier_ggr_ggr", actorType: "npc" }],
    ["a weightless npc weapon with gear", { name: "Rock", type: "weapon", value: "simpleR", actorType: "npc", properties: ["gear"] }],
    ["a weightless npc weapon with a base item", { name: "Longsword", type: "weapon", value: "martialM", baseItem: "longsword", actorType: "npc" }],
    ["a weightless weapon on a character", { name: "Flame Tongue", type: "weapon", value: "martialM", actorType: "character" }],
    ["a weightless non-weapon on an npc", { name: "Pearl", type: "loot", value: "gem", actorType: "npc" }],
    ["natural armor is equipment, not an attack", { name: "Tough Hide", type: "equipment", value: "natural" }]
  ])("%s takes space", (_label, spec) => {
    expect(isNoSpace(item(spec))).toBe(false);
  });

  describe("S3: a weightless npc weapon named as a real weapon is one", () => {
    const npcWeapon = (name, extra = {}) => item({ name, type: "weapon", value: "simpleM", actorType: "npc", ...extra });

    it.each(["Scimitar", "Spiked Bone Club", "Longsword", "Flaming Greatsword"])("%s takes space", (name) => {
      expect(isNoSpace(npcWeapon(name))).toBe(false);
    });

    it("the identifier counts too, so a renamed one stays", () => {
      expect(isNoSpace(npcWeapon("Lamina do Djinn", { identifier: "scimitar" }))).toBe(false);
      expect(isNoSpace(npcWeapon("Zzyzx", { identifier: "spiked-bone-club" }))).toBe(false);
    });

    it.each(["Tail Attack", "Rock", "Fist", "Fork", "Clubbed Foot", "Chain", "Pact Blade", "Flame Sword", "Hurl Flame", "Spit Poison"])("%s stays excluded", (name) => {
      expect(isNoSpace(npcWeapon(name))).toBe(true);
    });

    it("only the npc clause listens: a natural or monsterAction one is still excluded", () => {
      expect(isNoSpace(item({ name: "Scimitar", type: "weapon", value: "natural", actorType: "npc" }))).toBe(true);
      expect(isNoSpace(item({ name: "Scimitar", type: "weapon", value: "simpleM", actorType: "npc", page: "monsterAction" }))).toBe(true);
    });
  });

  it("reads gear from a Set as well as an array (runtime and toObject shapes)", () => {
    const set = item({ name: "Rock", type: "weapon", value: "simpleR", actorType: "npc" });
    set.system.properties = new Set(["gear"]);
    expect(isNoSpace(set)).toBe(false);
  });
});

describe("bags and vessels (M4 builds on these)", () => {
  const bag = (name, system = {}, extra = {}) => item({ name, type: "container", system, ...extra });
  const lb = (value) => ({ capacity: { weight: { value, units: "lb" } } });
  const ft3 = (value) => ({ capacity: { volume: { value, units: "cubicFoot" } } });
  const weightless = { properties: ["weightlessContents"] };

  it.each([
    ["Backpack", lb(30), { cols: 8, rows: 6 }],
    ["Pouch", lb(6), { cols: 3, rows: 2 }],
    ["Sack", lb(30), { cols: 6, rows: 4 }],
    ["Basket", lb(40), { cols: 6, rows: 5 }],
    ["Saddlebags", lb(30), { cols: 8, rows: 5 }],
    ["Chest", lb(300), { cols: 12, rows: 8 }],
    ["Barrel", ft3(4), { cols: 8, rows: 8 }],
    ["Bag of Holding", { ...lb(500), ...weightless }, { cols: 12, rows: 8 }]
  ])("%s has its table size", (name, system, dims) => {
    expect(isBag(bag(name, system))).toBe(true);
    expect(bagDims(bag(name, system))).toEqual(dims);
  });

  it("the name table is exact: Left Pouch and a 30 lb Pack go by capacity", () => {
    expect(bagDims(bag("Left Pouch", lb(200)))).toEqual({ cols: 12, rows: 8 });
    expect(bagDims(bag("Central Pouch", ft3(64)))).toEqual({ cols: 12, rows: 8 });
    expect(bagDims(bag("Explorer's Pack", lb(30)))).toEqual({ cols: 8, rows: 6 });
    expect(bagDims(bag("Diplomat's Pack", lb(360)))).toEqual({ cols: 12, rows: 8 });
  });

  it("a renamed bag keeps its table size through the identifier, or its band through capacity", () => {
    expect(bagDims(bag("Mochila", lb(30), { identifier: "backpack" }))).toEqual({ cols: 8, rows: 6 });
    expect(bagDims(bag("Mochila", lb(30)))).toEqual({ cols: 8, rows: 6 });
  });

  it("the capacity bands never shrink as capacity grows", () => {
    let last = 0;
    for (const value of [6, 10, 15, 20, 30, 40, 80, 150, 300, 500, 5000]) {
      const { cols, rows } = bagDims(bag("Zzyzx", lb(value)));
      expect(cols * rows, String(value)).toBeGreaterThanOrEqual(last);
      last = cols * rows;
    }
  });

  it("flag dims win over the table", () => {
    expect(bagDims(bag("Backpack", lb(30), { ours: { container: { cols: 2, rows: 2 } } }))).toEqual({ cols: 2, rows: 2 });
  });

  it("a plain item with container dims is a bag; without them it is not", () => {
    expect(isBag(item({ name: "Cart", ours: { container: { cols: 4, rows: 4 } } }))).toBe(true);
    expect(isBag(item({ name: "Cart" }))).toBe(false);
  });

  it("flags.container === false turns a bag off", () => {
    const off = bag("Backpack", lb(30), { ours: { container: false } });
    expect(isBag(off)).toBe(false);
    expect(bagDims(off)).toBeNull();
  });

  it.each([
    ["Waterskin", lb(4)], ["Jug", lb(8.4)], ["Pitcher", lb(8.4)], ["Iron Pot", lb(8.4)], ["Pot, Iron", lb(8.4)], ["Bucket", lb(25)],
    ["Tankard", lb(1)], ["Flask", lb(1)], ["Vial", lb(0.25)], ["Glass Bottle", lb(1.5)], ["Bottle, Glass", lb(1.5)], ["Quiver", { capacity: { count: 20 } }],
    ["Crossbow Bolt Case", lb(1.5)], ["Case, Crossbow Bolt", { capacity: { count: 20 } }], ["Map or Scroll Case", { capacity: { count: 10 } }], ["Scroll Case", {}], ["Map Case", {}],
    ["Case, Map or Scroll", { capacity: { count: 10 } }]
  ])("%s is a vessel, an ordinary item", (name, system) => {
    expect(isVessel(bag(name, system))).toBe(true);
    expect(isBag(bag(name, system))).toBe(false);
    expect(bagDims(bag(name, system))).toBeNull();
  });

  it("a vessel renamed in Portuguese stays a vessel through its identifier", () => {
    expect(isBag(bag("Balde", lb(25), { identifier: "bucket" }))).toBe(false);
    expect(isBag(bag("Jarro", lb(8.4), { identifier: "jug" }))).toBe(false);
  });

  it("vessels win unless the capacity is real", () => {
    expect(isBag(bag("Quiver of Ehlonna", { capacity: { count: 60 }, ...weightless }))).toBe(false);
    expect(isBag(bag("Efficient Quiver", { capacity: { count: 84 }, ...weightless }))).toBe(false);
    expect(isBag(bag("Giant's Bucket", lb(200)))).toBe(true);
  });

  it("small capacity and no capacity are not bags", () => {
    expect(isBag(bag("Alms Box", lb(2)))).toBe(false);
    expect(isBag(bag("Zzyzx", lb(5.9)))).toBe(false);
    expect(isBag(bag("Zzyzx", ft3(0.5)))).toBe(false);
    expect(isBag(bag("Component Pouch"))).toBe(false);
  });

  it("weightlessContents with no capacity gets 8x6", () => {
    expect(isBag(bag("Handy Haversack", weightless))).toBe(true);
    expect(bagDims(bag("Handy Haversack", weightless))).toEqual({ cols: 8, rows: 6 });
    expect(bagDims(bag("Bag of Devouring", weightless))).toEqual({ cols: 8, rows: 6 });
  });

  it("reads weightlessContents from a Set too", () => {
    const b = bag("Handy Haversack");
    b.system.properties = new Set(["weightlessContents"]);
    expect(isBag(b)).toBe(true);
  });
});

describe("dnd5e profile", () => {
  beforeEach(() => {
    game.system.id = "dnd5e";
    game.user.isGM = false;
  });

  describe("describe", () => {
    it("adds the dnd5e fields, and still carries the module's flags", () => {
      const d = adapter.describe(item({ name: "Longsword +1", ...LONGSWORD, ours: { size: { w: 2, h: 2 } } }));
      expect(d).toMatchObject({
        type: "weapon", name: "Longsword +1", systemId: "dnd5e", identityNames: ["longsword"], baseMatch: true,
        subtype: "weapon:martialM", weight: 3, noSpace: false, flags: { size: { w: 2, h: 2 } }
      });
    });

    it.each(["CoC7", "deltagreen"])("%s has no extras: the descriptor is exactly what it was", (system) => {
      game.system.id = system;
      const d = adapter.describe({ name: "Faca", type: "weapon", flags: {}, system: {} });
      expect(Object.keys(d).sort()).toEqual(["coreId", "flags", "name", "sourceId", "systemId", "type"]);
      expect(adapter.profile().describeExtras).toBeUndefined();
    });
  });

  describe("quantity", () => {
    it("reads system.quantity on dnd5e", () => {
      expect(adapter.itemQuantity({ system: { quantity: 20 } })).toBe(20);
      expect(adapter.itemQuantity({ system: { quantity: 1 } })).toBe(1);
      expect(adapter.itemQuantity({ system: {} })).toBe(1);
      expect(adapter.itemQuantity({ system: { quantity: "x" } })).toBe(1);
      expect(adapter.itemQuantity({ system: { quantity: 0 } })).toBe(0);
    });

    it.each(["CoC7", "deltagreen"])("is always 1 on %s, even with a quantity field", (system) => {
      game.system.id = system;
      expect(adapter.itemQuantity({ system: { quantity: 20 } })).toBe(1);
    });

    it("a stack's size does not grow with quantity", () => {
      const of = (quantity) => svc.itemSize(item({ name: "Arrows", type: "consumable", value: "ammo", subtype: "arrow", weight: 0.05, system: { quantity } })).size;
      expect(of(1)).toEqual({ w: 2, h: 1 });
      expect(of(20)).toEqual(of(1));
      expect(of(9999)).toEqual(of(1));
      const heavy = (quantity) => svc.itemSize(item({ name: "Zzyzx", weight: 12, system: { quantity } })).size;
      expect(heavy(50)).toEqual(heavy(1));
    });
  });

  describe("displayName", () => {
    const hidden = { name: "Vorpal Sword", type: "weapon", system: { identified: false, unidentified: { name: "" } } };

    it("gives a Player a generic label for an unidentified item with an empty name", () => {
      expect(adapter.displayName(hidden, { isGM: false })).toBe("ATTACHE.Window.Unidentified");
    });

    it("the GM keeps the real name", () => {
      expect(adapter.displayName(hidden, { isGM: true })).toBe("Vorpal Sword");
    });

    it("uses game.user by default", () => {
      expect(adapter.displayName(hidden)).toBe("ATTACHE.Window.Unidentified");
      game.user.isGM = true;
      expect(adapter.displayName(hidden)).toBe("Vorpal Sword");
    });

    it("a filled unidentified name is already item.name, for everyone", () => {
      const named = { name: "Strange Blade", system: { identified: false, unidentified: { name: "Strange Blade" } } };
      expect(adapter.displayName(named, { isGM: false })).toBe("Strange Blade");
    });

    it("an identified item shows its name; so does one with no unidentified data", () => {
      expect(adapter.displayName({ name: "Rope", system: { identified: true, unidentified: { name: "" } } }, { isGM: false })).toBe("Rope");
      expect(adapter.displayName({ name: "Rope", system: {} }, { isGM: false })).toBe("Rope");
    });

    it.each(["CoC7", "deltagreen"])("%s shows the name as it is", (system) => {
      game.system.id = system;
      expect(adapter.displayName(hidden, { isGM: false })).toBe("Vorpal Sword");
    });

    it("the string exists in both languages", () => {
      for (const lang of ["en", "pt-BR"]) {
        const json = JSON.parse(readFileSync(new URL(`../../lang/${lang}.json`, import.meta.url), "utf8"));
        expect(json.ATTACHE.Window.Unidentified, lang).toBeTruthy();
      }
    });
  });

  describe("identified state never changes the size", () => {
    const doc = (fake, identified) => ({
      ...item({ name: fake, ...LONGSWORD, system: { identified, unidentified: { name: identified ? "" : fake } } }),
      _source: { name: "Longsword" }
    });

    it("with the base item", () => {
      expect(svc.itemSize(doc("Mysterious Blade", false)).size).toEqual({ w: 6, h: 1 });
      expect(svc.itemSize(doc("Longsword", true)).size).toEqual({ w: 6, h: 1 });
    });

    it("with no data but the real name: the fake one must not be read", () => {
      const raw = (name, identified) => ({
        ...item({ name, system: { identified, unidentified: { name: identified ? "" : "Strange Rock" } } }),
        _source: { name: "Rope" }
      });
      expect(svc.itemSize(raw("Strange Rock", false)).size).toEqual(svc.itemSize(raw("Rope", true)).size);
      expect(svc.itemSize(raw("Rope", true)).size).toEqual({ w: 2, h: 2 });
    });
  });

  describe("visibleSystemKeys", () => {
    it("covers what the case shows or sizes from", () => {
      const keys = adapter.profile().visibleSystemKeys;
      for (const k of ["quantity", "identified", "unidentified", "weight", "type", "properties"]) expect(keys, k).toContain(k);
    });

    it.each(["quantity", "unidentified", "properties", "weight"])("a change of system.%s on another client re-renders the case", (key) => {
      const refresh = vi.spyOn(AttacheCaseApp, "refreshFor").mockImplementation(() => {});
      const actor = env.addActor({ type: "character", items: [{ _id: "l", name: "Zzyzx", type: "loot" }] });
      hook("updateItem")(actor.items.get("l"), { system: { [key]: 2 } }, {}, "someone-else");
      expect(refresh).toHaveBeenCalledTimes(1);
      refresh.mockRestore();
    });
  });

  describe("M2: registerSizes byName", () => {
    it("sizes one item by name, ahead of its base item and its identifier", () => {
      svc.registerSizes({ byName: { dnd5e: { "Flame Tongue Longsword": "7x1", "My Rope": [5, 5] } } });
      const sized = (spec) => svc.itemSize(item(spec));
      expect(sized({ name: "Flame Tongue Longsword", ...LONGSWORD })).toMatchObject({ size: { w: 7, h: 1 }, source: "name" });
      expect(sized({ name: "My Rope", identifier: "rope" })).toMatchObject({ size: { w: 5, h: 5 }, source: "name" });
      expect(sized({ name: "My Rope" })).toMatchObject({ size: { w: 5, h: 5 }, source: "name" });
      // Every other longsword and rope is untouched.
      expect(sized({ name: "Longsword", ...LONGSWORD })).toMatchObject({ size: { w: 6, h: 1 }, source: "identity" });
      expect(sized({ name: "Zzyzx", identifier: "rope" })).toMatchObject({ size: { w: 2, h: 2 }, source: "identity" });
    });

    it("a byName on the base key still reaches every item of that base, renamed or not", () => {
      svc.registerSizes({ byName: { dnd5e: { morningstar: "5x1" } } });
      expect(svc.itemSize(item({ name: "Estrela", type: "weapon", value: "martialM", baseItem: "morningstar" })).size).toEqual({ w: 5, h: 1 });
    });
  });

  it("a refused actor type says so, rather than blaming the game system", () => {
    env.notifications.length = 0;
    expect(AttacheCaseApp.open(env.addActor({ type: "group" }))).toBeNull();
    expect(env.notifications).toEqual([{ type: "warn", msg: "ATTACHE.Notify.UnsupportedActor" }]);
  });

  describe("presets", () => {
    it("are the fantasy list, not the modern one", () => {
      expect(adapter.containerPresets()).toBe(DND5E_PRESETS);
      expect(DND5E_PRESETS.length).toBeGreaterThanOrEqual(6);
      const modern = new Set(CONTAINER_PRESETS.map((p) => p.key));
      expect(DND5E_PRESETS.filter((p) => modern.has(p.key))).toEqual([]);
      expect(new Set(DND5E_PRESETS.map((p) => p.key)).size).toBe(DND5E_PRESETS.length);
    });

    it("have the dimensions the bag table gives the same bag", () => {
      const byKey = Object.fromEntries(DND5E_PRESETS.map((p) => [p.key, { cols: p.cols, rows: p.rows }]));
      expect(byKey).toMatchObject({
        fantasyPouch: bagDims(item({ name: "Pouch", type: "container", system: { capacity: { weight: { value: 6 } } } })),
        fantasySack: bagDims(item({ name: "Sack", type: "container", system: { capacity: { weight: { value: 30 } } } })),
        fantasyBackpack: bagDims(item({ name: "Backpack", type: "container", system: { capacity: { weight: { value: 30 } } } }))
      });
    });

    it("have sane data and strings in both languages, in the lang files too", () => {
      for (const p of DND5E_PRESETS) {
        expect(Number.isInteger(p.cols) && p.cols >= 1 && p.cols <= 32, p.key).toBe(true);
        expect(Number.isInteger(p.rows) && p.rows >= 1 && p.rows <= 32, p.key).toBe(true);
        expect(p.img).toMatch(/^icons\/[\w/-]+\.(webp|svg)$/);
        const [, , seg] = p.name.split(".");
        for (const lang of ["en", "pt-BR"]) {
          const file = JSON.parse(readFileSync(new URL(`../../lang/${lang}.json`, import.meta.url), "utf8"));
          for (const s of [PRESET_STRINGS[lang].ATTACHE.Preset[seg], file.ATTACHE.Preset[seg]]) {
            expect(s?.Name, `${lang} ${seg}`).toBeTruthy();
            expect(s?.Description, `${lang} ${seg}`).toBeTruthy();
          }
        }
      }
    });

    it("S4: each preset carries the system data of the compendium bag of the same name", async () => {
      const dir = new URL("../../packs-src/containers-dnd5e/", import.meta.url);
      const { readdirSync } = await import("node:fs");
      const docs = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
      const en = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8")).ATTACHE.Preset;
      const actor = env.addActor({ type: "character" });
      for (const p of DND5E_PRESETS) {
        const [, , seg] = p.name.split(".");
        const doc = docs.find((d) => d.name === en[seg].Name);
        expect(p.system, p.key).toMatchObject({ weight: doc.system.weight, capacity: doc.system.capacity, properties: doc.system.properties });
        const created = await svc.addPresetContainer(actor, p.key);
        expect(created.system, p.key).toMatchObject({ weight: doc.system.weight, capacity: doc.system.capacity, properties: doc.system.properties });
        expect(isBag(created), p.key).toBe(true);
        expect(created.system.description.value).toContain(p.description);
      }
    });

    it("S4: the Bag of Holding is what its description says", () => {
      const bag = DND5E_PRESETS.find((p) => p.key === "fantasyBagOfHolding");
      expect(bag.system.properties).toEqual(expect.arrayContaining(["mgc", "weightlessContents"]));
    });

    it("S4: a system with no preset data builds what it always did", () => {
      game.system.id = "CoC7";
      const data = adapter.containerItemData({ name: "Bag", description: "Big", img: "x.webp", cols: 4, rows: 3 });
      expect(Object.keys(data.system)).toEqual(["description"]);
    });

    it("adding one makes a real dnd5e container with a grid", async () => {
      const actor = env.addActor({ type: "character" });
      const p = DND5E_PRESETS.find((x) => x.key === "fantasyBackpack");
      const created = await svc.addPresetContainer(actor, p.key);
      expect(created.type).toBe("container");
      expect(created.getFlag(M, "container")).toEqual({ cols: p.cols, rows: p.rows });
    });
  });
});

describe("quantity label", () => {
  it.each([[2, "2"], [20, "20"], [999, "999"], [1000, "1k"], [1500, "1k"], [12345, "12k"], [999999, "999k"], [1000000, "1M"], [25000000, "25M"]])("%d is %s: never over 3 characters", (n, label) => {
    expect(adapter.quantityLabel(n)).toBe(label);
  });
});

describe("built packs/containers-dnd5e", () => {
  it("holds exactly what packs-src holds", async () => {
    let ClassicLevel;
    try {
      ({ ClassicLevel } = await import("classic-level"));
    } catch {
      console.warn("[dnd5e] SKIPPED: classic-level is unavailable here.");
      return;
    }
    const { cpSync, mkdtempSync, readdirSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    // Opening LevelDB writes to it: read a copy, never the tracked files.
    const tmp = mkdtempSync(join(tmpdir(), "attache-pack-"));
    cpSync(fileURLToPath(new URL("../../packs/containers-dnd5e", import.meta.url)), tmp, { recursive: true });
    const db = new ClassicLevel(tmp, { keyEncoding: "utf8", valueEncoding: "json" });
    const built = new Map();
    try {
      for await (const [key, value] of db.iterator()) built.set(key, value);
    } finally {
      await db.close();
      rmSync(tmp, { recursive: true, force: true });
    }
    const dir = new URL("../../packs-src/containers-dnd5e/", import.meta.url);
    const sources = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    expect([...built.keys()].sort()).toEqual(sources.map((d) => d._key).sort());
    for (const src of sources) {
      const doc = built.get(src._key);
      for (const key of ["_id", "name", "type", "img", "system", "flags", "sort"]) expect(doc[key], `${src.name} ${key}`).toEqual(src[key]);
    }
  });
});

describe("packs-src/containers-dnd5e", () => {
  const dir = new URL("../../packs-src/containers-dnd5e/", import.meta.url);
  let docs = [];

  beforeAll(async () => {
    const { readdirSync } = await import("node:fs");
    docs = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
  });

  it("has one bag per preset, with the same grid", () => {
    expect(docs.length).toBe(DND5E_PRESETS.length);
    const en = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8")).ATTACHE.Preset;
    for (const p of DND5E_PRESETS) {
      const [, , seg] = p.name.split(".");
      const doc = docs.find((d) => d.name === en[seg].Name);
      expect(doc, p.key).toBeTruthy();
      expect(doc.flags[M].container).toEqual({ cols: p.cols, rows: p.rows });
      expect(doc.img).toBe(p.img);
    }
  });

  it("are valid dnd5e containers, with data the M4 bag rule accepts", () => {
    const ids = new Set();
    for (const d of docs) {
      expect(d._id, d.name).toMatch(/^[A-Za-z0-9]{16}$/);
      ids.add(d._id);
      expect(d._key).toBe(`!items!${d._id}`);
      expect(d.type, d.name).toBe("container");
      expect(d.system.description.value, d.name).toMatch(/^<p>/);
      expect(isBag(d), d.name).toBe(true);
      expect(bagDims(d), d.name).toEqual(d.flags[M].container);
    }
    expect(ids.size).toBe(docs.length);
  });

  it("Bag of Holding has dnd5e's own properties", () => {
    expect(docs.find((d) => d.name === "Bag of Holding").system.properties.sort()).toEqual(["mgc", "weightlessContents"]);
  });

  it("is declared in module.json for dnd5e only, inside our pack folder", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../module.json", import.meta.url), "utf8"));
    const pack = manifest.packs.find((p) => p.name === "containers-dnd5e");
    expect(pack).toMatchObject({ system: "dnd5e", path: "packs/containers-dnd5e", type: "Item" });
    expect(manifest.packFolders[0].packs).toContain("containers-dnd5e");
  });
});
