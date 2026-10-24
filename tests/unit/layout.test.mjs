import { describe, expect, it } from "vitest";
import { buildLayout, canMove, findSpot, withPlacement } from "../../scripts/core/layout.mjs";

const body = (cols = 5, rows = 3) => ({ id: "body", cols, rows });
const item = (id, w, h, pos = null, sort = 0) => ({ id, size: { w, h }, pos, sort });
const at = (c, x, y, r = false) => ({ c, x, y, r });

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

/** Plain-data snapshot of a layout for equality checks. */
function snapshot(layout) {
  const grids = {};
  for (const [id, g] of layout.grids) {
    const cells = [];
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) cells.push(g.occupantAt(x, y));
    }
    grids[id] = cells;
  }
  return { grids, placed: Object.fromEntries(layout.placed), overflow: [...layout.overflow] };
}

describe("buildLayout basics", () => {
  it("creates one grid per container in order", () => {
    const l = buildLayout([body(), { id: "pack", cols: 4, rows: 6 }], []);
    expect([...l.grids.keys()]).toEqual(["body", "pack"]);
    expect(l.grids.get("pack")).toMatchObject({ cols: 4, rows: 6 });
    expect(l.placed.size).toBe(0);
    expect(l.overflow).toEqual([]);
  });

  it("places items with valid positions and records their footprint", () => {
    const l = buildLayout([body()], [item("a", 2, 1, at("body", 0, 0)), item("b", 1, 3, at("body", 4, 0, true))]);
    expect(l.placed.get("a")).toEqual({ c: "body", x: 0, y: 0, r: false, w: 2, h: 1 });
    // rotated 1x3 -> 3x1, but x=4 + 3 > 5 -> overflow
    expect(l.overflow).toEqual(["b"]);
  });

  it("applies rotation to the footprint", () => {
    const l = buildLayout([body(6, 3)], [item("rev", 3, 6, at("body", 0, 0, true))]);
    expect(l.placed.get("rev")).toEqual({ c: "body", x: 0, y: 0, r: true, w: 6, h: 3 });
    expect(l.grids.get("body").occupantAt(5, 2)).toBe("rev");
  });

  it("puts items without pos in overflow", () => {
    const l = buildLayout([body()], [item("a", 1, 1, null), item("b", 1, 1)]);
    expect(l.overflow).toEqual(["a", "b"]);
  });

  it("puts items whose container is missing in overflow", () => {
    const l = buildLayout([body()], [item("a", 1, 1, at("deletedPack", 0, 0))]);
    expect(l.placed.has("a")).toBe(false);
    expect(l.overflow).toEqual(["a"]);
  });

  it("puts items out of bounds after a container shrink in overflow", () => {
    const items = [item("a", 2, 2, at("pack", 0, 0)), item("b", 2, 2, at("pack", 4, 4))];
    const big = buildLayout([body(), { id: "pack", cols: 6, rows: 6 }], items);
    expect(big.overflow).toEqual([]);
    const small = buildLayout([body(), { id: "pack", cols: 4, rows: 4 }], items);
    expect(small.placed.has("a")).toBe(true);
    expect(small.overflow).toEqual(["b"]);
  });

  it("puts everything in overflow with a 0x0 body", () => {
    const l = buildLayout([body(0, 0)], [item("a", 1, 1, at("body", 0, 0))]);
    expect(l.overflow).toEqual(["a"]);
    expect(findSpot(l, null, { w: 1, h: 1 })).toBe(null);
  });

  it("treats malformed positions as missing", () => {
    const l = buildLayout([body()], [
      item("a", 1, 1, { c: "body", x: 0.5, y: 0 }),
      item("b", 1, 1, { c: "body", x: "1", y: 0 }),
      item("c", 1, 1, { c: 5, x: 0, y: 0 }),
      item("d", 1, 1, "body:0:0")
    ]);
    expect(l.overflow).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back to 1x1 for malformed sizes and ignores items without id", () => {
    const l = buildLayout([body()], [
      { id: "a", size: "huge", pos: at("body", 0, 0), sort: 0 },
      { size: { w: 1, h: 1 }, pos: at("body", 1, 0) },
      null
    ]);
    expect(l.placed.get("a")).toMatchObject({ w: 1, h: 1 });
    expect(l.placed.size).toBe(1);
  });

  it("counts duplicate ids once and ignores duplicate containers", () => {
    const l = buildLayout([body(), body(1, 1)], [item("a", 1, 1, at("body", 0, 0)), item("a", 1, 1, at("body", 3, 0))]);
    expect(l.grids.get("body").cols).toBe(5);
    expect(l.placed.get("a")).toMatchObject({ x: 0 });
    expect(l.grids.get("body").occupantAt(3, 0)).toBe(null);
    expect(l.overflow).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const containers = [body()];
    const items = [item("a", 2, 1, at("body", 0, 0), 5), item("b", 1, 1, null, 1)];
    const copy = JSON.parse(JSON.stringify({ containers, items }));
    buildLayout(containers, items);
    expect({ containers, items }).toEqual(copy);
  });

  it("freezes placement entries and overflow", () => {
    const l = buildLayout([body()], [item("a", 1, 1, at("body", 0, 0)), item("b", 1, 1)]);
    expect(Object.isFrozen(l.placed.get("a"))).toBe(true);
    expect(Object.isFrozen(l.overflow)).toBe(true);
  });
});

