import { describe, expect, it } from "vitest";
import {
  mergeLiveQuotesIntoTossSnapshot,
  mergeTossLedgerPreserveLiveQuotes,
} from "./tossSnapshotLiveQuotes";
import type { TossTestSnapshot } from "../api";

const base: TossTestSnapshot = {
  cash: { krw: 50_000, usd: 10 },
  summary: { profitLossKrw: 1000 },
  holdings: [
    {
      symbol: "005930.KS",
      rawSymbol: "005930",
      name: "삼성전자",
      market: "kr",
      currency: "KRW",
      quantity: 10,
      avgBuyPrice: 70_000,
      currentPrice: 71_000,
      marketValue: 710_000,
      returnPercent: 1.43,
    },
  ],
};

describe("mergeLiveQuotesIntoTossSnapshot", () => {
  it("recomputes profitLossKrw from live price", () => {
    const out = mergeLiveQuotesIntoTossSnapshot(
      base,
      { "005930.KS": { price: 72_000, changePercent: 0.5 } },
      null,
    );
    expect(out.holdings[0]?.currentPrice).toBe(72_000);
    expect(out.summary?.profitLossKrw).toBe(20_000);
    expect(out.summary?.totalReturnPct).toBeCloseTo((20_000 / 700_000) * 100, 4);
  });

  it("converts USD unrealized into KRW total", () => {
    const us: TossTestSnapshot = {
      ...base,
      holdings: [
        {
          symbol: "AAPL",
          rawSymbol: "AAPL",
          name: "Apple",
          market: "us",
          currency: "USD",
          quantity: 2,
          avgBuyPrice: 100,
          currentPrice: 100,
          marketValue: 200,
        },
      ],
    };
    const out = mergeLiveQuotesIntoTossSnapshot(
      us,
      { AAPL: { price: 110 } },
      1300,
    );
    expect(out.summary?.profitLossKrw).toBe(20 * 1300);
  });
});

describe("mergeTossLedgerPreserveLiveQuotes", () => {
  it("keeps live prices when ledger cash updates", () => {
    const live = mergeLiveQuotesIntoTossSnapshot(
      base,
      { "005930.KS": { price: 72_000 } },
      null,
    );
    const ledger: TossTestSnapshot = {
      ...base,
      cash: { krw: 60_000, usd: 10 },
    };
    const merged = mergeTossLedgerPreserveLiveQuotes(ledger, live);
    expect(merged.cash.krw).toBe(60_000);
    expect(merged.holdings[0]?.currentPrice).toBe(72_000);
  });
});
