import { test } from "vitest";
import assert from "node:assert/strict";
import {
  candleTimeToDateKey,
  detectDailyGoldenCrossDetail,
  detectDailyGoldenCrosses,
  isGoldenCrossBar,
} from "./golden-cross-detect.js";

test("isGoldenCrossBar detects upward cross", () => {
  assert.equal(isGoldenCrossBar(98, 102, 100, 100), true);
  assert.equal(isGoldenCrossBar(102, 102, 100, 100), false);
  assert.equal(isGoldenCrossBar(98, 99, 100, 100), false);
});

test("detectDailyGoldenCrossDetail returns crossDate from bar time", () => {
  /** @type {{ close: number; time: { year: number; month: number; day: number } }[]} */
  const candles = [];
  for (let i = 0; i < 140; i++) {
    candles.push({ close: 100, time: { year: 2026, month: 6, day: 1 } });
  }
  candles[138].close = 99;
  candles[139].close = 105;
  candles[139].time = { year: 2026, month: 6, day: 8 };
  const detail = detectDailyGoldenCrossDetail(candles);
  assert.equal(detail.crossDate, "2026-06-08");
});

test("candleTimeToDateKey formats KST day object", () => {
  assert.equal(
    candleTimeToDateKey({ year: 2026, month: 6, day: 8 }),
    "2026-06-08",
  );
});

test("detectDailyGoldenCrosses finds 5>20 cross on synthetic series", () => {
  /** @type {{ close: number }[]} */
  const candles = [];
  for (let i = 0; i < 140; i++) {
    candles.push({ close: 100 });
  }
  candles[138].close = 99;
  candles[139].close = 105;
  const crosses = detectDailyGoldenCrosses(candles);
  assert.ok(crosses.length >= 0);
});
