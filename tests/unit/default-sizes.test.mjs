import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_REGISTRY } from "../../scripts/data/default-sizes.mjs";
import { CONTAINER_PRESETS, PRESET_STRINGS } from "../../scripts/data/container-presets.mjs";
import { resolveSize, explainSize } from "../../scripts/core/sizes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Snapshot of the system compendiums (CoC7 v8.16, Delta Green source packs), 2026-10.
// CoC7 compendiums/en-wiki-weapons.yaml + en-items.yaml weapons, by CoC id.
// "Spear, Thrown" reuses i.weapon.shuriken in the system data; that id is tested separately.
const COC7_WEAPON_IDS = [
  "i.weapon.bow", "i.weapon.brass-knuckles", "i.weapon.bullwhip", "i.weapon.burning-torch",
  "i.weapon.blackjack", "i.weapon.club-large", "i.weapon.club-small", "i.weapon.crossbow",
  "i.weapon.garrote", "i.weapon.hatchet-sickle", "i.weapon.knife-large", "i.weapon.knife-medium",
  "i.weapon.knife-small", "i.weapon.nunchaku", "i.weapon.rock-thrown", "i.weapon.spear",
  "i.weapon.22-short-automatic", "i.weapon.25-derringer-1b", "i.weapon.32-or-7-65mm-revolver",
  "i.weapon.32-or-7-65mm-automatic", "i.weapon.model-p08-luger", "i.weapon.45-revolver",
  "i.weapon.45-automatic", "i.weapon.22-bolt-action-rifle", "i.weapon.30-lever-action-carbine",
  "i.weapon.45-martini-henry-rifle", "i.weapon.col-moran-s-air-rifle", "i.weapon.303-lee-enfield",
  "i.weapon.30-06-bolt-action-rifle", "i.weapon.elephant-gun-2b", "i.weapon.20-gauge-shotgun-2b",
  "i.weapon.16-gauge-shotgun-2b", "i.weapon.12-gauge-shotgun-2b", "i.weapon.12-gauge-shotgun-semi-auto",
  "i.weapon.12-gauge-shotgun-2b-sawed-off", "i.weapon.bergmann-mp181-mp2811", "i.weapon.thompson",
  "i.weapon.browning-auto-rifle-m1918", "i.weapon.30-browning-m1917a1", "i.weapon.bren-gun",
  "i.weapon.mark-i-lewis-gun", "i.weapon.vickers-303",
  "i.weapon.brawl", "i.weapon.example-death-ray-prototype", "i.weapon.example-experimental-weapon"
];

// CoC7 English names from the same files (44 + 3).
const COC7_WEAPON_NAMES = [
  "Bow", "Brass Knuckles", "Bullwhip", "Burning Torch", "Blackjack", "Club, Large", "Club, Small",
  "Crossbow", "Garrote", "Hatchet/Sickle", "Knife, Large", "Knife, Medium", "Knife, Small", "Nunchaku",
  "Rock, Thrown", "Shuriken", "Spear", "Spear, Thrown", ".22 Short Automatic", ".25 Derringer (1B)",
  ".32 or 7.65mm Revolver", ".32 or 7.65mm Automatic", "Model P08 Luger", ".45 Revolver",
  ".45 Automatic", ".22 Bolt-Action Rifle", ".30 Lever-Action Carbine", ".45 Martini-Henry Rifle",
  "Col. Moran's Air Rifle", ".303 Lee-Enfield", ".30-06 Bolt-Action Rifle", "Elephant Gun (2B)",
  "20-gauge Shotgun (2B)", "16-gauge Shotgun (2B)", "12-gauge Shotgun (2B)",
  "12-gauge Shotgun (semi-auto)", "12-gauge Shotgun (2B sawed off)", "Bergmann MP181/MP2811",
  "Thompson", "Browning Auto Rifle M1918", ".30 Browning M1917A1", "Bren Gun", "Mark I Lewis Gun",
  "Vickers .303", "Unarmed", "Death ray (prototype)", "Experimental weapon"
];

