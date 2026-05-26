import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nearestBoxLevelWithinPct } from "./catalog-scan-telegram.js";

describe("nearestBoxLevelWithinPct", () => {
  it("matches mid within 1%", () => {
    const hit = nearestBoxLevelWithinPct(100.5, {
      mid: 100,
      top: 110,
      bottom: 90,
    }, 1);
    assert.equal(hit?.label, "중심");
    assert.ok(hit.pct < 1);
  });

  it("rejects when all levels far", () => {
    const hit = nearestBoxLevelWithinPct(120, {
      mid: 100,
      top: 110,
      bottom: 90,
    }, 1);
    assert.equal(hit, null);
  });
});
