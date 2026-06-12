import { describe, expect, it } from "vitest";
import type { TossTestHolding } from "../api";
import {
  computeTossAccountCombinedPnl,
  tossHoldingNetReturnPercent,
  tossHoldingNetUnrealizedPnl,
  tossHoldingsNetReturnPct,
} from "./tossHoldingPnl";

const krHolding: TossTestHolding = {
  symbol: "005930.KS",
  name: "삼성전자",
  market: "kr",
  currency: "KRW",
  quantity: 10,
  avgBuyPrice: 100_000,
  currentPrice: 110_000,
  marketValue: 1_100_000,
};

describe("tossHoldingPnl", () => {
  it("subtracts half round-trip fee from market value for PnL", () => {
    const pnl = tossHoldingNetUnrealizedPnl(krHolding, 0.002);
    expect(pnl).toBe(1_098_900 - 1_000_000);
  });

  it("computes net return percent from cost and gross market value", () => {
    const pct = tossHoldingNetReturnPercent(krHolding, 0.002);
    expect(pnlClose(pct, ((1_100_000 * 0.999 - 1_000_000) / 1_000_000) * 100)).toBe(true);
  });

  it("aggregates net return across holdings", () => {
    const pct = tossHoldingsNetReturnPct([krHolding], null, 0.002);
    expect(pct).not.toBeNull();
    expect(pct!).toBeLessThan(10);
    expect(pct!).toBeGreaterThan(9);
  });

  it("combines KRW and USD account PnL via FX", () => {
    const usHolding: TossTestHolding = {
      symbol: "IONL",
      name: "IONL",
      market: "us",
      currency: "USD",
      quantity: 100,
      avgBuyPrice: 30,
      currentPrice: 33,
      marketValue: 3300,
    };
    const combined = computeTossAccountCombinedPnl(
      [krHolding, usHolding],
      { profitLossKrw: 100_000, profitLossUsd: 300 },
      1300,
      0,
    );
    expect(combined.profitLossKrw).toBe(100_000 + 300 * 1300);
    expect(combined.totalReturnPct).not.toBeNull();
  });
});

function pnlClose(a: number | null, b: number, eps = 0.01): boolean {
  return a != null && Math.abs(a - b) < eps;
}