describe("buildLayout determinism", () => {
  it("resolves conflicts by sort, then id", () => {
    const l = buildLayout([body()], [
      item("z", 2, 2, at("body", 0, 0), 10),
      item("y", 2, 2, at("body", 1, 1), 5)
    ]);
    expect(l.placed.has("y")).toBe(true);
    expect(l.overflow).toEqual(["z"]);

    const tie = buildLayout([body()], [
      item("b", 2, 2, at("body", 0, 0), 0),
      item("a", 2, 2, at("body", 1, 0), 0)
    ]);
    expect(tie.placed.has("a")).toBe(true);
    expect(tie.overflow).toEqual(["b"]);
  });

  it("uses locale-independent id ordering", () => {
    const l = buildLayout([body()], [
      item("a", 1, 1, at("body", 0, 0)),
      item("B", 1, 1, at("body", 0, 0))
    ]);
    // "B" (0x42) < "a" (0x61) in code-unit order
    expect(l.placed.has("B")).toBe(true);
    expect(l.overflow).toEqual(["a"]);
  });

  it("produces identical output for shuffled input", () => {
    const containers = [body(5, 3), { id: "pack", cols: 4, rows: 5 }];
    const items = [];
    for (let i = 0; i < 40; i++) {
      const c = i % 3 === 0 ? "pack" : "body";
      items.push(item(`it${String(i).padStart(2, "0")}`, 1 + (i % 3), 1 + ((i * 7) % 2),
        i % 5 === 4 ? null : at(c, i % 4, (i * 3) % 4, i % 2 === 0), (i * 37) % 11));
    }
    const reference = snapshot(buildLayout(containers, items));
    expect(reference.overflow.length).toBeGreaterThan(0);
    expect(Object.keys(reference.placed).length).toBeGreaterThan(0);
    for (let seed = 1; seed <= 25; seed++) {
      expect(snapshot(buildLayout(containers, seededShuffle(items, seed)))).toEqual(reference);
    }
  });

  it("orders overflow by sort then id", () => {
    const l = buildLayout([body()], [item("c", 1, 1, null, 2), item("a", 1, 1, null, 3), item("b", 1, 1, at("x", 0, 0), 1)]);
    expect(l.overflow).toEqual(["b", "c", "a"]);
  });
});

describe("canMove", () => {
  const layout = buildLayout([body(5, 3), { id: "pack", cols: 2, rows: 2 }], [
    item("a", 2, 2, at("body", 0, 0)),
    item("b", 1, 1, at("body", 3, 0))
  ]);

  it("ignores the moving item itself", () => {
    expect(canMove(layout, "a", { w: 2, h: 2 }, at("body", 1, 0))).toBe(true);
    expect(canMove(layout, "a", { w: 2, h: 2 }, at("body", 0, 1))).toBe(true);
  });

  it("rejects overlaps with other items", () => {
    expect(canMove(layout, "a", { w: 2, h: 2 }, at("body", 2, 0))).toBe(false);
    expect(canMove(layout, "new", { w: 1, h: 1 }, at("body", 0, 0))).toBe(false);
  });

  it("respects rotation", () => {
    // 1x3 rotated -> 3x1 at row 2 fits; unrotated at (4,0) fits the column
    expect(canMove(layout, "x", { w: 1, h: 3 }, at("body", 2, 2, true))).toBe(true);
    expect(canMove(layout, "x", { w: 1, h: 3 }, at("body", 3, 2, true))).toBe(false);
    expect(canMove(layout, "x", { w: 1, h: 3 }, at("body", 4, 0, false))).toBe(true);
  });

  it("rejects out of bounds, unknown containers and garbage", () => {
    expect(canMove(layout, "b", { w: 2, h: 2 }, at("body", 4, 0))).toBe(false);
    expect(canMove(layout, "b", { w: 1, h: 1 }, at("nope", 0, 0))).toBe(false);
    expect(canMove(layout, "b", { w: 1, h: 1 }, null)).toBe(false);
    expect(canMove(layout, "b", null, at("body", 4, 2))).toBe(false);
  });

  it("accepts moves into another container", () => {
    expect(canMove(layout, "a", { w: 2, h: 2 }, at("pack", 0, 0))).toBe(true);
    expect(canMove(layout, "a", { w: 2, h: 2 }, at("pack", 1, 0))).toBe(false);
  });
});

