import { describe, expect, it } from "vitest";
import { shouldDrawBoxOnChart } from "./boxRangeChartPrimitive";

describe("shouldDrawBoxOnChart", () => {
  it("shows all strategy TFs on intraday charts", () => {
    expect(shouldDrawBoxOnChart("1h", "1m")).toBe(true);
    expect(shouldDrawBoxOnChart("4h", "15m")).toBe(true);
    expect(shouldDrawBoxOnChart("1d", "5m")).toBe(true);
  });

  it("shows same-or-coarser boxes on 1h+ charts (1d visible on 1h)", () => {
    expect(shouldDrawBoxOnChart("1h", "1h")).toBe(true);
    expect(shouldDrawBoxOnChart("4h", "1h")).toBe(true);
    expect(shouldDrawBoxOnChart("1d", "1h")).toBe(true);
    expect(shouldDrawBoxOnChart("1d", "4h")).toBe(true);
    expect(shouldDrawBoxOnChart("1h", "1d")).toBe(false);
  });
});
