import assert from "node:assert/strict";
import test from "node:test";
import { detectWeeklyMaProximity } from "./stock-vault-weekly-ma-proximity.js";

/** @param {number} n @param {number} base */
function weeklyCandles(n, base = 100) {
  return Array.from({ length: n }, (_, i) => ({ close: base + i * 0.1 }));
}

test("detectWeeklyMaProximity — flags price near weekly MA20", () => {
  const candles = weeklyCandles(140, 100);
  const lastMa20 = 100 + (139 - 19) * 0.1 + (0.1 * 19) / 2;
  const result = detectWeeklyMaProximity(candles, lastMa20, { proximityPct: 2 });
  assert.ok(result.near.some((h) => h.period === 20));
});

test("detectWeeklyMaProximity — empty when price far from MAs", () => {
  const candles = weeklyCandles(140, 100);
  const result = detectWeeklyMaProximity(candles, 200, { proximityPct: 1 });
  assert.equal(result.near.length, 0);
});

test("detectWeeklyMaProximity — can match multiple periods", () => {
  const candles = Array.from({ length: 140 }, () => ({ close: 50 }));
  const result = detectWeeklyMaProximity(candles, 50.2, { proximityPct: 2 });
  assert.ok(result.near.length >= 1);
  assert.ok(result.near.every((h) => h.side === "above"));
});
