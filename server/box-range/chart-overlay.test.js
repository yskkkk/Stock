import { describe, expect, it } from "vitest";
import { detectBoxRangeOnCandles } from "./detect.js";
import { boxRangeTfsForChartTimeframe } from "./chart-overlay.js";

function flatBoxCandles(n = 30, base = 100, width = 1.6) {
  const out = [];
  const t0 = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    const mid = base;
    const atTop = i % 6 < 3;
    out.push({
      time: t0 + i * 3600,
      open: atTop ? mid + width * 0.35 : mid - width * 0.35,
      high: atTop ? mid + width : mid + width * 0.15,
      low: atTop ? mid - width * 0.15 : mid - width,
      close: atTop ? mid - width * 0.45 : mid + width * 0.45,
      volume: 1000,
    });
  }
  return out;
}

describe("boxRangeTfsForChartTimeframe", () => {
  it("always detects all strategy TFs", () => {
    expect(boxRangeTfsForChartTimeframe("1m")).toEqual(["1h", "4h", "1d"]);
    expect(boxRangeTfsForChartTimeframe("1h")).toEqual(["1h", "4h", "1d"]);
    expect(boxRangeTfsForChartTimeframe("4h")).toEqual(["1h", "4h", "1d"]);
  });
});

describe("detectBoxRangeOnCandles", () => {
  it("finds flat range", () => {
    const c = flatBoxCandles(40);
    const d = detectBoxRangeOnCandles(c, "1h");
    expect(d).not.toBeNull();
    expect(d.top).toBeGreaterThan(d.bottom);
  });
});
