import test from "node:test";
import assert from "node:assert/strict";
import { detectBoxRangeOnCandles } from "./detect.js";

function flatBars(n, price = 100, spread = 2) {
  /** @type {import("./detect.js").Bar[]} */
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

test("detectBoxRangeOnCandles finds tight range with touches", () => {
  const bars = flatBars(30, 100, 2);
  // Pine은 박스 '종료' 시에만 저장(completedOnly) — 마지막 봉에서 이탈
  const last = bars.length - 2;
  bars[last] = {
    ...bars[last],
    high: 130,
    low: 120,
    close: 125,
  };
  const hit = detectBoxRangeOnCandles(bars, "1d");
  assert.ok(hit);
  assert.ok(hit.top >= hit.bottom);
  assert.equal(hit.mid, (hit.top + hit.bottom) / 2);
});

test("detectBoxRangeOnCandles returns null on short series", () => {
  assert.equal(detectBoxRangeOnCandles(flatBars(5), "1d"), null);
});