describe("findSpot", () => {
  it("uses the first fit of the first container by default", () => {
    const l = buildLayout([body(), { id: "pack", cols: 4, rows: 4 }], [item("a", 1, 1, at("body", 0, 0))]);
    expect(findSpot(l, [body(), { id: "pack" }], { w: 2, h: 2 })).toEqual({ c: "body", x: 1, y: 0, r: false });
  });

  it("accepts container ids as strings and defaults to layout order", () => {
    const l = buildLayout([body(1, 1), { id: "pack", cols: 4, rows: 4 }], []);
    expect(findSpot(l, ["pack", "body"], { w: 1, h: 1 })).toEqual({ c: "pack", x: 0, y: 0, r: false });
    expect(findSpot(l, undefined, { w: 1, h: 1 })).toEqual({ c: "body", x: 0, y: 0, r: false });
  });

  it("tries the preferred container first", () => {
    const l = buildLayout([body(), { id: "pack", cols: 4, rows: 4 }], []);
    expect(findSpot(l, [body(), { id: "pack" }], { w: 1, h: 1 }, { preferContainer: "pack" }))
      .toEqual({ c: "pack", x: 0, y: 0, r: false });
  });

  it("falls back from the preferred container to the others", () => {
    const l = buildLayout([body(), { id: "pack", cols: 1, rows: 1 }], []);
    expect(findSpot(l, [body(), { id: "pack" }], { w: 2, h: 1 }, { preferContainer: "pack" }))
      .toEqual({ c: "body", x: 0, y: 0, r: false });
  });

  it("ignores an unknown preferred container", () => {
    const l = buildLayout([body()], []);
    expect(findSpot(l, [body()], { w: 1, h: 1 }, { preferContainer: "ghost" })).toEqual({ c: "body", x: 0, y: 0, r: false });
  });

  it("rotates when the item only fits rotated", () => {
    // revolver 3x6 in a 6x3 body only fits as 6x3
    const l = buildLayout([body(6, 3)], []);
    expect(findSpot(l, null, { w: 3, h: 6 })).toEqual({ c: "body", x: 0, y: 0, r: true });
  });

  it("prefers unrotated in the same container even if rotated fits earlier", () => {
    const l = buildLayout([body(4, 4)], [item("blk", 3, 1, at("body", 1, 0))]);
    // 1x3 fits unrotated at (0,0)
    expect(findSpot(l, null, { w: 1, h: 3 })).toEqual({ c: "body", x: 0, y: 0, r: false });
    // 3x2: unrotated first fit is (0,1); rotated 2x3 would also fit at (0,1) — unrotated wins
    expect(findSpot(l, null, { w: 3, h: 2 })).toEqual({ c: "body", x: 0, y: 1, r: false });
  });

  it("tries rotation in the preferred container before moving to the next container", () => {
    const l = buildLayout([body(), { id: "pack", cols: 2, rows: 4 }], []);
    expect(findSpot(l, null, { w: 4, h: 2 }, { preferContainer: "pack" })).toEqual({ c: "pack", x: 0, y: 0, r: true });
  });

  it("respects allowRotate=false", () => {
    const l = buildLayout([body(6, 3)], []);
    expect(findSpot(l, null, { w: 3, h: 6 }, { allowRotate: false })).toBe(null);
  });

  it("returns null when nothing fits anywhere", () => {
    const l = buildLayout([body(2, 2), { id: "pack", cols: 2, rows: 2 }], [
      item("a", 2, 2, at("body", 0, 0)), item("b", 2, 1, at("pack", 0, 0))
    ]);
    expect(findSpot(l, null, { w: 2, h: 2 })).toBe(null);
    expect(findSpot(l, null, { w: 3, h: 1 })).toBe(null);
    // 1x2 only fits the pack's free bottom row when rotated to 2x1
    expect(findSpot(l, null, { w: 1, h: 2 })).toEqual({ c: "pack", x: 0, y: 1, r: true });
    expect(findSpot(l, null, { w: 1, h: 2 }, { allowRotate: false })).toBe(null);
    expect(findSpot(l, null, { w: 2, h: 1 })).toEqual({ c: "pack", x: 0, y: 1, r: false });
  });

  it("can ignore the cells of the item being relocated", () => {
    const l = buildLayout([body(2, 2)], [item("a", 2, 2, at("body", 0, 0))]);
    expect(findSpot(l, null, { w: 2, h: 2 })).toBe(null);
    expect(findSpot(l, null, { w: 2, h: 2 }, { ignoreId: "a" })).toEqual({ c: "body", x: 0, y: 0, r: false });
  });

  it("does not mutate the layout", () => {
    const l = buildLayout([body()], [item("a", 1, 1, at("body", 0, 0))]);
    const before = snapshot(l);
    findSpot(l, null, { w: 2, h: 2 });
    expect(snapshot(l)).toEqual(before);
  });
});

