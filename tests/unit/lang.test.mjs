import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (lang) => JSON.parse(readFileSync(new URL(`../../lang/${lang}.json`, import.meta.url), "utf8"));

/** Every leaf key of a nested object, as a dotted path. */
function keys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
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

  it("keep the placeholders of every string", () => {
    const names = (s) => (s.match(/\{\w+\}/g) ?? []).sort();
    const at = (obj, path) => path.split(".").reduce((o, k) => o[k], obj);
    for (const key of keys(en)) expect(names(at(pt, key)), key).toEqual(names(at(en, key)));
  });
});
