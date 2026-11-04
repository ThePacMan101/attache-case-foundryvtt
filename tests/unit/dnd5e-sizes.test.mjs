import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeDnd5e } from "../../scripts/core/dnd5e.mjs";
import { explainSize, mergeRegistries, resolveSize } from "../../scripts/core/sizes.mjs";
import { DEFAULT_REGISTRY } from "../../scripts/data/default-sizes.mjs";
import { DND5E_SIZES } from "../../scripts/data/default-sizes-dnd5e.mjs";
import { item, LONGSWORD } from "./helpers/dnd5e-items.mjs";

const size = (w, h) => ({ w, h });

/** The descriptor the adapter builds for a dnd5e item. */
const descriptor = (raw) => ({ type: raw.type, name: raw.name, systemId: "dnd5e", sourceId: raw._stats?.compendiumSource ?? null, coreId: null, flags: raw.flags?.["attache-case"] ?? {}, ...describeDnd5e(raw) });
const explain = (spec, reg = DEFAULT_REGISTRY) => explainSize(descriptor(item(spec)), reg);
const sizeOf = (spec, reg = DEFAULT_REGISTRY) => explain(spec, reg).size;

const LONGSWORD_SIZE = size(6, 1);
const DAGGER = { type: "weapon", value: "simpleM", weight: 1 };

describe("A5 rule order", () => {
  const entry = (w) => size(w, 1);
  /** One table per rule, each with its own width, all matching the same descriptor. */
  const reg = {
    physicalTypes: { dnd5e: ["weapon"] },
    byId: { dnd5e: { "src-id": entry(3) } },
    byName: { dnd5e: { identity: entry(4), "plain name": entry(5) } },
    baseNames: { dnd5e: { base: entry(6) } },
    keywords: [{ pattern: /plain/, size: entry(7) }],
    bySubtype: { dnd5e: { "weapon:sub": entry(8) } },
    weightBands: { dnd5e: [{ size: entry(9) }] },
    byType: { dnd5e: { weapon: entry(10) } }
  };
  const full = {
    type: "weapon", name: "Plain Name", systemId: "dnd5e", sourceId: "src-id", coreId: null, flags: { size: entry(2) },
    noSpace: true, identityNames: ["identity"], hashName: "base", baseMatch: true, subtype: "weapon:sub", weight: 5
  };
  // [what to take away to reach the next rule, source, width]
  const STEPS = [
    ["flag", { size: entry(2), excluded: false, source: "flag" }],
    ["noSpace", { size: null, excluded: true, source: "noSpace" }],
    ["id", { size: entry(3), excluded: false, source: "id" }],
    ["identity", { size: entry(4), excluded: false, source: "identity" }],
    ["name", { size: entry(5), excluded: false, source: "name" }],
    ["baseName", { size: entry(6), excluded: false, source: "baseName" }],
    ["keyword", { size: entry(7), excluded: false, source: "keyword" }],
    ["subtype", { size: entry(8), excluded: false, source: "subtype" }],
    ["weight", { size: entry(9), excluded: false, source: "weight" }],
    ["type", { size: entry(10), excluded: false, source: "type" }],
    ["fallback", { size: size(1, 1), excluded: false, source: "fallback" }]
  ];
  const off = {
    flag: { flags: {} }, noSpace: { noSpace: false }, id: { sourceId: null }, identity: { identityNames: [] }, name: { name: "Other Plain" },
    baseName: { hashName: null, baseMatch: false }, keyword: { name: "Zzyzx" }, subtype: { subtype: null }, weight: { weight: null }
  };

  it("walks the whole chain, in order: taking one rule away reaches exactly the next", () => {
    let d = { ...full };
    let r = reg;
    for (const [rule, expected] of STEPS) {
      expect(explainSize(d, r), rule).toEqual(expected);
      d = { ...d, ...off[rule] };
      if (rule === "type") r = { ...reg, byType: {} };
    }
  });

  it("a GM excluded:false overrides noSpace, and resolution goes on", () => {
    const d = { ...full, flags: { excluded: false } };
    expect(explainSize(d, reg).source).toBe("id");
  });

  it("a GM excluded:true beats everything, and a GM size beats noSpace", () => {
    expect(explainSize({ ...full, flags: { excluded: true } }, reg)).toMatchObject({ size: null, excluded: true, source: "flag" });
    expect(explainSize({ ...full, flags: { size: size(2, 2) } }, reg)).toMatchObject({ size: size(2, 2), source: "flag" });
  });

  it("an exact name entry beats a whole-word base name", () => {
    const r = { ...reg, byName: { dnd5e: { "the base": entry(5) } } };
    expect(explainSize({ ...full, flags: {}, noSpace: false, sourceId: null, identityNames: [], name: "The Base", hashName: null }, r).source).toBe("name");
  });

  it("identity names are tried in order", () => {
    const r = { ...reg, byName: { dnd5e: { first: entry(4), second: entry(5) } } };
    const d = { ...full, flags: {}, noSpace: false, sourceId: null, identityNames: ["missing", "second", "first"] };
    expect(explainSize(d, r).size).toEqual(entry(5));
  });

  it("whole words only, longest first, hash name before item name, only when allowed", () => {
    const r = { physicalTypes: { dnd5e: ["weapon"] }, baseNames: { dnd5e: { scimitar: entry(2), "double-bladed scimitar": entry(3), dagger: entry(4) } } };
    const d = (name, extra = {}) => ({ type: "weapon", name, systemId: "dnd5e", flags: {}, baseMatch: true, ...extra });
    expect(explainSize(d("Flaming Double-Bladed Scimitar"), r)).toMatchObject({ size: entry(3), source: "baseName" });
    expect(explainSize(d("+1 Scimitar"), r).size).toEqual(entry(2));
    expect(explainSize(d("Scimitars"), r).source).toBe("fallback");
    expect(explainSize(d("Daggerfall"), r).source).toBe("fallback");
    expect(explainSize(d("Bedagger"), r).source).toBe("fallback");
    expect(explainSize(d("Lâmina", { hashName: "+1 dagger" }), r).size).toEqual(entry(4));
    expect(explainSize(d("Scimitar", { hashName: "+1 dagger" }), r).size).toEqual(entry(4));
    expect(explainSize(d("Scimitar", { hashName: "zzyzx" }), r).size).toEqual(entry(2));
    expect(explainSize(d("Scimitar", { baseMatch: false }), r).source).toBe("fallback");
    expect(explainSize(d("Scimitar", { baseMatch: undefined }), r).source).toBe("fallback");
  });

  it("a subtype falls back to its parent key", () => {
    const r = { physicalTypes: { dnd5e: ["consumable"] }, bySubtype: { dnd5e: { "consumable:ammo": entry(2), "consumable:ammo:arrow": entry(3) } } };
    const d = (subtype) => ({ type: "consumable", name: "x", systemId: "dnd5e", flags: {}, subtype });
    expect(explainSize(d("consumable:ammo:arrow"), r).size).toEqual(entry(3));
    expect(explainSize(d("consumable:ammo:needle"), r).size).toEqual(entry(2));
    expect(explainSize(d("consumable:potion"), r).source).toBe("fallback");
  });

  it("weight bands take the first band the weight fits; 0, null and garbage skip them", () => {
    const r = { physicalTypes: { dnd5e: ["loot"] }, byType: { dnd5e: { loot: entry(9) } }, weightBands: { dnd5e: [{ max: 10, size: entry(3) }, { max: 1, size: entry(2) }, { size: entry(4) }, { max: "x", size: "garbage" }] } };
    const d = (weight) => ({ type: "loot", name: "x", systemId: "dnd5e", flags: {}, weight });
    expect(explainSize(d(0.5), r)).toMatchObject({ size: entry(2), source: "weight" });
    expect(explainSize(d(1), r).size).toEqual(entry(2));
    expect(explainSize(d(1.01), r).size).toEqual(entry(3));
    expect(explainSize(d(5000), r).size).toEqual(entry(4));
    for (const w of [0, null, undefined, -1, "5", NaN]) expect(explainSize(d(w), r).source, String(w)).toBe("type");
  });

  it("mergeRegistries carries bySubtype, weightBands and baseNames, and later wins", () => {
    const a = { bySubtype: { dnd5e: { x: entry(2), y: entry(3) } }, weightBands: { dnd5e: [{ size: entry(2) }] }, baseNames: { dnd5e: { "Long Sword": entry(2) } } };
    const b = { bySubtype: { dnd5e: { x: entry(4) } }, weightBands: { dnd5e: [{ size: entry(5) }] } };
    const m = mergeRegistries(a, b);
    expect(m.bySubtype.dnd5e).toEqual({ x: entry(4), y: entry(3) });
    expect(m.weightBands.dnd5e).toEqual([{ size: entry(5) }]);
    expect(m.baseNames.dnd5e).toEqual({ "long sword": entry(2) });
    const r = { ...m, physicalTypes: { dnd5e: ["loot"] } };
    expect(explainSize({ type: "loot", name: "n", systemId: "dnd5e", flags: {}, subtype: "x" }, r).size).toEqual(entry(4));
    expect(explainSize({ type: "loot", name: "n", systemId: "dnd5e", flags: {}, weight: 1 }, r).size).toEqual(entry(5));
    expect(explainSize({ type: "loot", name: "A Long Sword", systemId: "dnd5e", flags: {}, baseMatch: true }, r).size).toEqual(entry(2));
  });

  it("the new tables obey '*' with the system winning", () => {
    const r = { physicalTypes: { dnd5e: ["loot"] }, bySubtype: { "*": { a: entry(2), b: entry(3) }, dnd5e: { b: entry(4) } }, weightBands: { "*": [{ size: entry(5) }] }, baseNames: { "*": { blade: entry(6) } } };
    const d = (extra) => ({ type: "loot", name: "x", systemId: "dnd5e", flags: {}, ...extra });
    expect(explainSize(d({ subtype: "a" }), r).size).toEqual(entry(2));
    expect(explainSize(d({ subtype: "b" }), r).size).toEqual(entry(4));
    expect(explainSize(d({ weight: 1 }), r).size).toEqual(entry(5));
    expect(explainSize(d({ name: "Blade", baseMatch: true }), r).size).toEqual(entry(6));
  });
});

