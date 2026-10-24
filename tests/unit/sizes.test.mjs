import { describe, expect, it } from "vitest";
import {
  EXCLUDED, explainSize, isContainer, isPhysical, mergeRegistries, normalizeName,
  resolveSize, sanitizeContainer, sanitizeSize
} from "../../scripts/core/sizes.mjs";

const registry = {
  physicalTypes: { CoC7: ["weapon", "armor", "book", "item"], deltagreen: ["weapon", "gear"] },
  byId: {
    CoC7: { "i.weapon.45-revolver": { w: 3, h: 2 }, "i.weapon.brawl": EXCLUDED, "Compendium.CoC7.items.Item.abc": { w: 5, h: 5 } },
    deltagreen: { JQEMyFfCHx38gupS: EXCLUDED, "Compendium.deltagreen.firearms.Item.rifle1": { w: 8, h: 2 } }
  },
  byName: {
    CoC7: { ".45 Revolver": { w: 4, h: 4 }, "Shotgun (12-gauge)": { w: 7, h: 2 }, "Café Grinder": { w: 2, h: 3 } },
    "*": { "Crowbar": { w: 1, h: 4 } }
  },
  keywords: [
    { systems: ["CoC7"], types: ["weapon"], pattern: /rifle/i, size: { w: 6, h: 2 } },
    { pattern: /knife|dagger/i, size: { w: 1, h: 2 } },
    { types: ["gear"], pattern: "flashlight", size: { w: 1, h: 3 } },
    { pattern: /unarmed/i, size: EXCLUDED },
    { pattern: /book/i, size: { w: 2, h: 2 } }
  ],
  byType: { CoC7: { weapon: { w: 2, h: 1 }, book: { w: 2, h: 3 } }, "*": { gear: { w: 1, h: 1 } } }
};

const coc = (name, type = "item", extra = {}) => ({ type, name, systemId: "CoC7", flags: {}, ...extra });
const dg = (name, type = "gear", extra = {}) => ({ type, name, systemId: "deltagreen", flags: {}, ...extra });

describe("sanitizeSize", () => {
  it("accepts objects, arrays and WxH strings", () => {
    expect(sanitizeSize({ w: 3, h: 4 })).toEqual({ w: 3, h: 4 });
    expect(sanitizeSize({ w: "3", h: "4" })).toEqual({ w: 3, h: 4 });
    expect(sanitizeSize([2, 5])).toEqual({ w: 2, h: 5 });
    expect(sanitizeSize("3x6")).toEqual({ w: 3, h: 6 });
    expect(sanitizeSize(" 3 X 6 ")).toEqual({ w: 3, h: 6 });
  });
  it("rounds and clamps to [1, 32]", () => {
    expect(sanitizeSize({ w: 2.6, h: 1.2 })).toEqual({ w: 3, h: 1 });
    expect(sanitizeSize({ w: 0, h: -4 })).toEqual({ w: 1, h: 1 });
    expect(sanitizeSize({ w: 100, h: 33 })).toEqual({ w: 32, h: 32 });
  });
  it("rejects garbage", () => {
    for (const v of [null, undefined, 3, true, "big", "3x", {}, { w: 1 }, { w: NaN, h: 1 },
      { w: Infinity, h: 1 }, { w: "a", h: 1 }, { w: "", h: 1 }, { w: true, h: 1 }, []]) {
      expect(sanitizeSize(v)).toBe(null);
    }
  });
});

describe("sanitizeContainer", () => {
  it("clamps to [1, 32] by default and [0, 32] for bodies", () => {
    expect(sanitizeContainer({ cols: 8, rows: 6 })).toEqual({ cols: 8, rows: 6 });
    expect(sanitizeContainer({ cols: 0, rows: 99 })).toEqual({ cols: 1, rows: 32 });
    expect(sanitizeContainer({ cols: 0, rows: 0 }, { min: 0 })).toEqual({ cols: 0, rows: 0 });
  });
  it("rejects garbage", () => {
    expect(sanitizeContainer(null)).toBe(null);
    expect(sanitizeContainer(true)).toBe(null);
    expect(sanitizeContainer({ cols: 3 })).toBe(null);
  });
});

