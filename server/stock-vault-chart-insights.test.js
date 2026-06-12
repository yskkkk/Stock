import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTimeframeChartInsight,
  detectMaApproach,
  detectMaProximity,
  detectMaTrend,
} from "./stock-vault-chart-insights.js";

/** @param {number} n @param {number} step */
function candles(n, step = 0.5) {
  return Array.from({ length: n }, (_, i) => ({ close: 100 + i * step }));
}

test("detectMaTrend — up when MA5>20>60", () => {
  assert.equal(detectMaTrend(candles(140, 1)), "up");
});

test("detectMaTrend — down when MA5<20<60", () => {
  assert.equal(detectMaTrend(candles(140, -1)), "down");
});

test("detectMaApproach — from_below when rising toward MA", () => {
  assert.equal(
    detectMaApproach(98, 95, 100, 2, 5),
    "from_below",
  );
});

test("detectMaApproach — from_above when falling toward MA", () => {
  assert.equal(
    detectMaApproach(102, 105, 100, 2, 5),
    "from_above",
  );
});

test("detectMaApproach — side fallback when not getting closer", () => {
  assert.equal(
    detectMaApproach(98, 97, 100, 2, 2.1),
    "from_below",
  );
  assert.equal(
    detectMaApproach(102, 103, 100, 2, 2.1),
    "from_above",
  );
});

test("buildTimeframeChartInsight — includes trend and near hits", () => {
  const flat = Array.from({ length: 140 }, () => ({ close: 50 }));
  const insight = buildTimeframeChartInsight(flat, 50.2);
  assert.equal(insight.trend, "neutral");
  assert.ok(Array.isArray(insight.near));
});

test("detectMaProximity — flags flat series near MA", () => {
  const flat = Array.from({ length: 140 }, () => ({ close: 50 }));
  const result = detectMaProximity(flat, 50.3, { proximityPct: 2 });
  assert.ok(result.near.length >= 1);
  assert.ok(result.near[0].approach);
});
