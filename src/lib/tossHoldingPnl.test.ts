import { describe, expect, it } from "vitest";
import type { TossTestHolding } from "../api";
import {
  computeTossAccountCombinedPnl,
  computeTossHoldingsDisplayPnl,
  tossHoldingNetReturnPercent,
  tossHoldingNetUnrealizedPnl,
  tossHoldingsNetProfitLossKrw,
  tossHoldingsNetReturnPct,
  tossHoldingsTotalNetMarketValueKrw,
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
  it("subtracts full round-trip fee (0.2%) from market value for PnL", () => {
    const pnl = tossHoldingNetUnrealizedPnl(krHolding, 0.002);
    expect(pnl).toBe(Math.round(1_100_000 * 0.998) - 1_000_000);
  });

  it("computes net return percent from cost and gross market value", () => {
    const pct = tossHoldingNetReturnPercent(krHolding, 0.002);
    expect(
      pnlClose(pct, ((1_100_000 * 0.998 - 1_000_000) / 1_000_000) * 100),
    ).toBe(true);
  });

  it("aggregates net return across holdings", () => {
    const pct = tossHoldingsNetReturnPct([krHolding], null, 0.002);
    expect(pct).not.toBeNull();
    expect(pct!).toBeLessThan(10);
    expect(pct!).toBeGreaterThan(9);
  });

  it("aggregates net market value in KRW across holdings", () => {
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
    const total = tossHoldingsTotalNetMarketValueKrw(
      [krHolding, usHolding],
      null,
      1400,
      0.002,
    );
    expect(total).not.toBeNull();
    const krNet = Math.round(1_100_000 * 0.998);
    const usNet = Math.round(3_300 * 0.998 * 100) / 100;
    expect(total).toBe(Math.round(krNet + usNet * 1400));
  });

  it("keeps USD net market value to 2 decimal places", async () => {
    const { tossHoldingNetMarketValue } = await import("./tossHoldingPnl");
    const usHolding: TossTestHolding = {
      symbol: "GOOGL",
      name: "Alphabet",
      market: "us",
      currency: "USD",
      quantity: 14,
      avgBuyPrice: 100,
      currentPrice: 355.785714,
      marketValue: 14 * 355.785714,
    };
    const net = tossHoldingNetMarketValue(usHolding, 0.002);
    expect(net).not.toBeNull();
    expect(Number.isInteger(net!)).toBe(false);
    expect(Math.round(net! * 100) / 100).toBe(net);
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

  it("includes FX gain when purchase FX differs from current FX", () => {
    const usHolding: TossTestHolding = {
      symbol: "AAPL",
      name: "Apple",
      market: "us",
      currency: "USD",
      quantity: 10,
      avgBuyPrice: 100,
      currentPrice: 100,
      marketValue: 1000,
    };
    const buyFx = new Map([["AAPL", 1420]]);
    const pnl = tossHoldingsNetProfitLossKrw([usHolding], 1440, 0, buyFx);
    expect(pnl).toBe(20_000);
  });

  it("USD display mode uses native dollar cost without FX", () => {
    const usHolding: TossTestHolding = {
      symbol: "AAPL",
      name: "Apple",
      market: "us",
      currency: "USD",
      quantity: 10,
      avgBuyPrice: 100,
      purchaseAmount: 1000,
      currentPrice: 110,
      marketValue: 1100,
    };
    const buyFx = new Map([["AAPL", 1420]]);
    const usd = computeTossHoldingsDisplayPnl([usHolding], 1440, 0, buyFx, "USD");
    expect(usd.pnl).toBe(100);
    const krw = computeTossHoldingsDisplayPnl([usHolding], 1440, 0, buyFx, "KRW");
    // netMv 1100*1440 - cost 1000*1420 = 1,584,000 - 1,420,000 = 164,000
    expect(krw.pnl).toBe(164_000);
  });
});

function pnlClose(a: number | null, b: number, eps = 0.01): boolean {
  return a != null && Math.abs(a - b) < eps;
}
