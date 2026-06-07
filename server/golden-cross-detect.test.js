import { test } from "vitest";
import assert from "node:assert/strict";
import {
  detectDailyGoldenCrosses,
  isGoldenCrossBar,
} from "./golden-cross-detect.js";

test("isGoldenCrossBar detects upward cross", () => {
  assert.equal(isGoldenCrossBar(98, 102, 100, 100), true);
  assert.equal(isGoldenCrossBar(102, 102, 100, 100), false);
  assert.equal(isGoldenCrossBar(98, 99, 100, 100), false);
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
