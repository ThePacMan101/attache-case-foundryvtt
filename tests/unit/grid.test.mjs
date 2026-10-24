import { describe, expect, it } from "vitest";
import { Grid, footprint } from "../../scripts/core/grid.mjs";

describe("footprint", () => {
  it("returns the size unrotated", () => {
    expect(footprint({ w: 3, h: 6 }, false)).toEqual({ w: 3, h: 6 });
    expect(footprint({ w: 3, h: 6 })).toEqual({ w: 3, h: 6 });
  });
  it("swaps width and height when rotated", () => {
    expect(footprint({ w: 3, h: 6 }, true)).toEqual({ w: 6, h: 3 });
  });
  it("returns a new object", () => {
    const size = { w: 2, h: 2 };
    expect(footprint(size)).not.toBe(size);
  });
});

describe("Grid construction", () => {
  it("stores dimensions", () => {
    const g = new Grid(10, 6);
    expect(g.cols).toBe(10);
    expect(g.rows).toBe(6);
    expect(g.freeCells()).toBe(60);
  });
  it("sanitizes garbage dimensions to non-negative integers", () => {
    expect(new Grid(-3, 2.7)).toMatchObject({ cols: 0, rows: 2 });
    expect(new Grid(NaN, undefined)).toMatchObject({ cols: 0, rows: 0 });
  });
});

describe("Grid.inBounds", () => {
  const g = new Grid(4, 3);
  it("accepts rectangles fully inside", () => {
    expect(g.inBounds(0, 0, 4, 3)).toBe(true);
    expect(g.inBounds(3, 2, 1, 1)).toBe(true);
    expect(g.inBounds(1, 1, 2, 2)).toBe(true);
  });
  it("rejects rectangles crossing any edge", () => {
    expect(g.inBounds(-1, 0, 1, 1)).toBe(false);
    expect(g.inBounds(0, -1, 1, 1)).toBe(false);
    expect(g.inBounds(3, 0, 2, 1)).toBe(false);
    expect(g.inBounds(0, 2, 1, 2)).toBe(false);
    expect(g.inBounds(0, 0, 5, 1)).toBe(false);
  });
  it("rejects non-integer or empty rectangles", () => {
    expect(g.inBounds(0.5, 0, 1, 1)).toBe(false);
    expect(g.inBounds(0, 0, 0, 1)).toBe(false);
    expect(g.inBounds(0, 0, 1, 0)).toBe(false);
    expect(g.inBounds(0, 0, 1.5, 1)).toBe(false);
    expect(g.inBounds("0", 0, 1, 1)).toBe(false);
  });
});

