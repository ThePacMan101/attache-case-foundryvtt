import { describe, expect, it } from "vitest";
import { autoArrange, buildLayout } from "../../scripts/core/layout.mjs";
import { Grid, footprint } from "../../scripts/core/grid.mjs";

const ct = (id, cols, rows) => ({ id, cols, rows });
const item = (id, w, h, sort = 0) => ({ id, size: { w, h }, sort });

/** Rebuild a layout from the result and check every placement is honoured (no overlaps, in bounds). */
function verify(containers, items, result) {
  const withPos = items.map((it) => ({ ...it, pos: result.placements.get(it.id) ?? null }));
  const layout = buildLayout(containers, withPos);
  for (const [id, pos] of result.placements) {
    expect(layout.placed.get(id), `placement of ${id} must be valid`).toMatchObject(pos);
  }
  return layout;
}

function seededShuffle(list, seed) {
  const out = list.slice();
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("autoArrange", () => {
  it("returns empty results for empty input", () => {
    const r = autoArrange([], []);
    expect(r.placements.size).toBe(0);
    expect(r.overflow).toEqual([]);
    expect(autoArrange(undefined, undefined).placements.size).toBe(0);
  });

  it("puts everything in overflow when there is no container", () => {
    const r = autoArrange([], [item("a", 1, 1, 2), item("b", 2, 2, 1)]);
    expect(r.placements.size).toBe(0);
    expect(r.overflow).toEqual(["b", "a"]);
  });

  it("places the largest item first at the top-left", () => {
    const cts = [ct("body", 5, 3)];
    const items = [item("small", 1, 1), item("gun", 3, 2)];
    const r = autoArrange(cts, items);
    expect(r.placements.get("gun")).toEqual({ c: "body", x: 0, y: 0, r: false });
    expect(r.placements.get("small")).toEqual({ c: "body", x: 3, y: 0, r: false });
    expect(r.overflow).toEqual([]);
    verify(cts, items, r);
  });

  it("rotates an item when only the rotated orientation fits", () => {
    const cts = [ct("body", 2, 6)];
    const r = autoArrange(cts, [item("rifle", 5, 2)]);
    expect(r.placements.get("rifle")).toEqual({ c: "body", x: 0, y: 0, r: true });
  });

  it("prefers the unrotated orientation on a tie", () => {
    const r = autoArrange([ct("body", 6, 6)], [item("gun", 3, 2)]);
    expect(r.placements.get("gun").r).toBe(false);
  });

  it("fills containers in display order", () => {
    const cts = [ct("body", 2, 2), ct("bag", 6, 4)];
    const items = [item("a", 2, 2), item("b", 2, 2), item("c", 1, 1)];
    const r = autoArrange(cts, items);
    expect(r.placements.get("a").c).toBe("body");
    expect(r.placements.get("b").c).toBe("bag");
    expect(r.placements.get("c").c).toBe("bag");
    verify(cts, items, r);
  });

  it("sends what does not fit to overflow, in sort/id order", () => {
    const cts = [ct("body", 3, 2)];
    const items = [item("big", 4, 4, 5), item("tiny", 1, 1, 0), item("huge", 9, 9, 1)];
    const r = autoArrange(cts, items);
    expect(r.placements.has("tiny")).toBe(true);
    expect(r.overflow).toEqual(["huge", "big"]);
  });

  it("ignores items' current positions", () => {
    const cts = [ct("body", 4, 1)];
    const items = [{ id: "a", size: { w: 1, h: 1 }, pos: { c: "body", x: 3, y: 0, r: false }, sort: 0 }];
    expect(autoArrange(cts, items).placements.get("a")).toEqual({ c: "body", x: 0, y: 0, r: false });
  });

  it("skips duplicate ids, malformed items and duplicate containers", () => {
    const cts = [ct("body", 2, 2), ct("body", 9, 9), null, { id: "" }];
    const items = [item("a", 1, 1), item("a", 2, 2), null, { size: { w: 1, h: 1 } }, { id: "m", size: "garbage" }];
    const r = autoArrange(cts, items);
    expect([...r.placements.keys()].sort()).toEqual(["a", "m"]);
    expect(r.placements.get("m")).toBeDefined(); // malformed size -> 1x1
    expect(r.overflow).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    const cts = [ct("body", 5, 3), ct("pack", 8, 6), ct("pouch", 3, 2)];
    const items = [];
    for (let i = 0; i < 30; i++) items.push(item(`i${String(i).padStart(2, "0")}`, 1 + (i % 4), 1 + ((i * 7) % 3), i % 5));
    const ref = autoArrange(cts, items);
    for (const seed of [1, 7, 42, 1337]) {
      const r = autoArrange(cts, seededShuffle(items, seed));
      expect(Object.fromEntries(r.placements)).toEqual(Object.fromEntries(ref.placements));
      expect(r.overflow).toEqual(ref.overflow);
    }
    verify(cts, items, ref);
  });

  it("packs a perfect tiling without overflow", () => {
    // 4x4 grid: one 2x4 bar, two 2x2 squares -> must use every cell.
    const cts = [ct("body", 4, 4)];
    const items = [item("s1", 2, 2), item("bar", 4, 2), item("s2", 2, 2)];
    const r = autoArrange(cts, items);
    expect(r.overflow).toEqual([]);
    const layout = verify(cts, items, r);
    expect(layout.grids.get("body").freeCells()).toBe(0);
  });

  it("falls back to another ordering when largest-area-first overflows", () => {
    // Area-first puts the 2x3 at the left edge, leaving no full row for the 5x1 bar;
    // long-side-first lays the bar first and everything fits.
    const cts = [ct("body", 5, 3)];
    const items = [item("block", 2, 3), item("bar", 5, 1), item("stub", 2, 1)];
    const r = autoArrange(cts, items);
    expect(r.overflow).toEqual([]);
    verify(cts, items, r);
  });

  it("never overlaps items and respects bounds on a random load", () => {
    const cts = [ct("body", 5, 3), ct("case", 9, 5), ct("bag", 8, 6)];
    const items = [];
    let s = 99;
    const rand = (n) => ((s = (s * 1103515245 + 12345) % 2147483648) % n);
    for (let i = 0; i < 60; i++) items.push(item(`x${i}`, 1 + rand(6), 1 + rand(3), rand(10)));
    const r = autoArrange(cts, items);
    const grids = new Map(cts.map((c) => [c.id, new Grid(c.cols, c.rows)]));
    for (const it of items) {
      const p = r.placements.get(it.id);
      if (!p) continue;
      const fp = footprint(it.size, p.r);
      expect(grids.get(p.c).place(it.id, p.x, p.y, fp.w, fp.h)).toBe(true);
    }
    expect(r.placements.size + r.overflow.length).toBe(items.length);
  });

  it("stays fast for a big load", () => {
    const cts = [ct("body", 32, 32), ct("b", 32, 32)];
    const items = [];
    for (let i = 0; i < 300; i++) items.push(item(`p${i}`, 1 + (i % 5), 1 + (i % 3), i));
    const t0 = performance.now();
    autoArrange(cts, items);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
