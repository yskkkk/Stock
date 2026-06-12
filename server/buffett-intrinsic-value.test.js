import assert from "node:assert/strict";
import test from "node:test";
import {
  calcExplicitPhasePv,
  calcFullIntrinsic,
  calcSimpleFairPrice,
  calcTerminalPv,
} from "./buffett-intrinsic-value.js";

test("calcSimpleFairPrice EPS/r", () => {
  assert.equal(calcSimpleFairPrice(2.5, 0.06), 2.5 / 0.06);
});

test("table 9-3 uniform 10k x5 at 15%", () => {
  const r = calcExplicitPhasePv(10_000, 0, 5, 0.15);
  assert.ok(r);
  assert.ok(Math.abs(r.totalPv - 33_522) < 2);
});

test("table 9-4 McDonald's style intrinsic", () => {
  const explicit = calcExplicitPhasePv(2.5, 0.12, 10, 0.1);
  assert.ok(explicit);
  assert.ok(Math.abs(explicit.epsAtEnd - 2.5 * 1.12 ** 10) < 0.15);
  const term = calcTerminalPv(explicit.epsAtEnd, 0.05, 10, 0.1);
  assert.ok(term);
  const full = calcFullIntrinsic({
    eps0: 2.5,
    growth10y: 0.12,
    growthTerminal: 0.05,
    years: 10,
    discountRate: 0.1,
    debtPerShare: 6,
  });
  assert.ok(full?.intrinsicPerShare);
  assert.ok(full.intrinsicPerShare != null);
  assert.ok(Math.abs(full.intrinsicPerShare - 84.51) < 4);
});
