import { test } from "vitest";
import assert from "node:assert/strict";
import {
  detectBottomCandleLatest,
  tuneBottomCandleParams,
} from "./bottom-candle-detect.js";

/** @param {number} i */
function dayTime(i) {
  return { year: 2026, month: 1, day: 1 + (i % 28) };
}

test("tuneBottomCandleParams daily defaults", () => {
  const t = tuneBottomCandleParams(false, { chartIsDaily: true, tfAuto: true });
  assert.equal(t.bodyMax, 35);
  assert.equal(t.gapMin, 0.25);
  assert.equal(t.rvolMin, 1.2);
});

test("detectBottomCandleLatest on classic 3-candle bottom", () => {
  /** @type {Array<{ open: number; high: number; low: number; close: number; volume: number; time: ReturnType<typeof dayTime> }>} */
  const candles = [];
  for (let i = 0; i < 35; i++) {
    const px = 100 - i * 1.2;
    candles.push({
      open: px + 0.5,
      high: px + 1,
      low: px - 0.5,
      close: px,
      volume: 1_000_000,
      time: dayTime(i),
    });
  }
  candles.push({
    open: 59,
    high: 60,
    low: 58,
    close: 58.5,
    volume: 2_000_000,
    time: dayTime(35),
  });
  candles.push({
    open: 57.5,
    high: 58.2,
    low: 57.4,
    close: 58,
    volume: 1_800_000,
    time: dayTime(36),
  });
  candles.push({
    open: 56.8,
    high: 62,
    low: 56.5,
    close: 61,
    volume: 4_500_000,
    time: dayTime(37),
  });

  const det = detectBottomCandleLatest(candles, {
    chartIsDaily: true,
    minScore: 40,
    minGapPct: 0,
  });
  assert.equal(det.anyBottom, true);
  assert.ok(det.score >= 40);
  assert.ok(det.tag.length > 0);
  assert.ok(det.slPrice != null);
});

test("detectBottomCandleLatest false on flat noise", () => {
  const candles = Array.from({ length: 40 }, (_, i) => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000_000,
    time: dayTime(i),
  }));
  const det = detectBottomCandleLatest(candles, { chartIsDaily: true });
  assert.equal(det.anyBottom, false);
});
