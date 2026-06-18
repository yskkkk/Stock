import { test } from "vitest";
import assert from "node:assert/strict";
import {
  detectCandleLowSlopeFlipLatest,
  findPivotLows,
  mergeNearbyPivotLows,
} from "./candle-low-slope-detect.js";

/** @param {number[]} lows */
function candlesFromLows(lows) {
  return lows.map((low, i) => ({
    low,
    high: low + 2,
    close: low + 1,
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
  }));
}

test("findPivotLows finds local minima", () => {
  const pivots = findPivotLows(candlesFromLows([10, 9, 8, 9, 10, 7, 8, 9]), 1, 1);
  assert.ok(pivots.some((p) => p.index === 2));
  assert.ok(pivots.some((p) => p.index === 5));
});

test("detectCandleLowSlopeFlipLatest finds down_to_up flip near end", () => {
  const lows = [];
  for (let i = 0; i < 55; i++) {
    const trend = 90 - i * 0.9;
    const rip = Math.sin(i / 3) * 3;
    lows.push(trend + rip);
  }
  lows.push(44, 43, 42, 43, 45, 47, 49, 48, 50, 52);
  const det = detectCandleLowSlopeFlipLatest(candlesFromLows(lows), {
    pivotLeft: 2,
    pivotRight: 2,
    recentBars: 12,
    minPivotGap: 3,
  });
  assert.equal(det.hit, true);
  assert.equal(det.lowSlopeFlip, "down_to_up");
});

test("detectCandleLowSlopeFlipLatest ignores old flips", () => {
  const lows = [
    100, 95, 90, 95, 100, 95, 90, 95, 100, 95,
    90, 95, 100, 95, 90, 95, 100, 95, 90, 88,
    86, 84, 82, 80, 78, 76, 74, 72, 70, 68,
    66, 64, 62, 60, 58, 56, 54, 52, 50, 48,
  ];
  const det = detectCandleLowSlopeFlipLatest(candlesFromLows(lows), {
    pivotLeft: 2,
    pivotRight: 2,
    recentBars: 3,
    minPivotGap: 3,
  });
  assert.equal(det.hit, false);
});

test("mergeNearbyPivotLows keeps lower pivot in cluster", () => {
  const merged = mergeNearbyPivotLows(
    [
      { index: 10, low: 50, date: "a" },
      { index: 12, low: 45, date: "b" },
      { index: 20, low: 40, date: "c" },
    ],
    5,
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].low, 45);
});
