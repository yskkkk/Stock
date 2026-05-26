import { describe, expect, it } from "vitest";
import {
  coerceBoxUnixTime,
  shouldDrawBoxOnChart,
  unixSecToKstBusinessDayTime,
} from "./boxRangeChartPrimitive";

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

  it("maps box unix to KST business day for daily charts", () => {
    expect(unixSecToKstBusinessDayTime(1738681200)).toEqual({
      year: 2025,
      month: 2,
      day: 5,
    });
  });

  it("coerces legacy BusinessDay leftTime to unix", () => {
    expect(coerceBoxUnixTime({ year: 2025, month: 2, day: 5 })).toBe(1738681200);
    expect(
      Math.min(
        coerceBoxUnixTime({ year: 2025, month: 2, day: 5 })!,
        coerceBoxUnixTime({ year: 2025, month: 3, day: 1 })!,
      ),
    ).toBe(1738681200);
  });
});
