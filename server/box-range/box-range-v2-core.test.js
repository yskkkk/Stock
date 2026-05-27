import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { percentilePickRound } from "./box-range-v2-core.js";

describe("box-range-v2-core", () => {
  it("percentilePickRound matches Pine round-index behavior", () => {
    // Pine: idx = round(p*(n-1)) → p=80, n=3 → round(1.6)=2 → values[2]
    assert.equal(percentilePickRound([0, 10, 20], 80), 20);
    // p=20, n=3 → round(0.4)=0
    assert.equal(percentilePickRound([0, 10, 20], 20), 0);
  });
});

