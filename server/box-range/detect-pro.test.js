import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBoxFromSlice,
  countRejections,
  detectBoxRangeProAt,
  detectBoxRangesProOnCandles,
  midDistancePct,
  shouldMergeProBoxes,
} from "./box-range-pro-core.js";

/** @param {number} n @param {number} price @param {number} spread */
function flatBars(n, price = 100, spread = 2) {
  /** @type {import("./box-range-pro-core.js").Bar[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      time: 1_700_000_000 + i * 86400,
      open: price,
      high: price + spread / 2,
      low: price - spread / 2,
      close: price,
      volume: 1000,
    });
  }
  return out;
}

/** 상·하단 거절(터치 후 중심 반대편 종가) */
function rangingBars(n) {
  /** @type {import("./box-range-pro-core.js").Bar[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    const atTop = i % 6 < 3;
    out.push(
      atTop
        ? {
            time: 1_700_000_000 + i * 86400,
            open: 102,
            high: 104,
            low: 99,
            close: 99.2,
            volume: 1000 + i,
          }
        : {
            time: 1_700_000_000 + i * 86400,
            open: 98,
            high: 101,
            low: 96,
            close: 100.8,
            volume: 1000 + i,
          },
    );
  }
  return out;
}

test("detectBoxRangeProAt finds ranging box", () => {
  const bars = rangingBars(30);
  const hit = detectBoxRangeProAt(bars, bars.length - 2, "1d");
  assert.ok(hit);
  assert.ok(hit.box.top > hit.box.bottom);
  assert.ok(hit.box.mid >= hit.box.bottom && hit.box.mid <= hit.box.top);
});

test("detectBoxRangeProAt rejects short series anchor", () => {
  const bars = flatBars(5);
  assert.equal(detectBoxRangeProAt(bars, 3, "1d"), null);
});

test("computeBoxFromSlice uses percentile band", () => {
  const bars = flatBars(20, 50, 4);
  const { top, bottom } = computeBoxFromSlice(bars, 0, 19);
  assert.ok(top <= 52.5);
  assert.ok(bottom >= 47.5);
});

test("shouldMergeProBoxes requires mid proximity", () => {
  const a = { top: 110, bottom: 90, leftTime: 100, rightTime: 200 };
  const b = { top: 110, bottom: 90, leftTime: 150, rightTime: 250 };
  const far = { top: 110, bottom: 90, leftTime: 100, rightTime: 200 };
  const c = { top: 160, bottom: 140, leftTime: 150, rightTime: 250 };
  assert.equal(shouldMergeProBoxes(a, b, 86400), true);
  assert.equal(shouldMergeProBoxes(far, c, 86400), false);
  assert.ok(midDistancePct(110, 90, 160, 140) > 1.5);
});

test("detectBoxRangesProOnCandles returns multiple on long ranging series", () => {
  const bars = rangingBars(80);
  const zones = detectBoxRangesProOnCandles(bars, "1d", 3);
  assert.ok(zones.length >= 1);
});

test("countRejections on flat bars has no false top rejects", () => {
  const bars = flatBars(10);
  const { top, bottom } = computeBoxFromSlice(bars, 0, 9);
  const { topReject } = countRejections(bars, 0, 9, top, bottom);
  assert.equal(topReject, 0);
});