describe("Plutonium hash forms", () => {
  const shield = { type: "equipment", value: "shield", page: "items.html" };

  it("shield_phb and shield_xphb have the same size", () => {
    expect(sizeOf({ name: "Escudo", ...shield, hash: "shield_phb" })).toEqual(size(3, 3));
    expect(sizeOf({ name: "Escudo", ...shield, hash: "shield_xphb" })).toEqual(size(3, 3));
  });

  it("the live lowercase %2b1%20longsword_xdmg is a longsword", () => {
    const spec = { name: "+1 Longsword", type: "weapon", value: "martialM", page: "items.html", hash: "%2b1%20longsword_xdmg" };
    expect(sizeOf(spec)).toEqual(LONGSWORD_SIZE);
    expect(sizeOf({ ...spec, name: "Lâmina Encantada" })).toEqual(LONGSWORD_SIZE);
    expect(explain({ ...spec, name: "Lâmina Encantada" }).source).toBe("baseName");
  });

  it("Obsidianite Dagger with dagger_xphb is a dagger, by identity", () => {
    expect(explain({ name: "Obsidianite Dagger", ...DAGGER, page: "items.html", hash: "dagger_xphb" })).toMatchObject({ size: size(2, 1), source: "identity" });
    expect(explain({ name: "Faca de Obsidiana", ...DAGGER, page: "items.html", hash: "dagger_xphb" })).toMatchObject({ size: size(2, 1), source: "identity" });
  });

  it("longsword_soldier_ggr_ggr keeps the size of its longsword", () => {
    const spec = { name: "Longsword", ...LONGSWORD, page: "monsterAction", hash: "longsword_soldier_ggr_ggr", actorType: "npc" };
    expect(explain(spec)).toMatchObject({ size: LONGSWORD_SIZE, source: "identity" });
    expect(sizeOf({ ...spec, name: "Espada do Soldado" })).toEqual(LONGSWORD_SIZE);
  });

  it("thunderwave_xphb on spells.html has the scroll size and no name match", () => {
    const spec = { name: "Spell Scroll: Thunderwave", type: "consumable", value: "scroll", page: "spells.html", hash: "thunderwave_xphb" };
    expect(sizeOf(spec)).toEqual(size(2, 1));
    // Even a spell whose hash name is also an item name.
    expect(sizeOf({ ...spec, name: "Spell Scroll: Shield", hash: "shield_xphb" })).toEqual(size(2, 1));
    expect(explain({ ...spec, name: "Zzyzx", hash: "shield_xphb" })).toMatchObject({ size: size(2, 1), source: "subtype" });
  });

  it("arrow_xphb and the plural keys agree: a stack of Arrows (20) imports as Arrow", () => {
    const ammo = { type: "consumable", value: "ammo", subtype: "arrow", weight: 0.05, page: "items.html" };
    expect(sizeOf({ name: "Arrow", ...ammo, hash: "arrow_xphb" })).toEqual(size(2, 1));
    expect(sizeOf({ name: "Flechas", ...ammo, hash: "arrows_xphb" })).toEqual(size(2, 1));
  });
});

describe("what takes no space", () => {
  it("Bite and Unarmed Strike are excluded; Clawed Gauntlet is not", () => {
    expect(explain({ name: "Bite", type: "weapon", value: "natural", page: "monsterAction", hash: "bite_x_mm_mm", actorType: "npc" })).toEqual({ size: null, excluded: true, source: "noSpace" });
    expect(explain({ name: "Unarmed Strike", type: "weapon", value: "simpleM", page: "items.html", hash: "unarmed%20strike_xphb" })).toEqual({ size: null, excluded: true, source: "noSpace" });
    expect(sizeOf({ name: "Clawed Gauntlet", type: "weapon", value: "natural" })).toEqual(size(2, 1));
  });

  it("a GM excluded:false puts a monster's bite back, with a size", () => {
    const bite = { name: "Bite", type: "weapon", value: "natural", actorType: "npc" };
    expect(explain({ ...bite, ours: { excluded: false } }).size).not.toBeNull();
    expect(explain({ ...bite, ours: { size: size(3, 3) } })).toMatchObject({ size: size(3, 3), source: "flag" });
  });
});

