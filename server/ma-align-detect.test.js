import { test } from "vitest";
import assert from "node:assert/strict";
import {
  detectDailyMa5OverMa20,
  detectDailyMaAlignment,
} from "./ma-align-detect.js";
import {
  buildDailyClosesIndex,
  resolveCandleBarIndex,
} from "./daily-bar-index.js";
import { detectDailyGoldenCrossDetail } from "./golden-cross-detect.js";

test("detectDailyMa5OverMa20 on rising series", () => {
  /** @type {{ close: number }[]} */
  const candles = [];
  for (let i = 0; i < 40; i++) {
    candles.push({ close: 80 + i * 0.5 });
  }
  assert.equal(detectDailyMa5OverMa20(candles), true);
});

test("detectDailyMa5OverMa20 false when ma5 below ma20", () => {
  const candles = Array.from({ length: 40 }, () => ({ close: 100 }));
  candles[39].close = 90;
  candles[38].close = 95;
  assert.equal(detectDailyMa5OverMa20(candles), false);
});

test("barIndex maps to same candle when invalid close gaps exist", () => {
  /** @type {{ close: number; time: { year: number; month: number; day: number } }[]} */
  const candles = [];
  for (let i = 0; i < 140; i++) {
    candles.push({
      close: 80 + i * 0.5,
      time: { year: 2026, month: 1, day: 1 + (i % 28) },
    });
  }
  candles[100].close = Number.NaN;
  const { candleToCloseIndex } = buildDailyClosesIndex(candles);
  const { candleIndex, closeIndex } = resolveCandleBarIndex(
    candleToCloseIndex,
    139,
    candles.length,
  );
  assert.equal(candleIndex, 139);
  assert.ok(closeIndex >= 0);
  const detail = detectDailyGoldenCrossDetail(candles, 139);
  assert.equal(detail.crossDate, detail.crossDate);
  assert.ok(detectDailyMaAlignment(candles));
});
