import assert from "node:assert/strict";
import test from "node:test";
import { calcValueInvestReturn } from "./value-invest-return-model.js";

test("image.png example — $120, EPS $3.33, 15.2% growth, PER 17.7, payout 25%, target 15%, 10y", () => {
  const r = calcValueInvestReturn({
    currentPrice: 120,
    currentEps: 3.33,
    growthRate: 0.152,
    averagePer: 17.7,
    payoutRatio: 0.25,
    targetReturnRate: 0.15,
    years: 10,
  });
  assert.ok(r);
  assert.equal(r.yearlyEps.length, 10);
  assert.ok(Math.abs((r.totalEps ?? 0) - 78.66) < 0.05);
  assert.ok(Math.abs((r.futurePrice ?? 0) - 242.67) < 0.05);
  assert.ok(Math.abs((r.totalDividends ?? 0) - 19.67) < 0.05);
  assert.ok(Math.abs((r.totalReturn ?? 0) - 262.34) < 0.05);
  assert.ok(Math.abs((r.cagrPct ?? 0) - 8) < 0.15);
  assert.ok(Math.abs((r.fairBuyPrice ?? 0) - 64.85) < 0.05);
});
