import { test } from "vitest";
import assert from "node:assert/strict";
import { detectDailyMaAlignment } from "./ma-align-detect.js";

test("detectDailyMaAlignment requires 120+ bars", () => {
  const candles = Array.from({ length: 119 }, (_, i) => ({ close: 100 + i * 0.1 }));
  assert.equal(detectDailyMaAlignment(candles), false);
});

test("detectDailyMaAlignment true on rising series", () => {
  /** @type {{ close: number }[]} */
  const candles = [];
  for (let i = 0; i < 140; i++) {
    candles.push({ close: 80 + i * 0.5 });
  }
  assert.equal(detectDailyMaAlignment(candles), true);
});

test("detectDailyMaAlignment false on flat series", () => {
  const candles = Array.from({ length: 140 }, () => ({ close: 100 }));
  assert.equal(detectDailyMaAlignment(candles), false);
});