// Delta Green packs/source/{firearms,hand-to-hand-weapons,armor}: [pack, _id, name].
const DG_ITEMS = [
  ["firearms", "mvGLbgOB9TeGBfhr", "Heavy Pistol"],
  ["firearms", "7TSuCYbhLeHIRpod", "Light Pistol"],
  ["firearms", "xb73X4SjsbuYs4D7", "Medium Pistol"],
  ["firearms", "5JoNQn7l3KiOAHlE", "Rifle (Heavy)"],
  ["firearms", "42sHG2tugOGgtFLK", "Rifle (Light)"],
  ["firearms", "ccNHepyVZVb6p49U", "Rifle (Very Heavy)"],
  ["firearms", "oQhWip2JTJYY18fS", "Shotgun (Firing Nonlethal)"],
  ["firearms", "Zh1TVVNUFBxfxAOc", "Shotgun (Firing Shot)"],
  ["firearms", "DruzlEXzmEMSwoSq", "Shotgun (Firing Slug)"],
  ["firearms", "0Gz1jcY28Psezqrv", "Submachine Gun (SMG)"],
  ["hand-to-hand-weapons", "qEM7Gz7raecORkj0", "Baseball Bat"],
  ["hand-to-hand-weapons", "c7Vl2gFQ9Tz8uQbM", "Baton"],
  ["hand-to-hand-weapons", "TumiVMIYL7uCGrJW", "Brass Knuckles"],
  ["hand-to-hand-weapons", "n0e4gZfCWsfwHcQH", "Club"],
  ["hand-to-hand-weapons", "TvswuYGnr0Mt6aAg", "Combat Dagger"],
  ["hand-to-hand-weapons", "ZawdvRsFTJyB1SvW", "Fixed Bayonet"],
  ["hand-to-hand-weapons", "u5fnrg385Z79DUK6", "Flashlight (Heavy)"],
  ["hand-to-hand-weapons", "PkhlVFDhDUGqLdCW", "Garotte"],
  ["hand-to-hand-weapons", "0gCwBTqSAbG9J20Y", "Hatchet"],
  ["hand-to-hand-weapons", "OsW9m877sce0LdsO", "Knife"],
  ["hand-to-hand-weapons", "ryiBL4PoYTutSaZ5", "Large Sword"],
  ["hand-to-hand-weapons", "JAhifOCkSG5Iwaeo", "Rifle Butt"],
  ["hand-to-hand-weapons", "bhdeIJZJA4JEi1iW", "Spear"],
  ["hand-to-hand-weapons", "b9hKP3QHJPzk45YD", "Sword"],
  ["hand-to-hand-weapons", "DUJXpTwNqHJCqv6E", "Two-handed Sword"],
  ["hand-to-hand-weapons", "JQEMyFfCHx38gupS", "Unarmed Attack"],
  ["hand-to-hand-weapons", "77d2U7eSBn5AaQk7", "Wood Axe"],
  ["armor", "oYJsYalfaNchDt34", "Bomb Suit"],
  ["armor", "h8KAJDpLe03y2qWK", "Helmet, Kevlar"],
  ["armor", "0iBS0OdEMPN6WTsu", "Helmet, Riot"],
  ["armor", "3PqRqzKL6Y3G3N0r", "Kevlar Vest"],
  ["armor", "W9gc014kriVkUpxq", "Reinforced Kevlar Vest"],
  ["armor", "Yc0n7fZZJaDKW7J1", "Tactical Body Armor"]
];
const dgType = (pack) => (pack === "armor" ? "armor" : "weapon");
const dgUuid = (pack, id) => `Compendium.deltagreen.${pack}.Item.${id}`;

const coc = (name, extra = {}) => ({ systemId: "CoC7", type: "weapon", name, flags: {}, ...extra });
const dg = (name, extra = {}) => ({ systemId: "deltagreen", type: "weapon", name, flags: {}, ...extra });
const size = (w, h) => ({ w, h });

function isValidEntry(entry) {
  if (entry === "excluded") return true;
  return Number.isInteger(entry?.w) && Number.isInteger(entry?.h)
    && entry.w >= 1 && entry.w <= 32 && entry.h >= 1 && entry.h <= 32;
}

