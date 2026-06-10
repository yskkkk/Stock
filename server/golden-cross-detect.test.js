import { test } from "vitest";
import assert from "node:assert/strict";
import {
  candleTimeToDateKey,
  detectDailyGoldenCrossDetail,
  detectMaCrosses,
  isDeadCrossBar,
  isGoldenCrossBar,
} from "./golden-cross-detect.js";

test("isGoldenCrossBar matches Pine ta.crossover", () => {
  assert.equal(isGoldenCrossBar(98, 102, 100, 100), true);
  assert.equal(isGoldenCrossBar(102, 102, 100, 100), false);
  assert.equal(isGoldenCrossBar(98, 99, 100, 100), false);
});

test("isDeadCrossBar matches Pine ta.crossunder", () => {
  assert.equal(isDeadCrossBar(102, 98, 100, 100), true);
  assert.equal(isDeadCrossBar(98, 98, 100, 100), false);
  assert.equal(isDeadCrossBar(102, 101, 100, 100), false);
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

test("detectMaCrosses finds 5>20 golden cross", () => {
  /** @type {{ close: number }[]} */
  const candles = [];
  for (let i = 0; i < 140; i++) {
    candles.push({ close: 100 });
  }
  candles[138].close = 99;
  candles[139].close = 105;
  const crosses = detectMaCrosses(candles);
  assert.ok(crosses.includes("5>20"));
  assert.ok(!crosses.includes("5>60"));
  assert.ok(!crosses.includes("5>120"));
});

test("detectMaCrosses finds 20>120 when ma20 crosses ma120", () => {
  /** @type {{ close: number }[]} */
  const candles = Array.from({ length: 140 }, (_, i) => ({
    close: i < 125 ? 90 : 90 + (i - 124) * 3,
  }));
  let hit = -1;
  for (let bi = 121; bi < candles.length; bi++) {
    if (detectMaCrosses(candles, bi).includes("20>120")) {
      hit = bi;
      break;
    }
  }
  assert.ok(hit >= 0, "synthetic series should contain 20>120 cross");
});
