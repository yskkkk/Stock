import { describe, expect, it } from "vitest";
import type { LiveTradeHolding, LiveTradeRecord } from "../api";
import {
  holdingGrossReturnPctFromCost,
  holdingNetReturnPctFromCost,
  holdingReturnPctForDisplay,
  programOpenReturnFromNetAndCost,
  resolvedHoldingCostBasis,
} from "./livePortfolioPnl";

const holding = (
  partial: Partial<LiveTradeHolding> & Pick<LiveTradeHolding, "symbol">,
): LiveTradeHolding => ({
  programId: "p1",
  name: partial.symbol,
  market: "crypto",
  quantity: 1,
  avgEntryPrice: 19_600,
  costBasis: 19_600,
  currentPrice: 20_000,
  marketValue: 20_000,
  unrealizedPnl: 400,
  changePct: 2.18,
  currency: "KRW",
  openedAtMs: 1,
  lastAtMs: 1,
  ...partial,
});

describe("holding return from cost basis", () => {
  it("is negative when net valuation is below purchase", () => {
    const gross = holdingGrossReturnPctFromCost(20_000, 19_998);
    const net = holdingNetReturnPctFromCost(20_000, 19_998, 0.002);
    expect(gross).not.toBeNull();
    expect(gross!).toBeLessThan(0);
    expect(net).not.toBeNull();
    expect(net!).toBeLessThan(0);
  });

  it("display return uses net valuation vs cost, not 24h changePct", () => {
    const h = holding({
      symbol: "SOL-USDT",
      costBasis: 20_040,
      marketValue: 19_998,
      changePct: 2.18,
    });
    const pct = holdingReturnPctForDisplay(h, () => 0.002);
    expect(pct).not.toBeNull();
    expect(pct!).toBeLessThan(0);
    expect(pct).not.toBeCloseTo(2.18, 1);
  });

  it("prefers buy trade cost when ledger understates spend", () => {
    const h = holding({ symbol: "SOL-USDT", costBasis: 19_600, marketValue: 19_998 });
    const trades: LiveTradeRecord[] = [
      {
        id: "t1",
        programId: "p1",
        side: "buy",
        symbol: "SOL-USDT",
        name: "SOL",
        market: "crypto",
        quantity: 1,
        price: 20_000,
        amount: 20_000,
        feeAmount: 40,
        currency: "KRW",
        atMs: 1,
      },
    ];
    expect(resolvedHoldingCostBasis(h, trades)).toBe(20_040);
    const pct = holdingReturnPctForDisplay(h, () => 0.002, trades);
    expect(pct).not.toBeNull();
    expect(pct!).toBeLessThan(0);
  });

  it("program total matches sum of net vs resolved cost", () => {
    const holdings = [
      holding({ symbol: "SOL-USDT", costBasis: 19_600, marketValue: 19_998 }),
      holding({ symbol: "WLD-USDT", costBasis: 19_600, marketValue: 19_900 }),
    ];
    const trades: LiveTradeRecord[] = [
      {
        id: "t1",
        programId: "p1",
        side: "buy",
        symbol: "SOL-USDT",
        name: "SOL",
        market: "crypto",
        quantity: 1,
        price: 20_000,
        amount: 20_000,
        feeAmount: 40,
        currency: "KRW",
        atMs: 1,
      },
      {
        id: "t2",
        programId: "p1",
        side: "buy",
        symbol: "WLD-USDT",
        name: "WLD",
        market: "crypto",
        quantity: 1,
        price: 20_000,
        amount: 20_000,
        feeAmount: 40,
        currency: "KRW",
        atMs: 2,
      },
    ];
    const total = programOpenReturnFromNetAndCost(holdings, trades, () => 0.002);
    expect(total).not.toBeNull();
    expect(total!).toBeLessThan(0);
  });
});