describe("DEFAULT_REGISTRY coverage", () => {
  it("declares the physical item types of both systems", () => {
    expect(DEFAULT_REGISTRY.physicalTypes.CoC7).toEqual(["weapon", "armor", "book", "item"]);
    expect(DEFAULT_REGISTRY.physicalTypes.deltagreen).toEqual(["weapon", "armor", "gear", "tome"]);
  });

  it("has a byId entry for every CoC7 compendium weapon", () => {
    const missing = COC7_WEAPON_IDS.filter((id) => !(id in DEFAULT_REGISTRY.byId.CoC7));
    expect(missing).toEqual([]);
    expect(DEFAULT_REGISTRY.byId.CoC7["i.weapon.brawl"]).toBe("excluded");
  });

  it("has a byName entry for every CoC7 compendium weapon", () => {
    const keys = Object.keys(DEFAULT_REGISTRY.byName.CoC7);
    const missing = COC7_WEAPON_NAMES.filter((n) => !keys.includes(n.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it("has byId and byName entries for every Delta Green compendium item", () => {
    const missingIds = DG_ITEMS.filter(([p, id]) => !(dgUuid(p, id) in DEFAULT_REGISTRY.byId.deltagreen));
    const missingNames = DG_ITEMS.filter(([, , n]) => !(n.toLowerCase() in DEFAULT_REGISTRY.byName.deltagreen));
    expect(missingIds).toEqual([]);
    expect(missingNames).toEqual([]);
  });

  it("excludes attacks that are not objects", () => {
    expect(DEFAULT_REGISTRY.byId.deltagreen[dgUuid("hand-to-hand-weapons", "JQEMyFfCHx38gupS")]).toBe("excluded");
    expect(DEFAULT_REGISTRY.byId.deltagreen[dgUuid("hand-to-hand-weapons", "JAhifOCkSG5Iwaeo")]).toBe("excluded");
  });

  it("only contains valid sizes, all within [1, 32]", () => {
    const tables = [DEFAULT_REGISTRY.byId, DEFAULT_REGISTRY.byName, DEFAULT_REGISTRY.byType];
    for (const table of tables) {
      for (const entries of Object.values(table)) {
        for (const [key, entry] of Object.entries(entries)) {
          expect(isValidEntry(entry), key).toBe(true);
        }
      }
    }
    for (const kw of DEFAULT_REGISTRY.keywords) expect(isValidEntry(kw.size), String(kw.pattern)).toBe(true);
  });

  it("defines compendium items horizontally (w >= h)", () => {
    for (const entries of Object.values(DEFAULT_REGISTRY.byId)) {
      for (const [key, entry] of Object.entries(entries)) {
        if (entry !== "excluded") expect(entry.w >= entry.h, key).toBe(true);
      }
    }
  });

  it("has type fallbacks for every physical type", () => {
    for (const [system, types] of Object.entries(DEFAULT_REGISTRY.physicalTypes)) {
      for (const type of types) expect(DEFAULT_REGISTRY.byType[system][type], `${system}.${type}`).toBeTruthy();
    }
  });
});

describe("DEFAULT_REGISTRY resolution through resolveSize", () => {
  it("resolves every CoC7 weapon by CoC id with a translated name", () => {
    for (const id of COC7_WEAPON_IDS) {
      const r = explainSize(coc("Nome traduzido", { coreId: id }), DEFAULT_REGISTRY);
      expect(r.source, id).toBe("id");
    }
    expect(resolveSize(coc("Revólver .45", { coreId: "i.weapon.45-revolver" }), DEFAULT_REGISTRY)).toEqual(size(3, 2));
    expect(resolveSize(coc("Desarmado", { coreId: "i.weapon.brawl" }), DEFAULT_REGISTRY)).toBeNull();
  });

  it("works around the duplicated i.weapon.shuriken id by name", () => {
    const thrownSpear = coc("Spear, Thrown", { coreId: "i.weapon.shuriken" });
    const shuriken = coc("Shuriken", { coreId: "i.weapon.shuriken" });
    expect(resolveSize(thrownSpear, DEFAULT_REGISTRY)).toEqual(size(10, 1));
    expect(resolveSize(shuriken, DEFAULT_REGISTRY)).toEqual(size(1, 1));
    expect(resolveSize(coc("Lança arremessada", { coreId: "i.weapon.shuriken" }), DEFAULT_REGISTRY)).toEqual(size(12, 1));
  });

  it("resolves every Delta Green item by compendium source and by bare id", () => {
    for (const [pack, id, name] of DG_ITEMS) {
      const type = dgType(pack);
      const full = explainSize(dg("x", { type, sourceId: dgUuid(pack, id) }), DEFAULT_REGISTRY);
      const byName = explainSize(dg(name, { type }), DEFAULT_REGISTRY);
      expect(full.source, name).toBe("id");
      expect(byName.source, name).toBe("name");
      expect(byName.size).toEqual(full.size);
    }
    expect(resolveSize(dg("Unarmed Attack"), DEFAULT_REGISTRY)).toBeNull();
  });

  it("matches the scale anchors", () => {
    const byId = (id) => DEFAULT_REGISTRY.byId.CoC7[id];
    expect(byId("i.weapon.45-automatic")).toEqual(size(3, 2));
    expect(byId("i.weapon.25-derringer-1b")).toEqual(size(1, 1));
    expect(byId("i.weapon.knife-small")).toEqual(size(2, 1));
    expect(byId("i.weapon.12-gauge-shotgun-2b")).toEqual(size(8, 2));
    expect(byId("i.weapon.12-gauge-shotgun-2b-sawed-off")).toEqual(size(5, 2));
    expect(byId("i.weapon.303-lee-enfield")).toEqual(size(9, 2));
    expect(byId("i.weapon.elephant-gun-2b")).toEqual(size(10, 2));
    expect(byId("i.weapon.mark-i-lewis-gun")).toEqual(size(12, 3));
    expect(byId("i.weapon.vickers-303")).toEqual(size(10, 3));
    expect(DEFAULT_REGISTRY.byId.deltagreen[dgUuid("firearms", "0Gz1jcY28Psezqrv")]).toEqual(size(4, 3));
    expect(DEFAULT_REGISTRY.byId.deltagreen[dgUuid("armor", "W9gc014kriVkUpxq")]).toEqual(size(4, 4));
    expect(DEFAULT_REGISTRY.byId.deltagreen[dgUuid("armor", "h8KAJDpLe03y2qWK")]).toEqual(size(2, 2));
  });

  it("falls back to the item type, and ignores non-physical types", () => {
    expect(resolveSize(coc("Zzyzx", { type: "book" }), DEFAULT_REGISTRY)).toEqual(size(2, 2));
    expect(resolveSize(coc("Zzyzx", { type: "armor" }), DEFAULT_REGISTRY)).toEqual(size(3, 3));
    expect(resolveSize(dg("Zzyzx", { type: "gear" }), DEFAULT_REGISTRY)).toEqual(size(1, 1));
    expect(resolveSize(coc("Spot Hidden", { type: "skill" }), DEFAULT_REGISTRY)).toBeNull();
    expect(resolveSize(dg("Family", { type: "bond" }), DEFAULT_REGISTRY)).toBeNull();
  });
});

describe("DEFAULT_REGISTRY keywords", () => {
  it("are RegExps without stateful flags", () => {
    expect(DEFAULT_REGISTRY.keywords.length).toBeGreaterThanOrEqual(60);
    for (const kw of DEFAULT_REGISTRY.keywords) {
      expect(kw.pattern).toBeInstanceOf(RegExp);
      expect(kw.pattern.flags).not.toMatch(/[gy]/);
      expect(kw.pattern.flags).toContain("i");
    }
  });

  // [system, type, name, expected size or null]
  const SAMPLES = [
    // Firearms, English and Portuguese
    ["CoC7", "weapon", "Revólver .38", size(3, 2)],
    ["CoC7", "weapon", "Revólver calibre 38", size(3, 2)],
    ["CoC7", "weapon", "Espingarda de cano serrado", size(5, 2)],
    ["CoC7", "weapon", "Sawed-off Shotgun", size(5, 2)],
    ["CoC7", "weapon", "Escopeta calibre 12", size(8, 2)],
    ["deltagreen", "weapon", "Remington 870 Shotgun", size(8, 2)],
    ["CoC7", "weapon", "Fuzil Mauser", size(9, 2)],
    ["deltagreen", "weapon", ".22 Bolt-Action Rifle", size(9, 2)],
    ["CoC7", "weapon", "Carabina Winchester", size(8, 2)],
    ["deltagreen", "weapon", "AR-15", size(8, 2)],
    ["deltagreen", "weapon", "Pistola 9mm", size(3, 2)],
    ["deltagreen", "weapon", "Glock 17", size(3, 2)],
    ["deltagreen", "weapon", ".44 Magnum", size(4, 2)],
    ["CoC7", "weapon", "Colt Vest Pocket", size(2, 2)],
    ["CoC7", "weapon", "Derringer", size(1, 1)],
    ["CoC7", "weapon", "Tommy Gun", size(6, 3)],
    ["deltagreen", "weapon", "Submetralhadora Uzi", size(4, 3)],
    ["deltagreen", "weapon", "Metralhadora M60", size(10, 3)],
    ["CoC7", "weapon", "Lança-granadas", size(6, 2)],
    // Melee
    ["CoC7", "weapon", "Faca", size(2, 1)],
    ["CoC7", "weapon", "Canivete", size(1, 1)],
    ["CoC7", "weapon", "Machado", size(8, 2)],
    ["CoC7", "weapon", "Machadinha", size(3, 2)],
    ["CoC7", "weapon", "Pick axe", size(7, 2)],
    ["CoC7", "weapon", "Soco inglês", size(1, 1)],
    ["CoC7", "weapon", "Lança", size(12, 1)],
    ["CoC7", "weapon", "Espada", size(8, 1)],
    // Exclusions
    ["CoC7", "weapon", "Soco", null],
    ["deltagreen", "weapon", "Bite", null],
    ["deltagreen", "weapon", "Coronhada", null],
    // Armor
    ["deltagreen", "armor", "Colete à prova de balas", size(4, 4)],
    ["deltagreen", "armor", "Capacete", size(2, 2)],
    // Gear
    ["CoC7", "item", "Pé de cabra", size(5, 1)],
    ["CoC7", "item", "Crowbar", size(5, 1)],
    ["deltagreen", "gear", "Lanterna", size(2, 1)],
    ["deltagreen", "gear", "Flashlight", size(2, 1)],
    ["CoC7", "item", "Electric torch", size(2, 1)],
    ["CoC7", "item", "Lampião a querosene", size(2, 3)],
    ["CoC7", "item", "Corda de 15 metros", size(2, 2)],
    ["CoC7", "item", "Câmera fotográfica", size(2, 2)],
    ["CoC7", "item", "Kodak camera 35mm", size(2, 2)],
    ["CoC7", "item", "Caderno de anotações", size(2, 2)],
    ["CoC7", "item", "Diário de Lewis", size(2, 2)],
    ["CoC7", "item", "Lewis's Journal", size(2, 2)],
    ["CoC7", "book", "Livro do Saber", size(2, 2)],
    ["CoC7", "book", "Grimório", size(2, 3)],
    ["deltagreen", "tome", "Necronomicon", size(2, 3)],
    ["CoC7", "item", "Mapa da cidade", size(1, 1)],
    ["CoC7", "item", "Gazuas", size(1, 1)],
    ["CoC7", "item", "Binóculo", size(2, 2)],
    ["CoC7", "item", "Kit de primeiros socorros", size(2, 2)],
    ["deltagreen", "gear", "Medkit", size(2, 2)],
    ["deltagreen", "gear", "Atadura", size(1, 1)],
    ["deltagreen", "gear", "Seringa de morfina", size(1, 1)],
    ["CoC7", "item", "Cantil", size(2, 2)],
    ["CoC7", "item", "Hip flask", size(1, 1)],
    ["CoC7", "item", "Garrafa de uísque", size(2, 1)],
    ["deltagreen", "gear", "Munição .38", size(1, 1)],
    ["deltagreen", "gear", "Box of 9mm ammunition", size(1, 1)],
    ["deltagreen", "gear", "Carregador extra", size(1, 1)],
    ["deltagreen", "gear", "Rádio", size(2, 1)],
    ["deltagreen", "gear", "Celular", size(1, 1)],
    ["deltagreen", "gear", "Notebook Dell", size(3, 2)],
    ["deltagreen", "gear", "Laptop", size(3, 2)],
    ["deltagreen", "gear", "Notebook", size(2, 2)],
    ["CoC7", "item", "Dinamite", size(2, 1)],
    ["deltagreen", "gear", "Granada de fragmentação", size(1, 1)],
    ["CoC7", "item", "Isqueiro", size(1, 1)],
    ["CoC7", "item", "Caixa de fósforos", size(1, 1)],
    ["CoC7", "item", "Carteira", size(1, 1)],
    ["CoC7", "item", "Chave da cripta", size(1, 1)],
    ["CoC7", "item", "Moeda de ouro", size(1, 1)],
    ["CoC7", "item", "Ídolo de pedra", size(2, 2)],
    ["CoC7", "item", "Estátua de jade", size(3, 3)],
    ["CoC7", "item", "Crystal ball", size(2, 2)],
    ["deltagreen", "gear", "Pá dobrável", size(4, 2)],
    // False-positive guards: nothing in the keyword list should match these
    ["CoC7", "item", "Balança de precisão", size(1, 1)]
  ];

  it.each(SAMPLES)("%s %s %j", (systemId, type, name, expected) => {
    expect(resolveSize({ systemId, type, name, flags: {} }, DEFAULT_REGISTRY)).toEqual(expected);
  });
});

describe("CONTAINER_PRESETS", () => {
  it("has 10-12 unique presets with sane dimensions and core icons", () => {
    expect(CONTAINER_PRESETS.length).toBeGreaterThanOrEqual(10);
    expect(CONTAINER_PRESETS.length).toBeLessThanOrEqual(12);
    expect(new Set(CONTAINER_PRESETS.map((p) => p.key)).size).toBe(CONTAINER_PRESETS.length);
    for (const p of CONTAINER_PRESETS) {
      expect(Number.isInteger(p.cols) && p.cols >= 1 && p.cols <= 32, p.key).toBe(true);
      expect(Number.isInteger(p.rows) && p.rows >= 1 && p.rows <= 32, p.key).toBe(true);
      expect(p.img).toMatch(/^icons\/[\w/-]+\.(webp|svg)$/);
      expect(p.name).toMatch(/^ATTACHE\.Preset\.[A-Z]\w*\.Name$/);
      expect(p.description).toMatch(/^ATTACHE\.Preset\.[A-Z]\w*\.Description$/);
    }
  });

  it("has English and Portuguese strings for every preset", () => {
    for (const lang of ["en", "pt-BR"]) {
      for (const p of CONTAINER_PRESETS) {
        const [, , seg] = p.name.split(".");
        const s = PRESET_STRINGS[lang].ATTACHE.Preset[seg];
        expect(s?.Name, `${lang} ${seg}`).toBeTruthy();
        expect(s?.Description, `${lang} ${seg}`).toBeTruthy();
      }
    }
  });
});

describe("container compendium sources", () => {
  const packs = [
    { dir: "containers-coc7", type: "item", desc: (d) => d.system.description.value },
    { dir: "containers-deltagreen", type: "gear", desc: (d) => d.system.description }
  ];

  it.each(packs)("$dir has one valid Item document per preset", ({ dir, type, desc }) => {
    const folder = path.join(ROOT, "packs-src", dir);
    const docs = fs.readdirSync(folder).filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(folder, f), "utf8")));
    expect(docs.length).toBe(CONTAINER_PRESETS.length);
    const ids = new Set();
    for (const d of docs) {
      expect(d._id).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(d._key).toBe(`!items!${d._id}`);
      expect(d.type).toBe(type);
      expect(typeof desc(d)).toBe("string");
      ids.add(d._id);
    }
    expect(ids.size).toBe(docs.length);
    for (const p of CONTAINER_PRESETS) {
      const name = PRESET_STRINGS.en.ATTACHE.Preset[p.name.split(".")[2]].Name;
      const d = docs.find((x) => x.name === name);
      expect(d, name).toBeTruthy();
      expect(d.img).toBe(p.img);
      expect(d.flags["attache-case"].container).toEqual({ cols: p.cols, rows: p.rows });
    }
  });
});
