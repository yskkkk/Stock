import { describe, expect, it } from "vitest";
import { applyNearWhiteStripToRgba } from "./stockLogoContrast";

describe("applyNearWhiteStripToRgba", () => {
  it("makes near-white pixels transparent", () => {
    const data = new Uint8ClampedArray([
      255, 255, 255, 255,
      20, 20, 20, 255,
      228, 230, 226, 255,
    ]);
    applyNearWhiteStripToRgba(data, { threshold: 236, feather: 20, sharpen: 1 });
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[11]).toBeLessThan(255);
    expect(data[11]).toBeGreaterThan(0);
  });

  it("boosts contrast on visible pixels when sharpen > 1", () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    applyNearWhiteStripToRgba(data, { threshold: 250, sharpen: 1.2 });
    expect(data[0]).toBeLessThan(100);
    expect(data[3]).toBe(255);
  });
});
