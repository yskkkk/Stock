import assert from "node:assert/strict";
import test from "node:test";
import { deriveValueInvestGrowth10y, GROWTH_10Y_CAP } from "./value-invest-growth.js";

test("caps absurd forward/trailing as 10y growth (Samsung-like)", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 12372,
    forwardEps: 43833,
    revenueGrowth: null,
  });
  assert.equal(r.value, GROWTH_10Y_CAP);
  assert.ok(r.warnings.some((w) => w.includes("10년")));
});

test("uses historical CAGR when available", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 8,
    forwardEps: 9,
    revenueGrowth: null,
    epsHistory: [
      { year: 2022, eps: 6 },
      { year: 2023, eps: 6.5 },
      { year: 2024, eps: 7 },
      { year: 2025, eps: 7.5 },
    ],
  });
  assert.ok(r.value != null);
  assert.ok(r.value < 0.15);
  assert.match(r.source ?? "", /CAGR/);
});
