import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundry } from "./helpers/fake-foundry.mjs";

const env = installFoundry({ system: "CoC7" });
const { sanitizeArt, resolveArt, bindArtFallback, DEFAULT_ICON } = await import("../../scripts/core/art.mjs");
const { displayImg, canEditArt } = await import("../../scripts/foundry/system-adapter.mjs");
const svc = await import("../../scripts/foundry/inventory.mjs");
const { registerHooks } = await import("../../scripts/foundry/hooks.mjs");
const { registerQueries } = await import("../../scripts/foundry/queries.mjs");
const { AttacheCaseApp } = await import("../../scripts/apps/attache-case-app.mjs");

const M = "attache-case";
const ICON = "icons/weapons/swords/sword-guard-purple.webp";
const OTHER = "icons/svg/sword.svg";
const flags = (f) => ({ [M]: f });
const weapon = (extra = {}, more = {}) => ({ name: "Knife", type: "weapon", _id: "w", img: ICON, flags: flags({ size: { w: 2, h: 1 }, ...extra }), ...more });
const hook = (name) => env.hooks.get(name)?.[0];
const isDel = (v) => v instanceof foundry.data.operators.ForcedDeletion;
const updates = (actor) => actor.log.filter((l) => l.op === "update");

beforeAll(() => {
  registerHooks();
  registerQueries();
});

beforeEach(() => {
  env.actors.clear();
  env.notifications.length = 0;
  game.system.id = "CoC7";
  game.user.isGM = false;
});

describe("sanitizeArt", () => {
  it.each([
    [ICON, ICON],
    ["modules/x/My Sword (1).png", "modules/x/My Sword (1).png"],
    ["https://cdn.example.test/a/b.webp?v=2", "https://cdn.example.test/a/b.webp?v=2"],
    ["http://example.test/b.png", "http://example.test/b.png"],
    ["  icons/svg/sword.svg \n", "icons/svg/sword.svg"]
  ])("accepts %j", (input, output) => {
    expect(sanitizeArt(input)).toBe(output);
  });

  it.each([
    [""], ["   "], ["\n\t"], [null], [undefined], [0], [42], [true], [{}], [[ICON]],
    ["javascript:alert(1)"], ["JavaScript:alert(1)"], ["  javascript:alert(1)"], ["java\tscript:alert(1)"], ["java\nscript:alert(1)"],
    ["vbscript:msgbox(1)"], ["data:image/svg+xml,<svg onload=alert(1)>"], ["data:text/html,x"], ["file:///etc/passwd"], ["blob:http://x/y"],
    ['"><img src=x onerror=alert(1)>'], ["<script>alert(1)</script>"], ["icons/a\"b.png"], ["icons/a<b.png"], ["icons/a>b.png"], ["icons/a\u0000b.png"]
  ])("rejects %j", (input) => {
    expect(sanitizeArt(input)).toBeNull();
  });
});

describe("resolveArt", () => {
  it("is the normal image when there is no art, as today", () => {
    expect(resolveArt({ img: ICON })).toEqual({ src: ICON, fallback: DEFAULT_ICON });
    expect(resolveArt({ art: undefined, img: ICON }).src).toBe(ICON);
  });

  it("prefers a valid art and falls back to the normal image", () => {
    expect(resolveArt({ art: OTHER, img: ICON })).toEqual({ src: OTHER, fallback: ICON });
  });

  it("ignores an art that does not pass validation (hand-edited flag)", () => {
    for (const art of ["", "javascript:alert(1)", '"><img src=x onerror=alert(1)>', 7, {}]) {
      expect(resolveArt({ art, img: ICON }).src).toBe(ICON);
    }
  });

  it("ignores the art when concealed", () => {
    expect(resolveArt({ art: OTHER, img: ICON }, { conceal: true })).toEqual({ src: ICON, fallback: DEFAULT_ICON });
  });

  it("uses the default icon when the item has no image at all", () => {
    for (const img of ["", null, undefined]) {
      expect(resolveArt({ img })).toEqual({ src: DEFAULT_ICON, fallback: "" });
      expect(resolveArt({ art: OTHER, img })).toEqual({ src: OTHER, fallback: DEFAULT_ICON });
    }
  });

  it("does not ask for the default icon twice", () => {
    expect(resolveArt({ img: DEFAULT_ICON })).toEqual({ src: DEFAULT_ICON, fallback: "" });
  });
});

