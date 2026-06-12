import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTossOrderCreateBody,
  formatTossOrderPriceValue,
  sanitizeTossClientOrderId,
} from "./toss-order-body.js";

test("buildTossOrderCreateBody — KR limit buy matches openapi example shape", () => {
  const body = buildTossOrderCreateBody({
    symbol: "005930",
    market: "kr",
    side: "buy",
    orderType: "limit",
    quantity: 10,
    price: 70000,
    clientOrderId: "my-order-001",
  });
  assert.deepEqual(body, {
    clientOrderId: "my-order-001",
    symbol: "005930",
    side: "BUY",
    orderType: "LIMIT",
    quantity: "10",
    price: "70000",
  });
});

test("buildTossOrderCreateBody — US limit sell uses string price", () => {
  const body = buildTossOrderCreateBody({
    symbol: "NWSA",
    market: "us",
    side: "sell",
    orderType: "limit",
    quantity: 1,
    price: 25.6,
    clientOrderId: "manual-NWSA-sell-1",
  });
  assert.equal(body.side, "SELL");
  assert.equal(body.quantity, "1");
  assert.equal(body.price, "25.60");
  assert.equal(body.orderAmount, undefined);
  assert.equal(typeof body.price, "string");
});

test("buildTossOrderCreateBody — US market buy uses orderAmount", () => {
  const body = buildTossOrderCreateBody({
    symbol: "AAPL",
    market: "us",
    side: "buy",
    orderType: "market",
    amount: 100.5,
  });
  assert.deepEqual(body, {
    symbol: "AAPL",
    side: "BUY",
    orderType: "MARKET",
    orderAmount: "100.50",
  });
});

test("sanitizeTossClientOrderId trims to 36 chars", () => {
  const id = sanitizeTossClientOrderId("manual-005930.KS-buy-123456789012345678901234567890");
  assert.ok(id);
  assert.ok(id.length <= 36);
});

test("formatTossOrderPriceValue — US two decimals", () => {
  assert.equal(formatTossOrderPriceValue(57.8, "us"), "57.80");
});
