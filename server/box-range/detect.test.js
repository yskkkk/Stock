import { test } from "vitest";
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

test("detectBoxRangeOnCandles PRO 1h finds ranging box", () => {
  const bars = [];
  const t0 = 1_700_000_000;
  for (let i = 0; i < 80; i++) {
    const atTop = i % 6 < 3;
    const mid = 100;
    bars.push(
      atTop
        ? {
            time: t0 + i * 3600,
            open: mid + 1.1,
            high: mid + 1.8,
            low: mid - 0.2,
            close: mid - 0.6,
            volume: 1000,
          }
        : {
            time: t0 + i * 3600,
            open: mid - 1.1,
            high: mid + 0.2,
            low: mid - 1.8,
            close: mid + 0.6,
            volume: 1000,
          },
    );
  }
  const hit = detectBoxRangeOnCandles(bars, "1h");
  assert.ok(hit);
  assert.ok(hit.mid >= hit.bottom && hit.mid <= hit.top);
});

test("detectBoxRangeOnCandles PRO 1d finds ranging box", () => {
  const hit = detectBoxRangeOnCandles(rangingBars(30), "1d");
  assert.ok(hit);
  assert.ok(hit.mid >= hit.bottom && hit.mid <= hit.top);
});

test("detectBoxRangeOnCandles returns null on short series", () => {
  assert.equal(detectBoxRangeOnCandles(flatBars(5), "1d"), null);
});
