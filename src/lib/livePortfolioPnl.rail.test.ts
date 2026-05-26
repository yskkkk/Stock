import { describe, expect, it } from "vitest";
import type { LiveTradeHolding } from "../api";
import {
  holdingNetMarketValue,
  summarizeHoldingsPnl,
  summarizeNetMarketByCurrency,
} from "./livePortfolioPnl";

const holding: LiveTradeHolding = {
  programId: "p1",
  symbol: "SOL-USDT",
  name: "SOL",
  market: "crypto",
  quantity: 1,
  avgEntryPrice: 9000,
  costBasis: 9000,
  currentPrice: 10000,
  marketValue: 10000,
  unrealizedPnl: 1000,
  changePct: 10,
  currency: "KRW",
  openedAtMs: 1,
  lastAtMs: 1,
};

describe("rail portfolio metrics", () => {
  it("net market total is below gross market total", () => {
    const gross = summarizeHoldingsPnl([holding]).marketByCurrency.KRW ?? 0;
    const net = summarizeNetMarketByCurrency([holding], () => 0.001).KRW ?? 0;
    const feeHalf = 0.0005;
    expect(net).toBe(Math.round(10000 * (1 - feeHalf)));
    expect(net).toBeLessThan(gross);
  });
});