describe("A5 oracles: the whole-word rule does not misfire", () => {
  const cases = [
    // [name, item spec, size, what it must not be taken for]
    ["Spell Scroll: Lightning Bolt", { type: "consumable", value: "scroll" }, size(2, 1), "a crossbow bolt"],
    ["Bullets, Sling", { type: "consumable", value: "ammo", subtype: "slingBullet", weight: 0.075 }, size(1, 1), "a sling"],
    ["Blowgun Needle", { type: "consumable", value: "ammo", subtype: "blowgunNeedle", weight: 0.02 }, size(1, 1), "a blowgun"],
    ["Feather Token (Whip)", { type: "consumable", value: "trinket" }, size(1, 1), "a whip"],
    ["Falling Net", { type: "equipment", value: "" }, size(1, 1), "a net"],
    ["Shield Guardian Amulet", { type: "equipment", value: "wondrous" }, size(1, 1), "a shield"]
  ];

  it.each(cases)("%s", (name, spec, expected) => {
    const r = explain({ name, ...spec });
    expect(r.size).toEqual(expected);
    expect(r.source).not.toBe("baseName");
  });

  it("the sizes they must not take really differ", () => {
    const of = (name, spec) => sizeOf({ name, ...spec });
    expect(of("Sling", { type: "weapon", value: "simpleR" })).not.toEqual(size(1, 1));
    expect(of("Blowgun", { type: "weapon", value: "martialR" })).not.toEqual(size(1, 1));
    expect(of("Whip", { type: "weapon", value: "martialM" })).not.toEqual(size(1, 1));
    expect(of("Net", { type: "weapon", value: "martialR" })).not.toEqual(size(1, 1));
    expect(of("Shield", { type: "equipment", value: "shield" })).not.toEqual(size(1, 1));
  });

  it("a scroll or wand naming ammunition keeps its own size: the words only decide among keywords", () => {
    expect(sizeOf({ name: "Spell Scroll: Magic Needle", type: "consumable", value: "scroll" })).toEqual(size(2, 1));
    expect(sizeOf({ name: "Scroll of Bullets", type: "loot" })).toEqual(size(2, 1));
    expect(sizeOf({ name: "Wand of Needles", type: "consumable", value: "wand" })).toEqual(size(2, 1));
    expect(sizeOf({ name: "Rod of Arrows", type: "consumable", value: "rod" })).toEqual(size(3, 1));
  });

  it("a real weapon or armor with those words does take the base size", () => {
    expect(sizeOf({ name: "Whip of Warning", type: "weapon", value: "martialM" })).toEqual(sizeOf({ name: "Whip", type: "weapon", value: "martialM" }));
    expect(sizeOf({ name: "Spellguard Shield", type: "equipment", value: "shield" })).toEqual(size(3, 3));
    expect(sizeOf({ name: "Guardian Plate Armor", type: "equipment", value: "heavy" })).toEqual(size(4, 5));
  });
});

describe("variants and renames", () => {
  it("Longsword +1 is a longsword: by base item, and by word with no base item", () => {
    expect(explain({ name: "Longsword +1", ...LONGSWORD })).toMatchObject({ size: LONGSWORD_SIZE, source: "identity" });
    expect(explain({ name: "Longsword +1", type: "weapon", value: "martialM" })).toMatchObject({ size: LONGSWORD_SIZE, source: "baseName" });
  });

  it("a Portuguese-renamed Plutonium longsword is a longsword", () => {
    expect(explain({ name: "Espada Longa Élfica", ...LONGSWORD, page: "items.html", hash: "longsword_xphb" })).toMatchObject({ size: LONGSWORD_SIZE, source: "identity" });
    expect(explain({ name: "Presa do Dragão", type: "weapon", value: "martialM", page: "items.html", hash: "longsword_xphb" })).toMatchObject({ size: LONGSWORD_SIZE, source: "identity" });
  });

  it("Portuguese names with no data use the dnd5e scale, not the CoC keywords", () => {
    const w = { type: "weapon", value: "martialM" };
    expect(explain({ name: "Espada Longa", ...w })).toMatchObject({ size: LONGSWORD_SIZE, source: "keyword" });
    expect(sizeOf({ name: "Espada Curta", ...w })).toEqual(size(4, 1));
    expect(sizeOf({ name: "Espada Grande", ...w })).toEqual(size(8, 2));
    expect(sizeOf({ name: "Adaga de Prata", ...w })).toEqual(size(2, 1));
    expect(sizeOf({ name: "Lança de Caça", ...w })).toEqual(size(8, 1));
    expect(sizeOf({ name: "Arco Longo", ...w })).toEqual(size(8, 2));
    expect(sizeOf({ name: "Besta Leve", ...w })).toEqual(size(6, 3));
    expect(sizeOf({ name: "Cajado do Mago", ...w })).toEqual(size(8, 1));
    expect(sizeOf({ name: "Escudo de Ferro", type: "equipment", value: "" })).toEqual(size(3, 3));
    expect(sizeOf({ name: "Armadura de Placas", type: "equipment", value: "" })).toEqual(size(4, 5));
    expect(sizeOf({ name: "Poção de Cura", type: "consumable", value: "" })).toEqual(size(1, 1));
    expect(sizeOf({ name: "Pergaminho de Cura", type: "loot" })).toEqual(size(2, 1));
    expect(sizeOf({ name: "Corda de Cânhamo", type: "loot" })).toEqual(size(2, 2));
    expect(sizeOf({ name: "Tocha", type: "loot" })).toEqual(size(3, 1));
  });

  it("a renamed compendium item keeps its size through the identifier", () => {
    expect(explain({ name: "Corda", type: "consumable", value: "trinket", weight: 5, identifier: "rope" })).toMatchObject({ size: size(2, 2), source: "identity" });
    expect(explain({ name: "Zzyzx", type: "loot", identifier: "crowbar" }).source).toBe("identity");
  });

  it("renaming changes nothing while the data says the same", () => {
    const spec = { ...LONGSWORD, page: "items.html", hash: "longsword_xphb" };
    expect(sizeOf({ name: "Espada", ...spec })).toEqual(sizeOf({ name: "Longsword", ...spec }));
    expect(sizeOf({ name: "Zzyzx", ...spec })).toEqual(sizeOf({ name: "Longsword", ...spec }));
  });
});

