import { describe, it, expect } from "vitest";
import {
  buildValueInvestInputsFromFundamentals,
  computeHistoricalAveragePer,
} from "./value-invest-return-input.js";

/** 일별 캔들 생성 헬퍼 (unix seconds) */
function makeDailyCandles(yearPriceMap) {
  const candles = [];
  for (const [year, price] of Object.entries(yearPriceMap)) {
    const y = Number(year);
    for (let m = 0; m < 12; m++) {
      const d = new Date(y, m, 15);
      candles.push({ time: Math.floor(d.getTime() / 1000), close: price });
    }
  }
  return { candles };
}

/** 테스트용 기본 fundamentals */
function baseFundamentals(overrides = {}) {
  return {
    symbol: "TEST",
    name: "Test Co",
    currency: "USD",
    market: "us",
    price: 150,
    eps: 10,
    forwardEps: null,
    revenueGrowth: null,
    dividendYield: null,
    per: 15,
    source: "test",
    ...overrides,
  };
}

describe("역사적 평균 PER 계산", () => {
  it("T01: 역사적 PER 계산 — 3개 연도 평균", () => {
    const epsHistory = [
      { year: 2022, eps: 10 },
      { year: 2023, eps: 11 },
      { year: 2024, eps: 12 },
    ];
    const historicalPer = {
      avg: 15,
      perByYear: [
        { year: 2022, per: 15, avgPrice: 150 },
        { year: 2023, per: 15, avgPrice: 165 },
        { year: 2024, per: 15, avgPrice: 180 },
      ],
      source: "역사적 평균 PER 2022–2024 (3개 연도 평균주가÷EPS)",
    };
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals({ per: 20 }), {
      epsHistory,
      historicalPer,
    });
    expect(r.inputs.averagePer).toBe(15);
    expect(r.inputSources.averagePer ?? "").toMatch(/역사적/);
  });

  it("T02: 역사적 PER 없으면 현재 PER 폴백", () => {
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals({ per: 18 }), {
      epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
      historicalPer: { avg: null, perByYear: [], source: null },
    });
    expect(r.inputs.averagePer).toBe(18);
  });

  it("T03: historicalPer 아예 없으면 현재 PER 사용", () => {
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals({ per: 22 }), {
      epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
    });
    expect(r.inputs.averagePer).toBe(22);
  });

  it("T04: 역사적 PER avg=0이면 현재 PER 폴백", () => {
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals({ per: 17 }), {
      epsHistory: [],
      historicalPer: { avg: 0, perByYear: [], source: "test" },
    });
    expect(r.inputs.averagePer).toBe(17);
  });

  it("T05: 역사적 PER source가 inputSources에 반영", () => {
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
      epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
      historicalPer: {
        avg: 16.5,
        perByYear: [
          { year: 2023, per: 16, avgPrice: 160 },
          { year: 2024, per: 17, avgPrice: 170 },
        ],
        source: "역사적 평균 PER 2023–2024 (2개 연도 평균주가÷EPS)",
      },
    });
    expect(r.inputSources.averagePer ?? "").toMatch(/역사적/);
    expect(r.inputs.averagePer).toBe(16.5);
  });

  it("T06: historicalPerData가 반환값에 포함", () => {
    const historicalPer = {
      avg: 14,
      perByYear: [{ year: 2024, per: 14, avgPrice: 140 }],
      source: "역사적 PER",
    };
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
      epsHistory: [{ year: 2024, eps: 10 }],
      historicalPer,
    });
    expect(r.historicalPerData).not.toBeNull();
    expect(r.historicalPerData.avg).toBe(14);
    expect(r.historicalPerData.perByYear.length).toBe(1);
  });

  it("T07: historicalPer 없으면 historicalPerData null", () => {
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
      epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
    });
    expect(r.historicalPerData).toBeNull();
  });

  it("T08: 역사적 PER 적용 시 모델 계산값 달라짐 확인", () => {
    const f = baseFundamentals({ per: 30, price: 100, eps: 5 });
    const epsHistory = [{ year: 2023, eps: 5 }, { year: 2024, eps: 6 }];

    const rCurrent = buildValueInvestInputsFromFundamentals(f, { epsHistory });
    const rHistorical = buildValueInvestInputsFromFundamentals(f, {
      epsHistory,
      historicalPer: { avg: 15, perByYear: [], source: "역사적" },
    });

    expect(rCurrent.result?.futurePrice).not.toBe(rHistorical.result?.futurePrice);
    expect(rCurrent.result?.futurePrice ?? 0).toBeGreaterThan(rHistorical.result?.futurePrice ?? 0);
  });

  it("T09: 역사적 PER이 낮으면 fairBuyPrice도 낮아짐", () => {
    const f = baseFundamentals({ per: 40, price: 200, eps: 5 });
    const epsHistory = [{ year: 2023, eps: 5 }, { year: 2024, eps: 6 }];

    const rCurrent = buildValueInvestInputsFromFundamentals(f, { epsHistory });
    const rHistorical = buildValueInvestInputsFromFundamentals(f, {
      epsHistory,
      historicalPer: { avg: 20, perByYear: [], source: "역사적" },
    });

    expect(rCurrent.result?.fairBuyPrice ?? 0).toBeGreaterThan(rHistorical.result?.fairBuyPrice ?? 0);
  });

  it("T10: 역사적 PER이 높으면 fairBuyPrice도 높아짐", () => {
    const f = baseFundamentals({ per: 10, price: 100, eps: 10 });
    const epsHistory = [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }];

    const rCurrent = buildValueInvestInputsFromFundamentals(f, { epsHistory });
    const rHistorical = buildValueInvestInputsFromFundamentals(f, {
      epsHistory,
      historicalPer: { avg: 20, perByYear: [], source: "역사적" },
    });

    expect(rHistorical.result?.fairBuyPrice ?? 0).toBeGreaterThan(rCurrent.result?.fairBuyPrice ?? 0);
  });

  it("T11: 역사적 PER avg가 소수점 값 그대로 전달", () => {
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
      epsHistory: [{ year: 2023, eps: 10 }],
      historicalPer: { avg: 14.555555, perByYear: [], source: "test" },
    });
    expect(r.inputs.averagePer).toBe(14.555555);
  });

  it("T12: PER 정상 범위 상한 300 경계값", () => {
    // 299 → 포함, 300+ → 제외 (computeHistoricalAveragePer 내부)
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
      epsHistory: [{ year: 2024, eps: 1 }],
      historicalPer: {
        avg: 299,
        perByYear: [{ year: 2024, per: 299, avgPrice: 299 }],
        source: "test",
      },
    });
    expect(r.inputs.averagePer).toBe(299);
  });

  it("T12b: computeHistoricalAveragePer — PER 150~299 범위 포함 (구 상한 150 제거)", () => {
    const epsH = [{ year: 2024, eps: 1 }];
    const candles = makeDailyCandles({ "2024": 200 });
    // avgPrice=200, eps=1 → per=200 (이전 150 상한이면 제외됐지만 이제 포함)
    const r = computeHistoricalAveragePer(epsH, candles);
    expect(r.avg).not.toBeNull();
    expect(r.avg).toBeCloseTo(200, 0);
  });

  it("T13: computable=true면 result 있음", () => {
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
      epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
      historicalPer: { avg: 15, perByYear: [], source: "test" },
    });
    expect(r.computable).toBeTruthy();
    expect(r.result).not.toBeNull();
  });

  it("T14: PER missing 추가 — averagePer null이면", () => {
    const r = buildValueInvestInputsFromFundamentals(
      baseFundamentals({ per: null }),
      {
        epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
        historicalPer: { avg: null, perByYear: [], source: null },
      },
    );
    expect(r.missing.some((m) => m.includes("PER"))).toBeTruthy();
  });

  it("T15: 역사적 PER source 문자열 내용 확인", () => {
    const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
      epsHistory: [
        { year: 2020, eps: 8 }, { year: 2021, eps: 9 }, { year: 2022, eps: 10 },
        { year: 2023, eps: 11 }, { year: 2024, eps: 12 },
      ],
      historicalPer: {
        avg: 16.2,
        perByYear: [
          { year: 2020, per: 15, avgPrice: 120 },
          { year: 2021, per: 16, avgPrice: 144 },
          { year: 2022, per: 17, avgPrice: 170 },
          { year: 2023, per: 16, avgPrice: 176 },
          { year: 2024, per: 17, avgPrice: 204 },
        ],
        source: "역사적 평균 PER 2020→2024 (5년, 연평균주가÷EPS)",
      },
    });
    expect(r.inputSources.averagePer ?? "").toMatch(/2020/);
    expect(r.inputSources.averagePer ?? "").toMatch(/2024/);
    expect(r.inputSources.averagePer ?? "").toMatch(/5년/);
  });
});
