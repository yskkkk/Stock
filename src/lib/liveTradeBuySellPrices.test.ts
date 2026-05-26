import { describe, expect, it } from "vitest";
import { tradeFillDisplayByTradeId } from "./liveTradeBuySellPrices";
import type { LiveTradeRecord } from "../api";

function trade(
  partial: Partial<LiveTradeRecord> & Pick<LiveTradeRecord, "id" | "side" | "quantity" | "price" | "amount">,
): LiveTradeRecord {
  return {
    programId: "p1",
    symbol: "BTC-USDT",
    name: "BTC",
    market: "crypto",
    currency: "KRW",
    feeAmount: 0,
    simulated: true,
    orderId: null,
    note: null,
    atMs: 1,
    ...partial,
  };
}

describe("tradeFillDisplayByTradeId", () => {
  it("shows loss when sell below avg buy (ignores sell entryPrice)", () => {
    const buy = trade({
      id: "b1",
      side: "buy",
      quantity: 0.01,
      price: 100_000_000,
      amount: 1_000_000,
      atMs: 1000,
    });
    const sell = trade({
      id: "s1",
      side: "sell",
      quantity: 0.01,
      price: 90_000_000,
      amount: 900_000,
      entryPrice: 80_000_000,
      atMs: 2000,
    });
    const fd = tradeFillDisplayByTradeId([buy, sell]).get("s1");
    expect(fd?.realizedPnl).not.toBeNull();
    expect(fd!.realizedPnl!).toBeLessThan(0);
    expect(fd?.buyPrice).toBe(100_000_000);
  });

  it("apportions sell fee on partial quantity", () => {
    const buy = trade({
      id: "b1",
      side: "buy",
      quantity: 1,
      price: 100,
      amount: 100,
      atMs: 1,
    });
    const sell = trade({
      id: "s1",
      side: "sell",
      quantity: 0.5,
      price: 80,
      amount: 40,
      feeAmount: 1,
      atMs: 2,
    });
    const fd = tradeFillDisplayByTradeId([buy, sell]).get("s1");
    expect(fd?.realizedPnl).toBeCloseTo(0.5 * 80 - 1 - 50, 6);
  });
});