describe("D-003 size scale", () => {
  const ANCHORS = [
    ["dagger", 2, 1], ["shortsword", 4, 1], ["longsword", 6, 1], ["greatsword", 8, 2], ["greataxe", 6, 3], ["quarterstaff", 8, 1], ["spear", 8, 1],
    ["shortbow", 6, 2], ["longbow", 8, 2], ["light crossbow", 6, 3], ["potion of healing", 1, 1], ["scroll", 2, 1], ["arrows", 2, 1], ["rope", 2, 2],
    ["plate armor", 4, 5], ["shield", 3, 3], ["pike", 10, 1], ["lance", 10, 1]
  ];

  it.each(ANCHORS)("%s is %ix%i", (name, w, h) => {
    expect(DND5E_SIZES.byName.dnd5e[name], name).toEqual(size(w, h));
  });

  const WEAPON_IDS = ["battleaxe", "blowgun", "club", "dagger", "dart", "flail", "glaive", "greataxe", "greatclub", "greatsword", "halberd", "handaxe", "handcrossbow",
    "heavycrossbow", "javelin", "lightcrossbow", "lighthammer", "longbow", "longsword", "mace", "maul", "morningstar", "musket", "net", "pistol", "quarterstaff",
    "rapier", "scimitar", "shortsword", "sickle", "spear", "shortbow", "sling", "trident", "warpick", "warhammer", "whip"];

  /** Fits an empty grid, either way round. */
  const fits = ({ w, h }, cols = 8, rows = 5) => (w <= cols && h <= rows) || (h <= cols && w <= rows);

  it.each(WEAPON_IDS)("%s fits an empty 8x5", (baseItem) => {
    const r = explain({ name: "Nome Traduzido", type: "weapon", value: "martialM", baseItem });
    expect(r.source).toBe("identity");
    expect(fits(r.size), `${r.size.w}x${r.size.h}`).toBe(true);
  });

  it.each(["pike", "lance"])("%s stays 10x1, the named exception", (baseItem) => {
    const r = explain({ name: "Nome Traduzido", type: "weapon", value: "martialM", baseItem });
    expect(r.size).toEqual(size(10, 1));
    expect(fits(r.size)).toBe(false);
  });

  it("table keys include singular and plural", () => {
    const t = DND5E_SIZES.byName.dnd5e;
    for (const [one, many] of [["arrow", "arrows"], ["bolt", "bolts"], ["dagger", "daggers"], ["dart", "darts"], ["javelin", "javelins"], ["handaxe", "handaxes"],
      ["sling bullet", "sling bullets"], ["torch", "torches"], ["potion", "potions"], ["spear", "spears"], ["quarterstaff", "quarterstaves"], ["longsword", "longswords"]]) {
      expect(t[one], one).toBeTruthy();
      expect(t[many], many).toEqual(t[one]);
    }
  });

  it("every table entry is horizontal or plate armor's 4x5, and within 8 but for the exceptions", () => {
    for (const [key, e] of Object.entries(DND5E_SIZES.byName.dnd5e)) {
      if (/pikes?$|lances?$/.test(key)) continue;
      expect(e.w, key).toBeLessThanOrEqual(8);
      expect(fits(e), key).toBe(true);
    }
  });

  it("every keyword, subtype and weight band stays within 8 and fits an empty 8x5, but for the pike and lance keyword", () => {
    const bad = (e) => e.w > 8 || !fits(e);
    const keywords = DND5E_SIZES.keywords.filter((k) => bad(k.size));
    expect(keywords.map((k) => String(k.pattern))).toHaveLength(1);
    expect(keywords[0].pattern.test("Pike of Zzyzx") && keywords[0].size).toEqual(size(10, 1));
    expect(Object.entries(DND5E_SIZES.bySubtype.dnd5e).filter(([, e]) => bad(e)).map(([key]) => key)).toEqual([]);
    expect(DND5E_SIZES.weightBands.dnd5e.filter((b) => bad(b.size))).toEqual([]);
  });

  it("every whole-word base name is also an exact name with the same size", () => {
    for (const [key, e] of Object.entries(DND5E_SIZES.baseNames.dnd5e)) expect(DND5E_SIZES.byName.dnd5e[key], key).toEqual(e);
  });

  it.each([["Pole", 7], ["Pole (10-foot)", 7], ["Ladder", 25], ["Ladder (10-foot)", 25], ["Shovel", 5], ["Musket", 10], ["Javelin", 2], ["Longsword +1", 3], ["Greatsword +1", 6]])(
    "%s is not wider than 8", (name, weight) => {
      const type = /sword|musket|javelin/i.test(name) ? "weapon" : "loot";
      expect(sizeOf({ name, type, weight }).w).toBeLessThanOrEqual(8);
    });
});

describe("weight bands", () => {
  const stuff = (weight, units = "lb") => ({ name: "Zzyzx", type: "loot", weight, units });

  it("reach the rule with a real weight", () => {
    expect(explain(stuff(3)).source).toBe("weight");
  });

  it("kilograms go through dnd5e's 2.5 factor", () => {
    expect(sizeOf(stuff(4, "kg"))).toEqual(sizeOf(stuff(10, "lb")));
    expect(sizeOf(stuff(4, "kg"))).not.toEqual(sizeOf(stuff(4, "lb")));
  });

  it("grow with the weight and stay within the 8x5 body", () => {
    let last = 0;
    for (const w of [0.1, 0.5, 1, 2, 5, 10, 20, 35, 70, 150, 500, 5000]) {
      const s = sizeOf(stuff(w));
      expect(s.w * s.h, String(w)).toBeGreaterThanOrEqual(last);
      expect(s.w).toBeLessThanOrEqual(8);
      expect(s.h).toBeLessThanOrEqual(5);
      last = s.w * s.h;
    }
    expect(last).toBeGreaterThan(1);
  });

  it("weight 0 means unknown and goes to byType, never to a tiny band", () => {
    expect(explain(stuff(0))).toMatchObject({ size: size(1, 1), source: "type" });
    expect(explain({ name: "Zzyzx", type: "tool", weight: 0 }).source).toBe("type");
    const custom = mergeRegistries(DEFAULT_REGISTRY, { byType: { dnd5e: { loot: size(5, 5) } } });
    expect(explain(stuff(0), custom)).toMatchObject({ size: size(5, 5), source: "type" });
  });

  it("a subtype wins over the weight", () => {
    expect(explain({ name: "Zzyzx", type: "equipment", value: "ring", weight: 40 })).toMatchObject({ size: size(1, 1), source: "subtype" });
  });
});

