import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  isMa120NearHit,
  ma120NearDistancePct,
  MA120_NEAR_THRESHOLD_PCT,
} from "./ma120-near-scan.js";

describe("ma120-near-scan", () => {
  it("detects price within 3% of MA120", () => {
    assert.equal(isMa120NearHit({ price: 102, ma120: 100 }), true);
    assert.equal(isMa120NearHit({ price: 97, ma120: 100 }), true);
    assert.equal(isMa120NearHit({ price: 96, ma120: 100 }), false);
    assert.equal(isMa120NearHit({ price: 104, ma120: 100 }), false);
  });

  it("uses configured threshold pct", () => {
    assert.equal(
      isMa120NearHit({ price: 104, ma120: 100, thresholdPct: 5 }),
      true,
    );
  });

  it("computes distance pct", () => {
    assert.equal(ma120NearDistancePct(103, 100), 3);
    assert.equal(MA120_NEAR_THRESHOLD_PCT, 3);
  });
});
