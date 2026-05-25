import test from "node:test";
import assert from "node:assert/strict";
import { resolveBoxOpenLotFromTrades } from "./lot-reconcile.js";

test("resolveBoxOpenLotFromTrades — 잔여 수량·매입가", () => {
  const box = {
    boxId: "b1",
    programId: "p1",
    symbol: "BTC-USDT",
    buyTradeId: "buy-1",
    lotQty: 0,
    state: "in_position",
  };
  const trades = [
    {
      id: "buy-1",
      programId: "p1",
      side: "buy",
      symbol: "BTC-USDT",
      boxId: "b1",
      quantity: 0.01,
      price: 100_000_000,
      atMs: 1000,
    },
    {
      id: "sell-partial",
      programId: "p1",
      side: "sell",
      symbol: "BTC-USDT",
      boxId: "b1",
      quantity: 0.004,
      price: 101_000_000,
      atMs: 2000,
    },
  ];
  const lot = resolveBoxOpenLotFromTrades(
    /** @type {import("./store.js").BoxRangeRecord} */ (box),
    /** @type {import("../live-trade-portfolio-store.js").LiveTradeRecord[]} */ (
      trades
    ),
  );
  assert.ok(lot && !lot.closed);
  assert.equal(lot.quantity, 0.006);
  assert.equal(lot.entryPrice, 100_000_000);
});

test("resolveBoxOpenLotFromTrades — 전량 매도 시 closed", () => {
  const box = {
    boxId: "b2",
    programId: "p1",
    symbol: "ETH-USDT",
    buyTradeId: "buy-2",
    lotQty: 0.5,
    state: "in_position",
  };
  const trades = [
    {
      id: "buy-2",
      programId: "p1",
      side: "buy",
      symbol: "ETH-USDT",
      boxId: "b2",
      quantity: 0.5,
      price: 5_000_000,
      atMs: 1000,
    },
    {
      id: "sell-all",
      programId: "p1",
      side: "sell",
      symbol: "ETH-USDT",
      boxId: "b2",
      quantity: 0.5,
      price: 4_900_000,
      atMs: 3000,
    },
  ];
  const lot = resolveBoxOpenLotFromTrades(
    /** @type {import("./store.js").BoxRangeRecord} */ (box),
    /** @type {import("../live-trade-portfolio-store.js").LiveTradeRecord[]} */ (
      trades
    ),
  );
  assert.ok(lot?.closed);
  assert.equal(lot.quantity, 0);
});