describe("withPlacement", () => {
  it("moves an item and leaves the original layout untouched", () => {
    const l = buildLayout([body()], [item("a", 2, 1, at("body", 0, 0))]);
    const before = snapshot(l);
    const next = withPlacement(l, "a", { w: 2, h: 1 }, at("body", 1, 1, true));
    expect(snapshot(l)).toEqual(before);
    expect(next.placed.get("a")).toEqual({ c: "body", x: 1, y: 1, r: true, w: 1, h: 2 });
    expect(next.grids.get("body").occupantAt(0, 0)).toBe(null);
    expect(next.grids.get("body").occupantAt(1, 2)).toBe("a");
  });

  it("places an overflow item and removes it from overflow", () => {
    const l = buildLayout([body()], [item("a", 1, 1)]);
    const spot = findSpot(l, null, { w: 1, h: 1 });
    const next = withPlacement(l, "a", { w: 1, h: 1 }, spot);
    expect(next.overflow).toEqual([]);
    expect(next.placed.has("a")).toBe(true);
  });

  it("chains with findSpot to auto-place several items", () => {
    let l = buildLayout([body(2, 2)], []);
    const ids = ["a", "b", "c", "d", "e"];
    const result = [];
    for (const id of ids) {
      const spot = findSpot(l, null, { w: 1, h: 1 });
      result.push(spot && `${spot.x},${spot.y}`);
      l = withPlacement(l, id, { w: 1, h: 1 }, spot);
    }
    expect(result).toEqual(["0,0", "1,0", "0,1", "1,1", null]);
    expect(l.overflow).toEqual(["e"]);
  });

  it("stows an item to overflow when pos is null", () => {
    const l = buildLayout([body()], [item("a", 1, 1, at("body", 0, 0))]);
    const next = withPlacement(l, "a", { w: 1, h: 1 }, null);
    expect(next.placed.has("a")).toBe(false);
    expect(next.overflow).toEqual(["a"]);
    expect(next.grids.get("body").occupantAt(0, 0)).toBe(null);
  });

  it("returns null for an invalid move", () => {
    const l = buildLayout([body()], [item("a", 1, 1, at("body", 0, 0)), item("b", 1, 1, at("body", 1, 0))]);
    expect(withPlacement(l, "a", { w: 1, h: 1 }, at("body", 1, 0))).toBe(null);
  });
});

describe("performance", () => {
  it("lays out a 32x32 grid with 200 items well under 5 ms", () => {
    const containers = [{ id: "body", cols: 32, rows: 32 }, { id: "pack", cols: 16, rows: 16 }];
    const items = [];
    for (let i = 0; i < 200; i++) {
      const w = 1 + (i % 3);
      const h = 1 + ((i >> 1) % 3);
      items.push(item(`item${i}`, w, h, i % 10 === 9 ? null : at(i % 4 === 0 ? "pack" : "body", (i * 5) % 31, (i * 11) % 31, i % 2 === 0), i));
    }
    for (let i = 0; i < 20; i++) buildLayout(containers, items); // warm-up
    const runs = 50;
    const t0 = performance.now();
    let l;
    for (let i = 0; i < runs; i++) l = buildLayout(containers, items);
    const avg = (performance.now() - t0) / runs;
    expect(l.placed.size + l.overflow.length).toBe(200);
    expect(avg).toBeLessThan(5);

    const t1 = performance.now();
    for (let i = 0; i < runs; i++) findSpot(l, null, { w: 4, h: 4 });
    expect((performance.now() - t1) / runs).toBeLessThan(5);
  });
});