describe("A6 keyword scoping", () => {
  const legacy = DEFAULT_REGISTRY.keywords.filter((k) => k.systems?.includes("CoC7"));
  const dnd = DND5E_SIZES.keywords;

  it("every built-in keyword names its systems, and none is shared", () => {
    for (const k of DEFAULT_REGISTRY.keywords) expect(k.systems, String(k.pattern)).toBeTruthy();
    for (const k of legacy) expect(k.systems, String(k.pattern)).toEqual(["CoC7", "deltagreen"]);
    for (const k of dnd) expect(k.systems, String(k.pattern)).toEqual(["dnd5e"]);
    expect(legacy.length + dnd.length).toBe(DEFAULT_REGISTRY.keywords.length);
    expect(dnd.length).toBeGreaterThan(20);
  });

  it("CoC keywords do not reach dnd5e", () => {
    expect(sizeOf({ name: "Greatsword +1", type: "weapon", value: "martialM", baseItem: "greatsword" })).toEqual(size(8, 2));
    // "Bite" is an exclusion keyword of CoC7, not of dnd5e: on dnd5e only the data decides.
    expect(explain({ name: "Bite", type: "weapon", value: "simpleM", weight: 2, actorType: "character" }).excluded).toBe(false);
    expect(sizeOf({ name: "Rifle Antigo", type: "weapon" }).w).toBeLessThanOrEqual(8);
    expect(sizeOf({ name: "Espada", type: "weapon" })).toEqual(LONGSWORD_SIZE); // CoC7 says 8x1
    expect(explain({ name: "Pipe", type: "loot" }).source).not.toBe("keyword"); // CoC7: a tobacco pipe
    expect(explain({ name: "Revolver Dourado", type: "weapon" }).size).toEqual(size(3, 2));
  });

  it("dnd5e keywords do not reach CoC7 or Delta Green", () => {
    const coc = (name, type = "item") => explainSize({ systemId: "CoC7", type, name, flags: {} }, DEFAULT_REGISTRY);
    expect(coc("Bedroll Espada Longa", "weapon").size).toEqual(size(10, 1));
    expect(coc("Spell Scroll").size).toEqual(size(2, 1));
    expect(coc("Zzyzx Wand").source).toBe("type");
    expect(explainSize({ systemId: "deltagreen", type: "gear", name: "Wand of Web", flags: {} }, DEFAULT_REGISTRY).source).toBe("type");
    expect(explainSize({ systemId: "deltagreen", type: "gear", name: "Backpack", flags: {} }, DEFAULT_REGISTRY).source).toBe("type");
  });

  it("the dnd5e extras never touch a CoC7 descriptor, even with a registry that has them", () => {
    // Each of these names or keys means something on dnd5e only: its byName, baseNames, keywords, bySubtype, bands.
    const extras = { identityNames: ["abacus", "wand of web"], hashName: "war pick", baseMatch: true, subtype: "consumable:scroll", weight: 500, noSpace: false };
    const d = { systemId: "CoC7", type: "item", name: "Zzyzx", flags: {}, ...extras };
    expect(explainSize(d, DEFAULT_REGISTRY)).toEqual({ size: size(1, 1), excluded: false, source: "type" });
    expect(explainSize({ ...d, systemId: "deltagreen", type: "gear" }, DEFAULT_REGISTRY)).toEqual({ size: size(1, 1), excluded: false, source: "type" });
  });

  it("a third-party registerSizes keyword stays global and goes first", () => {
    const reg = mergeRegistries(DEFAULT_REGISTRY, { keywords: [{ pattern: /longsword/i, size: size(5, 5) }, { pattern: /zzyzx/i, size: size(4, 4) }] });
    expect(explain({ name: "Zzyzx", type: "loot" }, reg).size).toEqual(size(4, 4));
    expect(resolveSize({ systemId: "CoC7", type: "item", name: "Zzyzx", flags: {} }, reg)).toEqual(size(4, 4));
    expect(resolveSize({ systemId: "deltagreen", type: "gear", name: "Zzyzx", flags: {} }, reg)).toEqual(size(4, 4));
  });
});

/** dnd5e's `formatIdentifier`, which is what fills `system.identifier` from the name at creation. */
const identifierOf = (name) => name.replaceAll(/(\w+)([\\|/])(\w+)/g, "$1-$3").toLowerCase().replace(/[\s-]+/g, "-").replace(/[^a-z0-9-]/g, "");
/** What Plutonium writes: `encodeURIComponent(lowercase name)_source`. */
const hashOf = (name) => `${encodeURIComponent(name.toLowerCase())}_xphb`;
const withIdentifier = (spec, name) => ({ ...spec, name, identifier: identifierOf(spec.name) });
const withHash = (spec, name) => ({ ...spec, name, page: "items.html", hash: hashOf(spec.name) });

