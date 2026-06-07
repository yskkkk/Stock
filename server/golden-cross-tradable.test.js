import { test } from "vitest";
import assert from "node:assert/strict";
import {
  assessGoldenCrossTradable,
  candleDayAgeDays,
  GOLDEN_CROSS_MIN_CANDLES,
} from "./golden-cross-tradable.js";

const NOW = Date.UTC(2026, 4, 29);

function makeCandles(count, lastDay = { year: 2026, month: 5, day: 28 }) {
  /** @type {{ close: number; time: { year: number; month: number; day: number } }[]} */
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ close: 100 + i * 0.01, time: lastDay });
  }
  return out;
}

test("candleDayAgeDays parses KST calendar day object", () => {
  const age = candleDayAgeDays({ year: 2026, month: 5, day: 20 }, NOW);
  assert.ok(Number.isFinite(age) && age >= 8 && age <= 10);
});

test("assessGoldenCrossTradable rejects delisted-like empty chart", () => {
  const r = assessGoldenCrossTradable(
    { candles: [], quote: { price: undefined, currency: null } },
    "us",
    { nowMs: NOW },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "insufficient_candles");
});

test("assessGoldenCrossTradable rejects stale last bar", () => {
  const r = assessGoldenCrossTradable(
    {
      candles: makeCandles(GOLDEN_CROSS_MIN_CANDLES, {
        year: 2026,
        month: 1,
        day: 10,
      }),
      quote: { price: 100, currency: "USD" },
    },
    "us",
    { nowMs: NOW, maxBarAgeDays: 21 },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "stale_last_bar");
});

test("assessGoldenCrossTradable accepts active symbol", () => {
  const r = assessGoldenCrossTradable(
    {
      candles: makeCandles(GOLDEN_CROSS_MIN_CANDLES),
      quote: { price: 100, currency: "USD" },
    },
    "us",
    { nowMs: NOW },
  );
  assert.equal(r.ok, true);
});

test("assessGoldenCrossTradable rejects KR without Naver quote", () => {
  const prev = process.env.KR_NAVER_QUOTE;
  process.env.KR_NAVER_QUOTE = "1";
  try {
    const r = assessGoldenCrossTradable(
      {
        candles: makeCandles(GOLDEN_CROSS_MIN_CANDLES),
        quote: { symbol: "005930.KS", price: 100, currency: "KRW" },
      },
      "kr",
      { nowMs: NOW, naverPrice: null },
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "kr_naver_unavailable");
  } finally {
    if (prev == null) delete process.env.KR_NAVER_QUOTE;
    else process.env.KR_NAVER_QUOTE = prev;
  }
});
