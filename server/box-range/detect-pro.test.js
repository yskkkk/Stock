import test from "node:test";
import assert from "node:assert/strict";
import { detectBoxRangeProAt } from "./detect-pro.js";

function flatBars(n, price = 100, spread = 2) {
  /** @type {import("./detect-pro.js").Bar[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      time: 1_700_000_000 + i * 86400,
      open: price,
      high: price + spread / 2,
      low: price - spread / 2,
      close: price,
    });
  }
  return out;
}

test("detectBoxRangeProAt finds tight range", () => {
  const bars = flatBars(30, 100, 2);
  const hit = detectBoxRangeProAt(bars, bars.length - 2, "1d");
  assert.ok(hit);
  assert.ok(hit.box.top >= hit.box.bottom);
});

test("detectBoxRangeProAt rejects short series anchor", () => {
  const bars = flatBars(5);
  assert.equal(detectBoxRangeProAt(bars, 3, "1d"), null);
});
