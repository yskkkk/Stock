import { describe, expect, it } from "vitest";
import {
  chartTimeBefore,
  chartTimeEquals,
  chartTimeToSortKey,
  normalizeChartTime,
} from "./chartTime";

describe("chartTime", () => {
  it("compares business days by value not reference", () => {
    const a = { year: 2026, month: 6, day: 8 };
    const b = { year: 2026, month: 6, day: 8 };
    expect(chartTimeEquals(a, b)).toBe(true);
  });

  it("orders unix seconds", () => {
    expect(chartTimeBefore(100, 200)).toBe(true);
    expect(chartTimeBefore(200, 100)).toBe(false);
  });

  it("normalizes business day numbers", () => {
    const t = normalizeChartTime({ year: 2026, month: 6, day: 8 });
    expect(t).toEqual({ year: 2026, month: 6, day: 8 });
  });

  it("normalizes millisecond unix to seconds", () => {
    const sec = 1_700_000_000;
    expect(chartTimeToSortKey(sec * 1000)).toBe(sec);
  });
});
