import assert from "node:assert/strict";
import { test } from "vitest";
import { parseTossFilledOrderForHistory } from "./live-trade-toss-exchange-trades.js";

test("parseTossFilledOrderForHistory maps filled KR buy", () => {
  const row = parseTossFilledOrderForHistory({
    orderId: "ord-1",
    symbol: "005930",
    side: "BUY",
    marketCountry: "KR",
    currency: "KRW",
    orderedAt: "2026-06-01T10:00:00+09:00",
    execution: {
      filledQuantity: "10",
      averageFilledPrice: "70000",
      filledAmount: "700000",
      commission: "1400",
      filledAt: "2026-06-01T10:01:00+09:00",
    },
  });
  assert.ok(row);
  assert.equal(row.symbol, "005930.KS");
  assert.equal(row.market, "kr");
  assert.equal(row.side, "buy");
  assert.equal(row.quantity, 10);
  assert.equal(row.price, 70000);
  assert.equal(row.amount, 700000);
});

test("parseTossFilledOrderForHistory skips zero fill", () => {
  const row = parseTossFilledOrderForHistory({
    orderId: "ord-2",
    symbol: "AAPL",
    side: "SELL",
    execution: { filledQuantity: "0" },
  });
  assert.equal(row, null);
});