describe("Grid place / canPlace / occupantAt / remove", () => {
  it("places an item and reports its cells", () => {
    const g = new Grid(5, 5);
    expect(g.place("a", 1, 1, 2, 3)).toBe(true);
    expect(g.occupantAt(1, 1)).toBe("a");
    expect(g.occupantAt(2, 3)).toBe("a");
    expect(g.occupantAt(3, 1)).toBe(null);
    expect(g.occupantAt(1, 4)).toBe(null);
    expect(g.has("a")).toBe(true);
    expect(g.rectOf("a")).toEqual({ x: 1, y: 1, w: 2, h: 3 });
    expect(g.freeCells()).toBe(19);
  });

  it("rejects overlaps without changing anything", () => {
    const g = new Grid(5, 5);
    g.place("a", 1, 1, 2, 2);
    expect(g.canPlace(2, 2, 2, 2)).toBe(false);
    expect(g.place("b", 2, 2, 2, 2)).toBe(false);
    expect(g.has("b")).toBe(false);
    expect(g.occupantAt(3, 3)).toBe(null);
    expect(g.occupantAt(2, 2)).toBe("a");
  });

  it("allows adjacent placements", () => {
    const g = new Grid(4, 2);
    expect(g.place("a", 0, 0, 2, 2)).toBe(true);
    expect(g.place("b", 2, 0, 2, 2)).toBe(true);
    expect(g.freeCells()).toBe(0);
  });

  it("rejects out-of-bounds placement", () => {
    const g = new Grid(3, 3);
    expect(g.place("a", 2, 2, 2, 1)).toBe(false);
    expect(g.place("a", -1, 0, 1, 1)).toBe(false);
    expect(g.freeCells()).toBe(9);
  });

  it("canPlace ignores the given item id", () => {
    const g = new Grid(4, 4);
    g.place("a", 0, 0, 2, 2);
    g.place("b", 2, 0, 2, 2);
    expect(g.canPlace(1, 0, 2, 2)).toBe(false);
    expect(g.canPlace(1, 1, 2, 2, "a")).toBe(false); // still hits b
    expect(g.canPlace(0, 1, 2, 2, "a")).toBe(true);
    expect(g.canPlace(0, 0, 2, 2, "a")).toBe(true);
  });

  it("placing an existing id moves it (overlapping its own old cells is fine)", () => {
    const g = new Grid(4, 4);
    g.place("a", 0, 0, 2, 2);
    expect(g.place("a", 1, 1, 2, 2)).toBe(true);
    expect(g.occupantAt(0, 0)).toBe(null);
    expect(g.occupantAt(2, 2)).toBe("a");
    expect(g.rectOf("a")).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(g.freeCells()).toBe(12);
  });

  it("a failed move keeps the item where it was", () => {
    const g = new Grid(4, 4);
    g.place("a", 0, 0, 2, 2);
    g.place("b", 2, 2, 2, 2);
    expect(g.place("a", 1, 1, 2, 2)).toBe(false);
    expect(g.rectOf("a")).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(g.occupantAt(0, 0)).toBe("a");
  });

  it("remove frees the cells and is a no-op for unknown ids", () => {
    const g = new Grid(3, 3);
    g.place("a", 0, 0, 3, 1);
    g.remove("a");
    g.remove("nope");
    expect(g.has("a")).toBe(false);
    expect(g.rectOf("a")).toBe(null);
    expect(g.occupantAt(1, 0)).toBe(null);
    expect(g.freeCells()).toBe(9);
    expect(g.place("b", 0, 0, 3, 3)).toBe(true);
  });

  it("rejects null/undefined ids", () => {
    const g = new Grid(2, 2);
    expect(g.place(null, 0, 0, 1, 1)).toBe(false);
    expect(g.place(undefined, 0, 0, 1, 1)).toBe(false);
  });

  it("occupantAt returns null out of bounds", () => {
    const g = new Grid(2, 2);
    g.place("a", 0, 0, 2, 2);
    expect(g.occupantAt(-1, 0)).toBe(null);
    expect(g.occupantAt(2, 0)).toBe(null);
    expect(g.occupantAt(0, 2)).toBe(null);
    expect(g.occupantAt(0.5, 0)).toBe(null);
  });

  it("lists ids in placement order", () => {
    const g = new Grid(3, 1);
    g.place("c", 2, 0, 1, 1);
    g.place("a", 0, 0, 1, 1);
    expect(g.ids()).toEqual(["c", "a"]);
  });

  it("rectOf returns a copy", () => {
    const g = new Grid(3, 3);
    g.place("a", 0, 0, 1, 1);
    g.rectOf("a").x = 2;
    expect(g.rectOf("a").x).toBe(0);
  });
});

