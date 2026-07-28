import { describe, expect, it } from "vitest";
import {
  accountSymbolSliceLabel,
  buildAccountAllocationSlices,
  classifyAccountHoldingStyle,
  tossHoldingsToAccountRows,
} from "./accountAllocation";

describe("accountAllocation symbol labels", () => {
  it("uses mapped Korean name in symbol mode legend", () => {
    const rows = tossHoldingsToAccountRows(
      [
        {
          symbol: "000120.KS",
          name: "000120.KS",
          market: "kr",
          currency: "KRW",
          quantity: 10,
          avgBuyPrice: 1000,
          currentPrice: 1050,
          returnPercent: 5,
        },
      ],
      null,
      null,
      new Map(),
    );
    expect(rows[0]?.name).toBe("CJ대한통운");
    expect(rows[0]?.unrealizedPnlKrw).not.toBeNull();
    const slices = buildAccountAllocationSlices(rows, 0, "symbol", {
      cash: "현금",
      other: "기타",
      marketKr: "국내",
      marketUs: "해외",
      marketCrypto: "코인",
    });
    expect(slices[0]?.label).toBe("000120.KS · CJ대한통운");
  });

  it("formats US mapped Korean names with ticker", () => {
    const label = accountSymbolSliceLabel(
      { symbol: "VRSK", name: "Verisk Analytics, Inc.", market: "us" },
      "기타",
    );
    expect(label).toBe("VRSK · 베리스크");
  });
});

describe("accountAllocation style mode", () => {
  it("splits growth / value / cash", () => {
    const rows = [
      {
        symbol: "AAPL",
        name: "Apple",
        market: "us" as const,
        quantity: 1,
        valueKrw: 400,
        returnPercent: null,
        unrealizedPnlKrw: null,
        industry: null,
        subIndustry: null,
        sectorEn: "Information Technology",
        sectorKo: "정보기술",
      },
      {
        symbol: "XOM",
        name: "Exxon",
        market: "us" as const,
        quantity: 1,
        valueKrw: 300,
        returnPercent: null,
        unrealizedPnlKrw: null,
        industry: null,
        subIndustry: null,
        sectorEn: "Energy",
        sectorKo: "에너지",
      },
      {
        symbol: "005930.KS",
        name: "삼성전자",
        market: "kr" as const,
        quantity: 1,
        valueKrw: 200,
        returnPercent: null,
        unrealizedPnlKrw: null,
        industry: "반도체",
        subIndustry: "반도체",
        sectorEn: null,
        sectorKo: null,
      },
    ];
    const slices = buildAccountAllocationSlices(rows, 100, "style", {
      cash: "현금",
      other: "기타",
      marketKr: "국내",
      marketUs: "해외",
      marketCrypto: "코인",
      styleGrowth: "성장주",
      styleValue: "가치·방어주",
    });
    expect(slices.map((s) => s.key)).toEqual([
      "__growth__",
      "__value__",
      "__cash__",
    ]);
    expect(slices.find((s) => s.key === "__growth__")?.valueKrw).toBe(600);
    expect(slices.find((s) => s.key === "__value__")?.valueKrw).toBe(300);
    expect(slices.find((s) => s.key === "__cash__")?.valueKrw).toBe(100);
  });

  it("treats GOOGL / IQQ / ITA as growth even if Industrials or no GICS", () => {
    expect(
      classifyAccountHoldingStyle({
        symbol: "GOOGL",
        name: "Alphabet",
        market: "us",
        sectorEn: "Communication Services",
        sectorKo: null,
        industry: null,
        subIndustry: null,
      }),
    ).toBe("growth");
    expect(
      classifyAccountHoldingStyle({
        symbol: "IQQ",
        name: "IQQ",
        market: "us",
        sectorEn: null,
        sectorKo: null,
        industry: null,
        subIndustry: null,
      }),
    ).toBe("growth");
    expect(
      classifyAccountHoldingStyle({
        symbol: "ITA",
        name: "iShares U.S. Aerospace & Defense ETF",
        market: "us",
        sectorEn: "Industrials",
        sectorKo: null,
        industry: "Aerospace & Defense",
        subIndustry: "Aerospace & Defense",
      }),
    ).toBe("growth");
  });
});