describe("M1: a renamed item keeps its size", () => {
  // Every shape the review's rename run broke: keyword-sized, and table names with punctuation.
  const RENAMES = [
    ["Cloak of Protection", { type: "equipment", value: "clothing", weight: 3 }],
    ["Boots of Speed", { type: "equipment", value: "clothing", weight: 1 }],
    ["Bracers of Archery", { type: "equipment", value: "clothing", weight: 1 }],
    ["Helm of Telepathy", { type: "equipment", value: "clothing", weight: 2 }],
    ["Belt of Dwarvenkind", { type: "equipment", value: "wondrous", weight: 1 }],
    ["Staff of Fire", { type: "weapon", value: "simpleM", weight: 4 }],
    ["Vorpal Sword", { type: "weapon", value: "" }],
    ["Dancing Sword", { type: "weapon", value: "martialM" }],
    ["Berserker Axe", { type: "weapon", value: "martialM" }],
    ["Flame Tongue", { type: "weapon", value: "" }],
    ["Oathbow", { type: "weapon", value: "" }],
    ["Climber's Kit", { type: "consumable", value: "trinket", weight: 12 }],
    ["Explorer's Pack", { type: "container", weight: 5 }],
    ["Diplomat's Pack", { type: "container", weight: 25 }],
    ["Bag of Holding", { type: "container", weight: 15 }],
    ["Map or Scroll Case", { type: "container", weight: 1 }],
    ["Ladder (10-foot)", { type: "loot", value: "", weight: 25 }],
    ["Hempen Rope (50 ft.)", { type: "consumable", value: "trinket", weight: 10 }],
    ["Lantern, Hooded", { type: "equipment", value: "trinket", weight: 2 }],
    ["Ram, Portable", { type: "loot", value: "gear", weight: 35 }],
    ["Pot, Iron", { type: "container", weight: 10 }],
    ["Thieves' Tools", { type: "tool", value: "", weight: 1 }],
    ["Cook's Utensils", { type: "tool", value: "art", weight: 8 }],
    ["Alchemist's Fire", { type: "consumable", value: "potion", weight: 1 }],
    ["Potion of Healing", { type: "consumable", value: "potion", weight: 0.1 }],
    ["Spell Scroll, 1st Level", { type: "consumable", value: "scroll" }],
    ["Wand of Fireballs", { type: "equipment", value: "wand", weight: 1 }],
    ["Ring of Protection", { type: "equipment", value: "ring" }],
    ["Amulet of Health", { type: "equipment", value: "wondrous", weight: 1 }],
    ["Carpet of Flying", { type: "equipment", value: "wondrous", weight: 5 }],
    ["Crystal Ball", { type: "equipment", value: "wondrous", weight: 7 }],
    ["Rope", { type: "consumable", value: "trinket", weight: 5 }],
    ["Crowbar", { type: "loot", value: "gear", weight: 5 }],
    ["Mess Kit", { type: "loot", value: "", weight: 1 }],
    ["Fine Clothes", { type: "equipment", value: "clothing", weight: 6 }],
    ["Book of Lore", { type: "loot", value: "", weight: 5 }],
    ["Arrows", { type: "consumable", value: "ammo", subtype: "arrow", weight: 0.05 }],
    ["Bullets, Sling", { type: "consumable", value: "ammo", subtype: "slingBullet", weight: 0.075 }],
    ["Plate Armor of Etherealness", { type: "equipment", value: "" }],
    ["Mithral Armor", { type: "equipment", value: "" }],
    ["Efreeti Chain", { type: "equipment", value: "" }],
    ["Cow", { type: "loot", value: "trade", weight: 1400 }]
  ];
  // Visible names that would fire a keyword of their own: the size must not listen to them.
  const VISIBLE = ["Zzyzx", "Presente da Rainha", "Anel da Rainha", "Espada Longa"];

  describe.each(RENAMES)("%s", (name, spec) => {
    const original = sizeOf({ name, ...spec });

    it.each(VISIBLE)("renamed %s, through its identifier", (visible) => {
      expect(sizeOf(withIdentifier({ name, ...spec }, visible))).toEqual(original);
    });

    it.each(VISIBLE)("renamed %s, through a Plutonium hash", (visible) => {
      expect(sizeOf(withHash({ name, ...spec }, visible))).toEqual(original);
    });
  });

  it("the identifier reaches table keys with punctuation, by slug", () => {
    expect(explain({ name: "Zzyzx", type: "container", identifier: "explorers-pack" })).toMatchObject({ size: size(4, 4), source: "identity" });
    expect(explain({ name: "Zzyzx", type: "loot", identifier: "ladder-10-foot" })).toMatchObject({ size: size(8, 2), source: "identity" });
    expect(explain({ name: "Zzyzx", type: "tool", identifier: "thieves-tools" })).toMatchObject({ size: size(2, 1), source: "identity" });
  });

  it("identity beats the visible name among keywords; an unknown identifier leaves the name to decide", () => {
    expect(explain({ name: "Anel da Rainha", type: "equipment", value: "clothing", identifier: "cloak-of-protection" })).toMatchObject({ size: size(3, 2), source: "keyword" });
    expect(explain({ name: "Anel da Rainha", type: "equipment", value: "clothing", identifier: "zzyzx" })).toMatchObject({ size: size(1, 1), source: "keyword" });
    expect(explain({ name: "Anel da Rainha", type: "equipment", value: "clothing" })).toMatchObject({ size: size(1, 1), source: "keyword" });
  });

  it("a spell scroll's hash still names its spell, even for keywords", () => {
    const scroll = { type: "consumable", value: "scroll", page: "spells.html" };
    expect(sizeOf({ name: "Zzyzx", ...scroll, hash: "fire%20shield_xphb" })).toEqual(size(2, 1));
    expect(sizeOf({ name: "Zzyzx", type: "loot", page: "spells.html", hash: "ring%20of%20fire_xphb" })).toEqual(size(1, 1));
    expect(explain({ name: "Zzyzx", type: "loot", page: "spells.html", hash: "ring%20of%20fire_xphb" }).source).toBe("type");
  });

  it("CoC7 and Delta Green descriptors have no identity, so their keywords still read only the name", () => {
    const d = { systemId: "CoC7", type: "item", name: "Zzyzx", flags: {} };
    expect(explainSize({ ...d, identityNames: ["rope"] }, { physicalTypes: { CoC7: ["item"] }, keywords: [{ pattern: /rope/, size: size(5, 5) }] }).size).toEqual(size(5, 5));
    expect(explainSize(d, { physicalTypes: { CoC7: ["item"] }, keywords: [{ pattern: /rope/, size: size(5, 5) }] }).size).toEqual(size(1, 1));
  });
});

describe("M2: nameOverrides, a third party's byName", () => {
  const w = (n) => size(n, 1);
  const reg = {
    physicalTypes: { dnd5e: ["weapon"] },
    byId: { dnd5e: { "src-id": w(3) } },
    nameOverrides: { dnd5e: { "Flame Tongue": w(4) } },
    byName: { dnd5e: { longsword: w(5), "flame tongue": w(6) } }
  };
  const d = { type: "weapon", name: "Flame Tongue", systemId: "dnd5e", flags: {}, identityNames: ["longsword"] };

  it("runs after byId and before identity names", () => {
    expect(explainSize({ ...d, sourceId: "src-id" }, reg)).toMatchObject({ size: w(3), source: "id" });
    expect(explainSize(d, reg)).toMatchObject({ size: w(4), source: "name" });
    expect(explainSize({ ...d, name: "Zzyzx" }, reg)).toMatchObject({ size: w(5), source: "identity" });
  });

  it("is honest with noSpace, and an excluded entry obeys the GM", () => {
    expect(explainSize({ ...d, noSpace: true }, reg).source).toBe("noSpace");
    const r = { ...reg, nameOverrides: { dnd5e: { "flame tongue": "excluded" } } };
    expect(explainSize(d, r)).toMatchObject({ size: null, excluded: true, source: "name" });
    expect(explainSize({ ...d, flags: { excluded: false } }, r)).toMatchObject({ size: w(5), source: "identity" });
  });

  it("the built-in registry has none, so A5's order stands for built-ins", () => {
    expect(DEFAULT_REGISTRY.nameOverrides).toBeUndefined();
    expect(explain({ name: "Flame Tongue", type: "weapon", value: "martialM", baseItem: "longsword" }).source).toBe("identity");
  });
});

describe("S1: a trinket's weight decides", () => {
  it("has no equipment:trinket key", () => {
    expect(DND5E_SIZES.bySubtype.dnd5e["equipment:trinket"]).toBeUndefined();
  });

  it("a heavy trinket is sized by weight, as a wondrous item is; weightless stays 1x1", () => {
    expect(explain({ name: "Zzyzx", type: "equipment", value: "trinket", weight: 300 })).toMatchObject({ size: size(8, 5), source: "weight" });
    expect(explain({ name: "Zzyzx", type: "equipment", value: "trinket", weight: 40 }).size).toEqual(sizeOf({ name: "Zzyzx", type: "equipment", value: "wondrous", weight: 40 }));
    expect(explain({ name: "Zzyzx", type: "equipment", value: "trinket" })).toMatchObject({ size: size(1, 1), source: "type" });
    expect(sizeOf({ name: "Reliquary", type: "equipment", value: "trinket", weight: 2 })).toEqual(size(2, 1));
  });
});

