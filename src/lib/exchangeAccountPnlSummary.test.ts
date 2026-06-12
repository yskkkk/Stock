import { describe, expect, it } from "vitest";
import { exchangeAccountPnlSummary } from "./exchangeAccountPnlSummary";
import type { LiveTradeHolding, LiveTradeRecord } from "../api";

function trade(
  partial: Partial<LiveTradeRecord> & Pick<LiveTradeRecord, "side" | "symbol" | "quantity" | "amount">,
): LiveTradeRecord {
  return {
    id: partial.id ?? "t1",
    programId: "toss-exchange",
    side: partial.side,
    symbol: partial.symbol,
    name: partial.name ?? partial.symbol,
    market: partial.market ?? "kr",
    quantity: partial.quantity,
    price: partial.price ?? partial.amount / partial.quantity,
    amount: partial.amount,
    currency: partial.currency ?? "KRW",
    feeAmount: partial.feeAmount ?? 0,
    simulated: false,
    orderId: null,
    note: null,
    atMs: partial.atMs ?? 1,
    ...partial,
  };
}

function holding(partial: Partial<LiveTradeHolding> & Pick<LiveTradeHolding, "symbol">): LiveTradeHolding {
  return {
    programId: "toss-account",
    name: partial.name ?? partial.symbol,
    market: partial.market ?? "kr",
    quantity: partial.quantity ?? 1,
    avgEntryPrice: partial.avgEntryPrice ?? 100,
    costBasis: partial.costBasis ?? 100,
    currentPrice: partial.currentPrice ?? 110,
    marketValue: partial.marketValue ?? 110,
    unrealizedPnl: partial.unrealizedPnl ?? 10,
    changePct: partial.changePct ?? 10,
    currency: partial.currency ?? "KRW",
    openedAtMs: 1,
    lastAtMs: 1,
    ...partial,
  };
}

describe("exchangeAccountPnlSummary", () => {
  it("computes account total and per-symbol cumulative return", () => {
    const trades = [
      trade({ id: "b1", side: "buy", symbol: "A", quantity: 10, amount: 1000, atMs: 1 }),
      trade({
        id: "s1",
        side: "sell",
        symbol: "A",
        quantity: 5,
        amount: 600,
        atMs: 2,
      }),
    ];
    const holdings = [
      holding({
        symbol: "A",
        quantity: 5,
        costBasis: 500,
        marketValue: 550,
        unrealizedPnl: 50,
      }),
    ];
    const out = exchangeAccountPnlSummary(trades, holdings);
    const sym = out.bySymbol.get("kr:A");
    expect(sym?.realizedPnl).toBe(100);
    expect(sym?.unrealizedPnl).toBe(50);
    expect(sym?.totalReturnPct).toBeCloseTo(15, 4);
    expect(out.totalReturnPct).toBeCloseTo(15, 4);
  });
});
