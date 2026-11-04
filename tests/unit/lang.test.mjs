import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (lang) => JSON.parse(readFileSync(new URL(`../../lang/${lang}.json`, import.meta.url), "utf8"));

/** Every leaf key of a nested object, as a dotted path. */
function keys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

/** Every file under a repo folder, recursively. */
function filesIn(folder) {
  const base = new URL(`../../${folder}/`, import.meta.url);
  return readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(new URL(`${e.parentPath}/${e.name}`, "file://"), "utf8"));
}

describe("language files", () => {
  const en = read("en");
  const pt = read("pt-BR");

  it("have exactly the same keys", () => {
    expect(keys(pt).sort()).toEqual(keys(en).sort());
  });

  it("have the keys of the default size and image features", () => {
    const need = [
      "ATTACHE.Settings.ResetBodies.Name", "ATTACHE.Settings.ResetBodies.Label", "ATTACHE.Settings.ResetBodies.Hint",
      "ATTACHE.Config.ResetBodiesConfirm", "ATTACHE.Notify.NoCustomBodies", "ATTACHE.Notify.BodiesCleared",
      "ATTACHE.Menu.ItemArt", "ATTACHE.Config.ArtTitle", "ATTACHE.Config.ArtPath", "ATTACHE.Config.ArtHint", "ATTACHE.Notify.InvalidArt"
    ];
    const known = new Set(keys(en));
    for (const key of need) expect(known.has(key), key).toBe(true);
  });

  it("hold every ATTACHE key that scripts and templates use, in both languages", () => {
    const sources = [...filesIn("scripts"), ...filesIn("templates")];
    const used = new Set();
    for (const text of sources) {
      // A key cut short by `${...}` or a comment's `<Key>` ends in a dot: not a complete key.
      for (const [key] of text.matchAll(/ATTACHE(?:\.[A-Za-z0-9_]+)+\.?/g)) if (!key.endsWith(".")) used.add(key);
      // settings.mjs builds these from `common("Name", scope)`.
      for (const [, name] of text.matchAll(/common\("(\w+)"/g)) {
        used.add(`ATTACHE.Settings.${name}.Name`);
        used.add(`ATTACHE.Settings.${name}.Hint`);
      }
    }
    expect(used.size).toBeGreaterThan(60); // the scan really found the keys
    const known = { en: new Set(keys(en)), "pt-BR": new Set(keys(pt)) };
    for (const [lang, set] of Object.entries(known)) {
      expect([...used].filter((k) => !set.has(k)), lang).toEqual([]);
    }
  });

  it("are really translated: only pure format strings are the same in both", () => {
    const at = (obj, path) => path.split(".").reduce((o, k) => o[k], obj);
    const same = keys(en).filter((k) => at(en, k) === at(pt, k));
    expect(same.sort()).toEqual(["ATTACHE.Window.Fill", "ATTACHE.Window.Size"]);
  });

  it("keep the placeholders of every string", () => {
    const names = (s) => (s.match(/\{\w+\}/g) ?? []).sort();
    const at = (obj, path) => path.split(".").reduce((o, k) => o[k], obj);
    for (const key of keys(en)) expect(names(at(pt, key)), key).toEqual(names(at(en, key)));
  });
});
