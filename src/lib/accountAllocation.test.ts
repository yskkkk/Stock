import { describe, expect, it } from "vitest";
import {
  accountSymbolSliceLabel,
  buildAccountAllocationSlices,
  classifyAccountHoldingStyle,
  portfolioShareChangePct,
  tossHoldingsToAccountRows,
} from "./accountAllocation";
import {
  resolveAccountHoldingStyle,
} from "../../shared/account-holding-style-policy.js";

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

describe("portfolioShareChangePct", () => {
  it("returns relative change of portfolio share vs cost share", () => {
    // cost share 40% → current 50% → +25%
    expect(portfolioShareChangePct(500, 400, 1000, 1000)).toBeCloseTo(25);
    expect(portfolioShareChangePct(300, 400, 1000, 1000)).toBeCloseTo(-25);
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
        costBasisKrw: null,
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
        costBasisKrw: null,
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
        costBasisKrw: null,
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

  it("user override beats seed and GICS", () => {
    const row = {
      symbol: "GOOGL",
      name: "Alphabet",
      market: "us" as const,
      sectorEn: "Communication Services",
      sectorKo: null,
      industry: null,
      subIndustry: null,
    };
    expect(classifyAccountHoldingStyle(row, { GOOGL: "value" })).toBe("value");
    expect(resolveAccountHoldingStyle(row, { GOOGL: "value" }).source).toBe(
      "override",
    );
  });
});

describe("computeStyleTargetDrift", () => {
  it("normalizes parts and measures equity-only drift", async () => {
    const { computeStyleTargetDrift, normalizeStyleTargetParts } = await import(
      "./accountAllocation"
    );
    expect(normalizeStyleTargetParts(7, 3)).toEqual({ growth: 7, value: 3 });
    expect(normalizeStyleTargetParts(8)).toEqual({ growth: 8, value: 2 });
    expect(normalizeStyleTargetParts(7, 4)).toBeNull();

    const drift = computeStyleTargetDrift(
      [
        { key: "__growth__", valueKrw: 800 },
        { key: "__value__", valueKrw: 200 },
        { key: "__cash__", valueKrw: 50 },
      ],
      { growth: 7, value: 3 },
    );
    expect(drift).not.toBeNull();
    expect(drift!.equityKrw).toBe(1000);
    expect(drift!.currentGrowthPct).toBeCloseTo(80);
    expect(drift!.targetGrowthPct).toBeCloseTo(70);
    expect(drift!.growthDriftPctPoints).toBeCloseTo(10);
    expect(drift!.valueGapKrw).toBeCloseTo(100);
    expect(drift!.growthCapitalToAddKrw).toBe(0);
    // value underweight: (0.3*1000 - 200)/(0.7) = 100/0.7 ≈ 142.86
    expect(drift!.valueCapitalToAddKrw).toBeCloseTo(100 / 0.7, 5);
  });

  it("returns null capital when target is 10:0 and opposite sleeve remains", async () => {
    const { computeStyleTargetDrift } = await import("./accountAllocation");
    const drift = computeStyleTargetDrift(
      [
        { key: "__growth__", valueKrw: 500 },
        { key: "__value__", valueKrw: 500 },
      ],
      { growth: 10, value: 0 },
    );
    expect(drift!.growthCapitalToAddKrw).toBeNull();
    expect(drift!.valueCapitalToAddKrw).toBe(0);
  });
});
