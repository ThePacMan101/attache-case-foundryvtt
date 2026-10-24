import { describe, expect, it } from "vitest";
import { installFoundry } from "./helpers/fake-foundry.mjs";

installFoundry({ system: "CoC7" });
const { screenScale } = await import("../../scripts/apps/drag-controller.mjs");

const el = (cssWidth, screenWidth) => ({ offsetWidth: cssWidth, getBoundingClientRect: () => ({ width: screenWidth }) });

describe("screenScale", () => {
  it("is the ratio of on-screen to layout width (UI scale / window scale)", () => {
    expect(screenScale(el(240, 240))).toBe(1);
    expect(screenScale(el(240, 192))).toBeCloseTo(0.8);
    expect(screenScale(el(240, 300))).toBeCloseTo(1.25);
  });

  it("falls back to 1 for hidden or missing elements", () => {
    expect(screenScale(el(0, 0))).toBe(1);
    expect(screenScale(null)).toBe(1);
  });
});