describe("S2: the head noun beats what the item holds", () => {
  const LOOT = { type: "loot" };
  const HEADS = [
    ["Belt of Giant Strength (stone)", { type: "equipment", value: "wondrous" }, size(2, 1)],
    ["Keg of Alchemist's Fire", LOOT, size(4, 3)],
    ["Carved harp of exotic wood with ivory inlay and zircon gems", { type: "loot", value: "art" }, size(5, 2)],
    ["Lute crafted from rare wood with mother-of-pearl inlay", { type: "loot", value: "art" }, size(5, 2)],
    ["Ceremonial gold armor with black pearls", { type: "loot", value: "art" }, size(4, 4)],
    ["Cartographer's Map Case", LOOT, size(3, 1)],
    ["Chest of Gems", LOOT, size(6, 4)],
    ["Barrel of Oil", LOOT, size(5, 5)],
    ["Sack of Coins", LOOT, size(3, 2)],
    ["Rope of Pearls", LOOT, size(2, 2)],
    ["Book of Maps", LOOT, size(2, 2)],
    ["Baú de Gemas", LOOT, size(6, 4)],
    ["Barril de Óleo", LOOT, size(5, 5)],
    ["Saco de Moedas", LOOT, size(3, 2)],
    ["Saco Velho de Moedas", LOOT, size(3, 2)],
    ["Corda de Pérolas", LOOT, size(2, 2)],
    ["Livro de Mapas", LOOT, size(2, 2)],
    ["Livro sobre a grande arvore", LOOT, size(2, 2)],
    ["Cinto de Pedra", { type: "equipment", value: "wondrous" }, size(2, 1)],
    ["Bolsa de Moedas", LOOT, size(2, 2)]
  ];

  it.each(HEADS)("%s", (name, spec, expected) => {
    expect(explain({ name, ...spec })).toMatchObject({ size: expected, source: "keyword" });
  });

  it.each([
    ["Pearl of Power", SMALL_ITEM()],
    ["Ring of Pearls", SMALL_ITEM()],
    ["Necklace of Gems", SMALL_ITEM()],
    ["Key to the Chest", SMALL_ITEM()],
    ["Map of the Barrel Cave", SMALL_ITEM()],
    ["Ring of the Book", SMALL_ITEM()],
    ["Shield Guardian Amulet", SMALL_ITEM()],
    ["Barrel Key", SMALL_ITEM()]
  ])("%s stays small: the noun must head the name", (name, spec) => {
    expect(sizeOf({ name, ...spec })).toEqual(size(1, 1));
  });

  function SMALL_ITEM() {
    return { type: "loot" };
  }
});

describe("nits", () => {
  it("a bedroll in Portuguese is a bedroll, not a sack", () => {
    expect(sizeOf({ name: "Saco de Dormir", type: "loot" })).toEqual(size(4, 2));
  });

  it("the mount keyword wants the animal or vehicle itself", () => {
    for (const name of ["Riding Horse", "Warhorse", "Pack Mule", "Sailing Ship", "Wagon", "Cavalo de Guerra", "Donkey (or Mule)", "Rowboat"]) {
      expect(sizeOf({ name, type: "loot" }), name).toEqual(size(8, 5));
    }
    for (const name of ["Wagon Wheel", "Horse Feed", "Toy Horse", "Ship in a Bottle", "Carved Horse"]) {
      expect(sizeOf({ name, type: "loot" }).w, name).toBeLessThan(8);
    }
  });

  it("Lock Pick is small, whatever its type", () => {
    for (const type of ["tool", "loot", "equipment"]) expect(sizeOf({ name: "Lock Pick", type }), type).toEqual(size(1, 1));
    expect(sizeOf({ name: "Gazua", type: "tool" })).toEqual(size(1, 1));
    expect(sizeOf({ name: "Miner's Pick", type: "tool" })).toEqual(size(6, 2));
    expect(sizeOf({ name: "Old Pick", type: "tool" })).toEqual(size(6, 2));
  });

  it.each([
    ["Cota de Escamas", { type: "equipment" }, size(4, 4)],
    ["Couro", { type: "equipment" }, size(4, 3)],
    ["Placas", { type: "equipment" }, size(4, 5)],
    ["Estrela da Manhã", { type: "weapon" }, size(4, 2)],
    ["Pacote de Explorador", { type: "loot" }, size(4, 4)],
    ["Clava Grande", { type: "weapon" }, size(6, 2)],
    ["Martelo Leve", { type: "weapon" }, size(2, 1)]
  ])("Portuguese: %s", (name, spec, expected) => {
    expect(sizeOf({ name, ...spec })).toEqual(expected);
  });

  it("Luvas de Couro are gloves, not leather armor", () => {
    expect(sizeOf({ name: "Luvas de Couro", type: "equipment" })).toEqual(size(2, 1));
  });
});

/*
 * Computed once from the committed HEAD c84fc13, before any M3 change, over every byId entry, every
 * byName key, the samples of default-sizes.test.mjs, Portuguese and fantasy names and all names of
 * dnd5e's compendiums. Results keep the size and the rule, so a CoC7 or Delta Green item resolved by
 * another rule fails here even when it lands on the same size.
 */
describe("CoC7 and Delta Green snapshot", () => {
  const snap = JSON.parse(readFileSync(new URL("./fixtures/coc-dg-sizes-snapshot.json", import.meta.url), "utf8"));
  const enc = (r) => `${r.size ? `${r.size.w}x${r.size.h}` : r.excluded ? "excluded" : "none"}:${r.source}`;

  it("really holds a large list", () => {
    expect(Object.keys(snap.results).length).toBeGreaterThan(1000);
    expect(snap.order).toHaveLength(8);
  });

  it("no name resolves differently", () => {
    const diff = [];
    for (const [name, row] of Object.entries(snap.results)) {
      const now = snap.order.map((key) => {
        const [systemId, type] = key.split(".");
        return enc(explainSize({ systemId, type, name, flags: {} }, DEFAULT_REGISTRY));
      }).join("|");
      if (now !== row) diff.push(`${name}: ${row} -> ${now}`);
    }
    expect(diff).toEqual([]);
  });

  it("no id resolves differently", () => {
    for (const [systemId, ids] of Object.entries(snap.byId)) {
      for (const [id, expected] of Object.entries(ids)) {
        const d = systemId === "CoC7" ? { coreId: id } : { sourceId: id };
        expect(enc(explainSize({ systemId, type: "weapon", name: "Nome traduzido", flags: {}, ...d }, DEFAULT_REGISTRY)), id).toBe(expected);
      }
    }
  });
});

/*
 * `.llm/` is gitignored, so CI has no CSV: the block skips with a message there. Each row becomes an
 * item the way the pack holds it. The CSV lacks properties, flags and the owning actor, so the npc
 * and Plutonium rules are not exercised here.
 */
const CSV = new URL("../../.llm/dnd5e-items.csv", import.meta.url);
const HAS_CSV = existsSync(CSV);
if (!HAS_CSV) console.warn("[dnd5e-sizes] SKIPPED: .llm/dnd5e-items.csv is absent (it is gitignored, so this is normal in CI).");

function parseCsv(text) {
  const rows = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const cells = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [head, ...body] = rows;
  return body.map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i]])));
}