describe("Grid.findFirstFit", () => {
  it("returns the top-left corner of an empty grid", () => {
    expect(new Grid(5, 5).findFirstFit(2, 3)).toEqual({ x: 0, y: 0 });
  });

  it("scans row-major: prefers a spot further right on an earlier row", () => {
    const g = new Grid(6, 4);
    g.place("a", 0, 0, 2, 2);
    // (2,0) is free for 2x2 even though (0,2) is too.
    expect(g.findFirstFit(2, 2)).toEqual({ x: 2, y: 0 });
  });

  it("skips over blockers in the middle of a row", () => {
    const g = new Grid(6, 2);
    g.place("a", 2, 0, 1, 1);
    expect(g.findFirstFit(3, 1)).toEqual({ x: 3, y: 0 });
    expect(g.findFirstFit(2, 2)).toEqual({ x: 0, y: 0 });
    expect(g.findFirstFit(3, 2)).toEqual({ x: 3, y: 0 });
    expect(g.findFirstFit(4, 2)).toBe(null);
  });

  it("finds a spot on a lower row when upper rows are blocked", () => {
    const g = new Grid(4, 4);
    g.place("top", 0, 0, 4, 1);
    g.place("mid", 1, 1, 1, 1);
    expect(g.findFirstFit(3, 2)).toEqual({ x: 0, y: 2 });
    expect(g.findFirstFit(2, 1)).toEqual({ x: 2, y: 1 });
    expect(g.findFirstFit(1, 3)).toEqual({ x: 0, y: 1 });
  });

  it("matches a brute-force scan on random grids", () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let t = 0; t < 200; t++) {
      const g = new Grid(2 + Math.floor(rand() * 8), 2 + Math.floor(rand() * 8));
      for (let k = 0; k < 10; k++) {
        g.place(`i${k}`, Math.floor(rand() * g.cols), Math.floor(rand() * g.rows),
          1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 3));
      }
      const w = 1 + Math.floor(rand() * 4);
      const h = 1 + Math.floor(rand() * 4);
      let expected = null;
      outer: for (let y = 0; y < g.rows; y++) {
        for (let x = 0; x < g.cols; x++) {
          if (g.canPlace(x, y, w, h)) { expected = { x, y }; break outer; }
        }
      }
      expect(g.findFirstFit(w, h)).toEqual(expected);
    }
  });

  it("returns null when the grid is full", () => {
    const g = new Grid(2, 2);
    g.place("a", 0, 0, 2, 2);
    expect(g.findFirstFit(1, 1)).toBe(null);
  });

  it("returns null when the item is larger than the grid", () => {
    const g = new Grid(3, 2);
    expect(g.findFirstFit(4, 1)).toBe(null);
    expect(g.findFirstFit(1, 3)).toBe(null);
  });

  it("returns null for invalid sizes", () => {
    const g = new Grid(3, 3);
    expect(g.findFirstFit(0, 1)).toBe(null);
    expect(g.findFirstFit(1.5, 1)).toBe(null);
  });

  it("can ignore an item's own cells", () => {
    const g = new Grid(2, 2);
    g.place("a", 0, 0, 2, 2);
    expect(g.findFirstFit(1, 2, "a")).toEqual({ x: 0, y: 0 });
  });
});

describe("zero-size grid (0x0 body)", () => {
  const g = new Grid(0, 0);
  it("has no cells and accepts nothing", () => {
    expect(g.freeCells()).toBe(0);
    expect(g.inBounds(0, 0, 1, 1)).toBe(false);
    expect(g.canPlace(0, 0, 1, 1)).toBe(false);
    expect(g.place("a", 0, 0, 1, 1)).toBe(false);
    expect(g.findFirstFit(1, 1)).toBe(null);
    expect(g.occupantAt(0, 0)).toBe(null);
  });
});

describe("Grid.clone", () => {
  it("produces an independent copy", () => {
    const g = new Grid(3, 3);
    g.place("a", 0, 0, 2, 2);
    const c = g.clone();
    expect(c.occupantAt(1, 1)).toBe("a");
    c.remove("a");
    c.place("b", 2, 2, 1, 1);
    expect(g.occupantAt(1, 1)).toBe("a");
    expect(g.has("b")).toBe(false);
    expect(c.has("a")).toBe(false);
    expect(c.cols).toBe(3);
    expect(c.rows).toBe(3);
  });
});