describe("normalizeName", () => {
  it("lowercases, strips accents and collapses whitespace", () => {
    expect(normalizeName("  Revólver   Calibre .38 ")).toBe("revolver calibre .38");
    expect(normalizeName("ÇAFÉ")).toBe("cafe");
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("isPhysical / isContainer", () => {
  it("uses the per-system type lists", () => {
    expect(isPhysical(coc("x", "weapon"), registry)).toBe(true);
    expect(isPhysical(coc("x", "skill"), registry)).toBe(false);
    expect(isPhysical(dg("x", "gear"), registry)).toBe(true);
    expect(isPhysical(dg("x", "armor"), registry)).toBe(false);
  });
  it("treats unknown systems and garbage as non-physical", () => {
    expect(isPhysical({ type: "item", name: "x", systemId: "dnd5e" }, registry)).toBe(false);
    expect(isPhysical(null, registry)).toBe(false);
    expect(isPhysical(coc("x", "item"), null)).toBe(false);
  });
  it("supports a '*' type list", () => {
    expect(isPhysical({ type: "loot", systemId: "any" }, { physicalTypes: { "*": ["loot"] } })).toBe(true);
  });
  it("detects container flags", () => {
    expect(isContainer(coc("Backpack", "item", { flags: { container: { cols: 6, rows: 4 } } }))).toBe(true);
    expect(isContainer(coc("Backpack", "item", { flags: { container: "yes" } }))).toBe(false);
    expect(isContainer(coc("Backpack"))).toBe(false);
  });
});

describe("resolveSize precedence", () => {
  it("returns null for non-physical types even with a size flag", () => {
    expect(resolveSize(coc("Spot Hidden", "skill", { flags: { size: { w: 2, h: 2 } } }), registry)).toBe(null);
  });

  it("returns null for container items", () => {
    const d = coc("Backpack", "item", { flags: { container: { cols: 6, rows: 4 }, size: { w: 3, h: 3 } } });
    expect(resolveSize(d, registry)).toBe(null);
    expect(explainSize(d, registry)).toEqual({ size: null, excluded: false, source: "container" });
  });

  it("flags.excluded beats everything else", () => {
    const d = coc(".45 Revolver", "weapon", { coreId: "i.weapon.45-revolver", flags: { excluded: true, size: { w: 2, h: 2 } } });
    expect(resolveSize(d, registry)).toBe(null);
    expect(explainSize(d, registry)).toEqual({ size: null, excluded: true, source: "flag" });
  });

  it("flags.size beats the registry", () => {
    const d = coc(".45 Revolver", "weapon", { coreId: "i.weapon.45-revolver", flags: { size: { w: 3, h: 4 } } });
    expect(explainSize(d, registry)).toEqual({ size: { w: 3, h: 4 }, excluded: false, source: "flag" });
  });

  it("byId(coreId) beats byId(sourceId) and byName", () => {
    const d = coc(".45 Revolver", "weapon", { coreId: "i.weapon.45-revolver", sourceId: "Compendium.CoC7.items.Item.abc" });
    expect(explainSize(d, registry)).toMatchObject({ size: { w: 3, h: 2 }, source: "id" });
  });

  it("byId(sourceId) beats byName", () => {
    const d = coc(".45 Revolver", "weapon", { coreId: "i.weapon.unknown", sourceId: "Compendium.CoC7.items.Item.abc" });
    expect(explainSize(d, registry)).toMatchObject({ size: { w: 5, h: 5 }, source: "id" });
  });

  it("matches the bare document id of a compendium UUID", () => {
    const d = dg("Unarmed Attack", "weapon", { sourceId: "Compendium.deltagreen.hand-to-hand-weapons.Item.JQEMyFfCHx38gupS" });
    expect(explainSize(d, registry)).toEqual({ size: null, excluded: true, source: "id" });
    expect(resolveSize(dg("Rifle", "weapon", { sourceId: "Compendium.deltagreen.firearms.Item.rifle1" }), registry))
      .toEqual({ w: 8, h: 2 });
  });

  it("byName is case/accent/whitespace insensitive and beats keywords", () => {
    expect(explainSize(coc("  .45   REVOLVER ", "weapon"), registry)).toMatchObject({ size: { w: 4, h: 4 }, source: "name" });
    expect(resolveSize(coc("cafe grinder"), registry)).toEqual({ w: 2, h: 3 });
    expect(resolveSize(coc("Shotgun (12-gauge)", "weapon"), registry)).toEqual({ w: 7, h: 2 });
  });

  it("byName falls back to the '*' table", () => {
    expect(resolveSize(coc("crowbar"), registry)).toEqual({ w: 1, h: 4 });
    expect(resolveSize(dg("Crowbar"), registry)).toEqual({ w: 1, h: 4 });
  });

  it("uses the first matching keyword in order, honoring systems and types filters", () => {
    expect(explainSize(coc("Hunting Rifle", "weapon"), registry)).toMatchObject({ size: { w: 6, h: 2 }, source: "keyword" });
    // CoC7-only weapon keyword does not apply to DG, nor to non-weapon types
    expect(resolveSize(dg("Hunting Rifle", "weapon"), registry)).toEqual({ w: 1, h: 1 });
    expect(resolveSize(coc("Rifle Scope", "item"), registry)).toEqual({ w: 1, h: 1 });
    expect(resolveSize(dg("Combat Knife", "weapon"), registry)).toEqual({ w: 1, h: 2 });
    // string pattern compiled case-insensitively; types filter applies
    expect(resolveSize(dg("Heavy FLASHLIGHT"), registry)).toEqual({ w: 1, h: 3 });
    expect(resolveSize(dg("Flashlight", "weapon"), registry)).toEqual({ w: 1, h: 1 });
    // knife matches before book
    expect(resolveSize(coc("Book Knife"), registry)).toEqual({ w: 1, h: 2 });
  });

  it("keywords can match accented names through normalization", () => {
    const reg = { physicalTypes: { CoC7: ["item"] }, keywords: [{ pattern: /lampiao/, size: { w: 2, h: 2 } }] };
    expect(resolveSize(coc("Lampião"), reg)).toEqual({ w: 2, h: 2 });
  });

  it("keywords can exclude", () => {
    expect(explainSize(coc("Unarmed Strike", "weapon"), registry)).toEqual({ size: null, excluded: true, source: "keyword" });
  });

  it("falls back to byType, then to 1x1", () => {
    expect(explainSize(coc("Derringer", "weapon"), registry)).toMatchObject({ size: { w: 2, h: 1 }, source: "type" });
    expect(resolveSize(coc("Necronomicon", "book"), registry)).toEqual({ w: 2, h: 3 });
    expect(resolveSize(dg("Rope"), registry)).toEqual({ w: 1, h: 1 }); // "*" byType
    expect(explainSize(coc("Pocket Watch", "armor"), registry)).toEqual({ size: { w: 1, h: 1 }, excluded: false, source: "fallback" });
  });

  it("explicit flags.excluded === false skips registry exclusions", () => {
    const d = coc("Unarmed", "weapon", { coreId: "i.weapon.brawl", flags: { excluded: false } });
    expect(resolveSize({ ...d, flags: {} }, registry)).toBe(null);
    // brawl id excluded is skipped; "unarmed" keyword excluded is skipped; byType weapon applies
    expect(explainSize(d, registry)).toMatchObject({ size: { w: 2, h: 1 }, source: "type" });
  });

  it("works with an empty or missing registry", () => {
    const reg = { physicalTypes: { CoC7: ["item"] } };
    expect(resolveSize(coc("Thing"), reg)).toEqual({ w: 1, h: 1 });
    expect(resolveSize(coc("Thing"), undefined)).toBe(null);
  });

  it("returns a fresh object each time", () => {
    const a = resolveSize(coc("Derringer", "weapon"), registry);
    a.w = 99;
    expect(resolveSize(coc("Derringer", "weapon"), registry)).toEqual({ w: 2, h: 1 });
  });
});

describe("resolveSize sanitization", () => {
  it("clamps flag sizes and falls through on garbage flags", () => {
    expect(resolveSize(coc("x", "weapon", { flags: { size: { w: 50, h: 0 } } }), registry)).toEqual({ w: 32, h: 1 });
    expect(explainSize(coc("Derringer", "weapon", { flags: { size: "nonsense" } }), registry))
      .toMatchObject({ size: { w: 2, h: 1 }, source: "type" });
    expect(resolveSize(coc("Derringer", "weapon", { flags: null }), registry)).toEqual({ w: 2, h: 1 });
  });

  it("ignores malformed registry entries and falls through to the next level", () => {
    const reg = {
      physicalTypes: { CoC7: ["item"] },
      byId: { CoC7: { a: "broken", b: { w: 2.4, h: 40 } } },
      byName: { CoC7: { lamp: null } },
      keywords: [{ pattern: /lamp/, size: { w: "x", h: 1 } }, { pattern: null, size: { w: 1, h: 1 } }, "junk",
        { pattern: "[unclosed", size: { w: 1, h: 1 } }, { pattern: /lamp/, size: "2x2" }],
      byType: { CoC7: { item: "garbage" } }
    };
    expect(resolveSize(coc("Lamp", "item", { coreId: "a" }), reg)).toEqual({ w: 2, h: 2 });
    expect(resolveSize(coc("Other", "item", { coreId: "b" }), reg)).toEqual({ w: 2, h: 32 });
    expect(explainSize(coc("Other"), reg).source).toBe("fallback");
  });

  it("is not confused by global regexes", () => {
    const reg = { physicalTypes: { CoC7: ["item"] }, keywords: [{ pattern: /rope/g, size: { w: 1, h: 3 } }] };
    for (let i = 0; i < 4; i++) expect(resolveSize(coc("rope"), reg)).toEqual({ w: 1, h: 3 });
  });
});

describe("mergeRegistries", () => {
  const base = {
    physicalTypes: { CoC7: ["weapon", "item"] },
    byName: { CoC7: { Knife: { w: 1, h: 2 } } },
    byId: { CoC7: { x: { w: 1, h: 1 } } },
    keywords: [{ pattern: /lamp/i, size: { w: 1, h: 1 } }],
    byType: { CoC7: { item: { w: 1, h: 1 } } }
  };
  const addon = {
    physicalTypes: { CoC7: ["item", "book"], dnd5e: ["loot"] },
    byName: { CoC7: { knife: { w: 2, h: 2 } } },
    keywords: [{ pattern: /lamp/i, size: { w: 3, h: 3 } }],
    byType: { dnd5e: { loot: { w: 1, h: 2 } } }
  };

  it("unions physical types and lets later tables win", () => {
    const m = mergeRegistries(base, addon);
    expect(m.physicalTypes.CoC7).toEqual(["weapon", "item", "book"]);
    expect(m.physicalTypes.dnd5e).toEqual(["loot"]);
    expect(resolveSize(coc("KNIFE"), m)).toEqual({ w: 2, h: 2 });
    expect(resolveSize(coc("Desk Lamp"), m)).toEqual({ w: 3, h: 3 });
    expect(resolveSize(coc("Foo", "item", { coreId: "x" }), m)).toEqual({ w: 1, h: 1 });
    expect(resolveSize({ type: "loot", name: "Gem", systemId: "dnd5e", flags: {} }, m)).toEqual({ w: 1, h: 2 });
  });

  it("does not modify its inputs and skips nullish", () => {
    const snapshot = JSON.stringify([base, addon]);
    const m = mergeRegistries(null, base, undefined, addon);
    expect(JSON.stringify([base, addon])).toBe(snapshot);
    m.physicalTypes.CoC7.push("hack");
    expect(base.physicalTypes.CoC7).toEqual(["weapon", "item"]);
  });

  it("returns an empty registry with no input and can be merged again", () => {
    const empty = mergeRegistries();
    expect(empty).toEqual({ physicalTypes: {}, byId: {}, byName: {}, keywords: [], byType: {} });
    const again = mergeRegistries(mergeRegistries(base), addon);
    expect(resolveSize(coc("Desk Lamp"), again)).toEqual({ w: 3, h: 3 });
  });
});