describe("bindArtFallback", () => {
  /** A root that records its listener, and an img that records every src it gets. */
  function fixture() {
    const listeners = [];
    const root = { addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
    bindArtFallback(root);
    const makeImg = (src, fallback) => {
      const attrs = fallback === undefined ? {} : { "data-fallback": fallback };
      return {
        tagName: "IMG", src, srcs: [src],
        hasAttribute: (k) => k in attrs,
        dataset: {
          get fallback() { return attrs["data-fallback"]; },
          set fallback(v) { attrs["data-fallback"] = v; }
        }
      };
    };
    const fail = (img) => {
      const before = img.src;
      listeners[0].fn({ target: img });
      if (img.src !== before) img.srcs.push(img.src);
    };
    return { listeners, makeImg, fail };
  }

  it("listens in the capture phase, because error events do not bubble", () => {
    const { listeners } = fixture();
    expect(listeners).toHaveLength(1);
    expect(listeners[0].type).toBe("error");
    expect(listeners[0].capture).toBe(true);
  });

  it("walks art -> item image -> default icon, then stops", () => {
    const { makeImg, fail } = fixture();
    const { src, fallback } = resolveArt({ art: OTHER, img: ICON });
    const img = makeImg(src, fallback);
    fail(img);
    expect(img.src).toBe(ICON);
    fail(img);
    expect(img.src).toBe(DEFAULT_ICON);
    fail(img);
    fail(img);
    expect(img.srcs).toEqual([OTHER, ICON, DEFAULT_ICON]);
  });

  it("walks item image -> default icon when there is no art", () => {
    const { makeImg, fail } = fixture();
    const { src, fallback } = resolveArt({ img: ICON });
    const img = makeImg(src, fallback);
    fail(img);
    fail(img);
    expect(img.srcs).toEqual([ICON, DEFAULT_ICON]);
  });

  it("does not loop on a missing default icon", () => {
    const { makeImg, fail } = fixture();
    const { src, fallback } = resolveArt({ img: DEFAULT_ICON });
    const img = makeImg(src, fallback);
    fail(img);
    expect(img.srcs).toEqual([DEFAULT_ICON]);
  });

  it("leaves other elements alone", () => {
    const { makeImg, fail, listeners } = fixture();
    const img = makeImg("a.png"); // an image without data-fallback is not ours
    fail(img);
    expect(img.srcs).toEqual(["a.png"]);
    expect(() => listeners[0].fn({ target: { tagName: "VIDEO", hasAttribute: () => true, dataset: { fallback: "x" } } })).not.toThrow();
    expect(() => listeners[0].fn({ target: null })).not.toThrow();
  });
});

describe("displayImg and the unidentified guard", () => {
  const item = (identified) => ({ img: ICON, flags: flags({ art: OTHER }), system: { identified } });

  it.each(["CoC7", "deltagreen"])("%s ignores system.identified", (system) => {
    game.system.id = system;
    expect(displayImg(item(false), { isGM: false }).src).toBe(OTHER);
    expect(displayImg(item(true), { isGM: false }).src).toBe(OTHER);
  });

  it("dnd5e: a non-GM viewing an unidentified item sees the normal image", () => {
    game.system.id = "dnd5e";
    expect(displayImg(item(false), { isGM: false })).toEqual({ src: ICON, fallback: DEFAULT_ICON });
  });

  it("dnd5e: the GM sees the art; so does everyone once it is identified", () => {
    game.system.id = "dnd5e";
    expect(displayImg(item(false), { isGM: true }).src).toBe(OTHER);
    expect(displayImg(item(true), { isGM: false }).src).toBe(OTHER);
    expect(displayImg({ img: ICON, flags: flags({ art: OTHER }), system: {} }, { isGM: false }).src).toBe(OTHER);
  });

  it("defaults to the current user", () => {
    game.system.id = "dnd5e";
    game.user.isGM = false;
    expect(displayImg(item(false)).src).toBe(ICON);
    game.user.isGM = true;
    expect(displayImg(item(false)).src).toBe(OTHER);
  });

  it("works on an item with no flags at all", () => {
    expect(displayImg({ img: ICON }).src).toBe(ICON);
  });
});

describe("canEditArt", () => {
  it("is for whoever owns the item", () => {
    const mine = env.addActor({ items: [weapon()] }).items.get("w");
    const theirs = env.addActor({ owner: false, items: [weapon()] }).items.get("w");
    expect(canEditArt(mine)).toBe(true);
    expect(canEditArt(theirs)).toBe(false);
    expect(canEditArt(null)).toBe(false);
  });

  it("does not depend on the size setting", () => {
    env.settings.set(`${M}.playersCanEditSizes`, false);
    expect(canEditArt(env.addActor({ items: [weapon()] }).items.get("w"))).toBe(true);
  });

  it("dnd5e: an owner player cannot read or change the art of an unidentified item", () => {
    game.system.id = "dnd5e";
    const item = env.addActor({ items: [weapon({ art: OTHER }, { system: { identified: false } })] }).items.get("w");
    expect(canEditArt(item)).toBe(false);
    game.user.isGM = true;
    expect(canEditArt(item)).toBe(true);
  });
});

describe("setItemArt", () => {
  it("writes the flag in one update", async () => {
    const actor = env.addActor({ items: [weapon()] });
    expect(await svc.setItemArt(actor.items.get("w"), `  ${OTHER} `)).toBe(true);
    expect(updates(actor)).toHaveLength(1);
    expect(updates(actor)[0].updates).toEqual([{ _id: "w", [`flags.${M}.art`]: OTHER }]);
    expect(actor.items.get("w").img).toBe(ICON); // the item's own image is never touched
  });

  it("writes nothing when the value is the same", async () => {
    const actor = env.addActor({ items: [weapon({ art: OTHER })] });
    expect(await svc.setItemArt(actor.items.get("w"), OTHER)).toBe(true);
    expect(actor.log).toEqual([]);
  });

  it("null or an empty string removes the flag with the deletion operator", async () => {
    for (const reset of [null, "", "   "]) {
      const actor = env.addActor({ items: [weapon({ art: OTHER })] });
      expect(await svc.setItemArt(actor.items.get("w"), reset)).toBe(true);
      expect(isDel(updates(actor)[0].updates[0][`flags.${M}.art`])).toBe(true);
      expect(actor.items.get("w").getFlag(M, "art")).toBeUndefined();
    }
  });

  it("resetting an item with no art writes nothing", async () => {
    const actor = env.addActor({ items: [weapon()] });
    expect(await svc.setItemArt(actor.items.get("w"), null)).toBe(true);
    expect(actor.log).toEqual([]);
  });

  it.each(["javascript:alert(1)", '"><img src=x onerror=alert(1)>', 7])("refuses %j with a warning and writes nothing", async (bad) => {
    const actor = env.addActor({ items: [weapon({ art: OTHER })] });
    expect(await svc.setItemArt(actor.items.get("w"), bad)).toBe(false);
    expect(actor.log).toEqual([]);
    expect(env.notifications.at(-1).type).toBe("warn");
    expect(env.notifications.at(-1).msg).toBe("ATTACHE.Notify.InvalidArt");
    expect(actor.items.get("w").getFlag(M, "art")).toBe(OTHER);
  });

  it("refuses a non-owner", async () => {
    const actor = env.addActor({ owner: false, items: [weapon()] });
    expect(await svc.setItemArt(actor.items.get("w"), OTHER)).toBe(false);
    expect(actor.log).toEqual([]);
    expect(env.notifications.at(-1).msg).toBe("ATTACHE.Notify.NoPermission");
  });

  it("dnd5e: refuses an owner player on an unidentified item", async () => {
    game.system.id = "dnd5e";
    const actor = env.addActor({ items: [weapon({ art: OTHER }, { system: { identified: false } })] });
    expect(await svc.setItemArt(actor.items.get("w"), null)).toBe(false);
    expect(actor.log).toEqual([]);
    expect(actor.items.get("w").getFlag(M, "art")).toBe(OTHER);
  });
});

describe("art stays with the item", () => {
  it("through a give between owned actors", async () => {
    const a = env.addActor({ items: [weapon({ art: OTHER, pos: { c: "body", x: 0, y: 0, r: false } })] });
    const b = env.addActor({ name: "B" });
    expect(await svc.transferItem(a.items.get("w"), b)).toBe(true);
    const [created] = [...b.items.values()];
    expect(created.getFlag(M, "art")).toBe(OTHER);
    expect(created.img).toBe(ICON);
  });

  it("through a GM-relayed give", async () => {
    const a = env.addActor({ items: [weapon({ art: OTHER })] });
    const b = env.addActor({ name: "Friend", owner: false, playerOwner: true });
    env.gm.queries.length = 0;
    expect(await svc.transferItem(a.items.get("w"), b)).toBe(true);
    expect(env.gm.queries).toHaveLength(1);
    expect([...b.items.values()][0].getFlag(M, "art")).toBe(OTHER);
  });

  it("through a drop copy", async () => {
    const source = env.addActor({ items: [weapon({ art: OTHER })] });
    const target = env.addActor({ name: "T" });
    const created = await svc.addFromDrop(target, { type: "Item", uuid: source.items.get("w").uuid }, { kind: "auto" });
    expect(created.getFlag(M, "art")).toBe(OTHER);
  });
});

describe("item sheet menu", () => {
  const labels = (item) => {
    const controls = [];
    hook("getHeaderControlsItemSheetV2")({ document: item, options: { actions: {} } }, controls);
    return controls.map((c) => c.label);
  };
  const SIZE = "ATTACHE.Menu.ItemSize";
  const ART = "ATTACHE.Menu.ItemArt";

  it("an owner player gets the image entry but not the size entry", () => {
    expect(labels(env.addActor({ items: [weapon()] }).items.get("w"))).toEqual([ART]);
  });

  it("the GM gets both", () => {
    game.user.isGM = true;
    expect(labels(env.addActor({ items: [weapon()] }).items.get("w"))).toEqual([SIZE, ART]);
  });

  it("a non-owner gets nothing", () => {
    expect(labels(env.addActor({ owner: false, items: [weapon()] }).items.get("w"))).toEqual([]);
  });

  it("items that are not inventory items get nothing", () => {
    game.user.isGM = true;
    expect(labels(env.addActor({ items: [{ _id: "s", name: "Spot Hidden", type: "skill" }] }).items.get("s"))).toEqual([]);
  });

  it("a container gets the image entry too, and repeated hooks add nothing twice", () => {
    const item = env.addActor({ items: [{ _id: "b", name: "Bag", type: "item", flags: flags({ container: { cols: 2, rows: 2 } }) }] }).items.get("b");
    const controls = [];
    const app = { document: item, options: { actions: {} } };
    hook("getHeaderControlsItemSheetV2")(app, controls);
    hook("getHeaderControlsItemSheetV2")(app, controls);
    expect(controls.map((c) => c.label)).toEqual([ART]);
  });

  it("dnd5e: the same handler serves its item sheet hook", () => {
    game.system.id = "dnd5e";
    const item = env.addActor({ type: "character", items: [{ _id: "l", name: "Zzyzx", type: "loot" }] }).items.get("l");
    const controls = [];
    hook("getHeaderControlsItemSheet5e")({ document: item, options: { actions: {} } }, controls);
    expect(controls.map((c) => c.label)).toEqual([ART]);
  });
});

describe("re-rendering", () => {
  it("a change of the art re-renders the case, on every client", () => {
    const refresh = vi.spyOn(AttacheCaseApp, "refreshFor").mockImplementation(() => {});
    const actor = env.addActor({ items: [weapon()] });
    hook("updateItem")(actor.items.get("w"), { flags: flags({ art: OTHER }) }, {}, "someone-else");
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockRestore();
  });

  it("dnd5e: identifying an item re-renders, so the guard follows the change", () => {
    game.system.id = "dnd5e";
    const refresh = vi.spyOn(AttacheCaseApp, "refreshFor").mockImplementation(() => {});
    const actor = env.addActor({ type: "character", items: [{ _id: "l", name: "Zzyzx", type: "loot" }] });
    hook("updateItem")(actor.items.get("l"), { system: { identified: true } }, {}, "someone-else");
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockRestore();
  });

  it("CoC7: an unrelated system change does not", () => {
    const refresh = vi.spyOn(AttacheCaseApp, "refreshFor").mockImplementation(() => {});
    const actor = env.addActor({ items: [weapon()] });
    hook("updateItem")(actor.items.get("w"), { system: { identified: true } }, {}, "someone-else");
    expect(refresh).not.toHaveBeenCalled();
    refresh.mockRestore();
  });
});

describe("templates", () => {
  it("never print an image path unescaped, and every item image has a fallback", () => {
    for (const name of ["attache-case", "item-chip", "item-size-config", "actor-config", "item-art-config"]) {
      const hbs = readFileSync(new URL(`../../templates/${name}.hbs`, import.meta.url), "utf8");
      expect(hbs, name).not.toMatch(/\{\{\{/);
      for (const tag of hbs.match(/<img[^>]*>/g) ?? []) expect(tag, name).toMatch(/data-fallback="\{\{/);
    }
  });
});
