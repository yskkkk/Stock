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

function rangingBars(n) {
  /** @type {import("./detect.js").Bar[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    const atTop = i % 6 < 3;
    out.push(
      atTop
        ? {
            time: 1_700_000_000 + i * 86400,
            open: 102,
            high: 104,
            low: 99,
            close: 99.2,
            volume: 1000,
          }
        : {
            time: 1_700_000_000 + i * 86400,
            open: 98,
            high: 101,
            low: 96,
            close: 100.8,
            volume: 1000,
          },
    );
  }
  return out;
}

test("detectBoxRangeOnCandles pine 1h finds range after break", () => {
  const bars = flatBars(30, 100, 2);
  const last = bars.length - 2;
  bars[last] = {
    ...bars[last],
    high: 130,
    low: 120,
    close: 125,
  };
  const hit = detectBoxRangeOnCandles(bars, "1h");
  assert.ok(hit);
  assert.ok(hit.top >= hit.bottom);
});

test("detectBoxRangeOnCandles PRO 1d finds ranging box", () => {
  const hit = detectBoxRangeOnCandles(rangingBars(30), "1d");
  assert.ok(hit);
  assert.ok(hit.mid >= hit.bottom && hit.mid <= hit.top);
});

test("detectBoxRangeOnCandles returns null on short series", () => {
  assert.equal(detectBoxRangeOnCandles(flatBars(5), "1d"), null);
});