describe.skipIf(!HAS_CSV)("the whole of dnd5e's compendiums", () => {
  const rows = HAS_CSV ? parseCsv(readFileSync(CSV, "utf8")) : [];
  const results = rows.map((row) => ({
    row,
    r: explain({ name: row.name, type: row.type, value: row.typeValue, subtype: row.subtype, baseItem: row.baseItem, weight: Number(row.weightLb) || 0 })
  }));
  const isLong = (row) => ["pike", "lance"].includes(row.baseItem) || /\b(pike|lance)\b/i.test(row.name);

  it("runs 1530 rows and prints the rule counts", () => {
    expect(rows).toHaveLength(1530);
    const counts = {};
    for (const { r } of results) counts[r.source] = (counts[r.source] ?? 0) + 1;
    console.log(`[dnd5e-sizes] rule counts over ${rows.length} rows:\n${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k.padEnd(10)} ${String(n).padStart(5)}`).join("\n")}`);
    expect(counts.fallback ?? 0).toBe(0);
    expect(counts.nonPhysical ?? 0).toBe(0);
    for (const rule of ["identity", "name", "keyword", "subtype", "weight", "type", "noSpace"]) expect(counts[rule] ?? 0, rule).toBeGreaterThan(0);
  });

  const specOf = (row) => ({ name: row.name, type: row.type, value: row.typeValue, subtype: row.subtype, baseItem: row.baseItem, weight: Number(row.weightLb) || 0 });
  const moves = (from, to) => results.flatMap(({ row }) => {
    const [a, b] = [from(row), to(row)];
    return JSON.stringify(a.size) === JSON.stringify(b.size) ? [] : [`${row.pack} ${row.name}: ${a.source} ${JSON.stringify(a.size)} -> ${b.source} ${JSON.stringify(b.size)}`];
  });

  it("renamed to Zzyzx through the identifier: no row changes size, measured against the same row with neither", () => {
    expect(moves((row) => explain(specOf(row)), (row) => explain(withIdentifier(specOf(row), "Zzyzx")))).toEqual([]);
  });

  it("renamed to Zzyzx through a Plutonium hash: no row changes size", () => {
    expect(moves((row) => explain(withHash(specOf(row), row.name)), (row) => explain(withHash(specOf(row), "Zzyzx")))).toEqual([]);
  });

  it("a hash and the pack's own base item agree, but for 2 rows where dnd5e's base item is not the item", () => {
    // The hash names the item and is tried first. `items` gives Elven Chain the base `chainshirt` and Pan Flute `flute`.
    expect(moves((row) => explain(specOf(row)), (row) => explain(withHash(specOf(row), row.name)))).toEqual([
      'items Elven Chain: identity {"w":4,"h":3} -> identity {"w":4,"h":4}',
      'items Pan Flute: identity {"w":3,"h":1} -> identity {"w":2,"h":1}'
    ]);
  });

  it("only attacks take no space", () => {
    const none = results.filter(({ r }) => !r.size).map(({ row }) => row.name);
    expect([...new Set(none)].sort()).toEqual(["Unarmed Strike"]);
    expect(results.find(({ row }) => row.name === "Clawed Gauntlet").r.size).toBeTruthy();
  });

  it("nothing is wider than 8 or fails an empty 8x5, outside the named exceptions", () => {
    const fits = ({ w, h }) => (w <= 8 && h <= 5) || (h <= 8 && w <= 5);
    const bad = results.filter(({ row, r }) => r.size && !isLong(row) && (r.size.w > 8 || !fits(r.size)));
    expect(bad.map(({ row, r }) => `${row.name} ${r.size.w}x${r.size.h} ${r.source}`)).toEqual([]);
    expect(results.filter(({ row, r }) => isLong(row) && r.size.w !== 10).map(({ row }) => row.name)).toEqual([]);
  });

  it("everything with a base item resolves through it", () => {
    const stray = results.filter(({ row, r }) => row.baseItem && r.source !== "identity");
    expect(stray.map(({ row, r }) => `${row.name} (${row.baseItem}) ${r.source}`)).toEqual([]);
  });

  it("a variant has the size of its base", () => {
    const variants = [["Longsword", "Longsword +1"], ["Longsword", "Frost Brand Longsword"], ["Dagger", "Dagger of Venom"], ["Plate Armor", "Plate Armor +1"], ["Shield", "Shield +1"]];
    for (const [base, variant] of variants) {
      const of = (n) => results.find(({ row }) => row.name === n)?.r.size;
      expect(of(variant), `${variant} is in the CSV`).toBeTruthy();
      expect(of(variant), variant).toEqual(of(base));
    }
  });

  it("common items a player would notice have their hand-set size", () => {
    const expected = {
      "Backpack": size(4, 4), "Rope": size(2, 2), "Potion of Healing": size(1, 1), "Torch": size(3, 1), "Crowbar": size(4, 1), "Bedroll": size(4, 2),
      "Pole": size(8, 1), "Ladder": size(8, 2), "Shovel": size(5, 2), "Tent": size(4, 3), "Rations": size(1, 1), "Tinderbox": size(1, 1),
      "Arrows": size(2, 1), "Bolts": size(2, 1), "Needles": size(1, 1), "Thieves' Tools": size(2, 1), "Spellbook": size(2, 2), "Waterskin": size(2, 2),
      "Vial": size(1, 1), "Chest": size(6, 4), "Barrel": size(5, 5), "Component Pouch": size(2, 1)
    };
    for (const [name, s] of Object.entries(expected)) {
      const hits = results.filter(({ row }) => row.name === name);
      expect(hits.length, name).toBeGreaterThan(0);
      for (const { r } of hits) expect(r.size, name).toEqual(s);
    }
  });

  it("the whole family of a magic bag agrees, whatever weight its row states", () => {
    for (const name of ["Bag of Beans", "Bag of Sand", "Gray Bag of Tricks", "Rust Bag of Tricks", "Tan Bag of Tricks", "Bag of Tricks (Grey)", "Bag of Tricks (Rust)", "Bag of Tricks (Tan)"]) {
      const hits = results.filter(({ row }) => row.name === name);
      expect(hits.length, name).toBeGreaterThan(0);
      for (const { r } of hits) expect(r.size, name).toEqual(size(2, 2));
    }
    for (const name of ["Belt of Giant Strength (stone)", "Belt of Stone Giant Strength", "Belt of Hill Giant Strength"]) {
      for (const { r } of results.filter(({ row }) => row.name === name)) expect(r.size, name).toEqual(size(2, 1));
    }
  });

  it("sword-named magic weapons with no base item are swords, not 1x1", () => {
    for (const name of ["Vorpal Sword", "Flame Tongue", "Frost Brand", "Holy Avenger", "Dragon Slayer", "Giant Slayer", "Luck Blade", "Nine Lives Stealer", "Defender", "Dancing Sword", "Sword of Wounding"]) {
      expect(results.find(({ row }) => row.name === name).r.size, name).toEqual(LONGSWORD_SIZE);
    }
    expect(results.find(({ row }) => row.name === "Oathbow").r.size).toEqual(size(8, 2));
  });
});
