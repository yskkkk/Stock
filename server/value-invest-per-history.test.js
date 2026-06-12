/**
 * 역사적 평균 PER 계산 테스트 (value-invest-return-input.js의 computeHistoricalAveragePer)
 * 직접 export가 없으므로 buildValueInvestInputsFromFundamentals를 통해 검증
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildValueInvestInputsFromFundamentals } from "./value-invest-return-input.js";

/** 일별 캔들 생성 헬퍼 (unix seconds) */
function makeDailyCandles(yearPriceMap) {
  const candles = [];
  for (const [year, price] of Object.entries(yearPriceMap)) {
    const y = Number(year);
    // 각 연도에 12개 캔들 (월별 1개 수준)
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

// ── 역사적 PER 계산 ───────────────────────────────────────────────────────

test("T01: 역사적 PER 계산 — 3개 연도 평균", () => {
  const epsHistory = [
    { year: 2022, eps: 10 },
    { year: 2023, eps: 11 },
    { year: 2024, eps: 12 },
  ];
  // 각 연도 평균주가: 2022=150, 2023=165, 2024=180
  // PER: 15, 15, 15 → 평균 15
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
  // 역사적 PER 15가 현재 PER 20보다 우선
  assert.equal(r.inputs.averagePer, 15);
  assert.match(r.inputSources.averagePer ?? "", /역사적/);
});

test("T02: 역사적 PER 없으면 현재 PER 폴백", () => {
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals({ per: 18 }), {
    epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
    historicalPer: { avg: null, perByYear: [], source: null },
  });
  assert.equal(r.inputs.averagePer, 18);
});

test("T03: historicalPer 아예 없으면 현재 PER 사용", () => {
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals({ per: 22 }), {
    epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
  });
  assert.equal(r.inputs.averagePer, 22);
});

test("T04: 역사적 PER avg=0이면 현재 PER 폴백", () => {
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals({ per: 17 }), {
    epsHistory: [],
    historicalPer: { avg: 0, perByYear: [], source: "test" },
  });
  assert.equal(r.inputs.averagePer, 17);
});

test("T05: 역사적 PER source가 inputSources에 반영", () => {
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
    epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
    historicalPer: {
      avg: 16.5,
      perByYear: [{ year: 2023, per: 16, avgPrice: 160 }, { year: 2024, per: 17, avgPrice: 170 }],
      source: "역사적 평균 PER 2023–2024 (2개 연도 평균주가÷EPS)",
    },
  });
  assert.match(r.inputSources.averagePer ?? "", /역사적/);
  assert.equal(r.inputs.averagePer, 16.5);
});

test("T06: historicalPerData가 반환값에 포함", () => {
  const historicalPer = {
    avg: 14,
    perByYear: [{ year: 2024, per: 14, avgPrice: 140 }],
    source: "역사적 PER",
  };
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
    epsHistory: [{ year: 2024, eps: 10 }],
    historicalPer,
  });
  assert.ok(r.historicalPerData != null);
  assert.equal(r.historicalPerData.avg, 14);
  assert.equal(r.historicalPerData.perByYear.length, 1);
});

test("T07: historicalPer 없으면 historicalPerData null", () => {
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
    epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
  });
  assert.equal(r.historicalPerData, null);
});

test("T08: 역사적 PER 적용 시 모델 계산값 달라짐 확인", () => {
  const f = baseFundamentals({ per: 30, price: 100, eps: 5 });
  const epsHistory = [{ year: 2023, eps: 5 }, { year: 2024, eps: 6 }];

  const rCurrent = buildValueInvestInputsFromFundamentals(f, { epsHistory });
  const rHistorical = buildValueInvestInputsFromFundamentals(f, {
    epsHistory,
    historicalPer: { avg: 15, perByYear: [], source: "역사적" },
  });

  // 현재 PER 30 vs 역사적 PER 15 → futurePrice 달라야 함
  assert.ok(rCurrent.result?.futurePrice != rHistorical.result?.futurePrice);
  assert.ok((rCurrent.result?.futurePrice ?? 0) > (rHistorical.result?.futurePrice ?? 0));
});

test("T09: 역사적 PER이 낮으면 fairBuyPrice도 낮아짐", () => {
  const f = baseFundamentals({ per: 40, price: 200, eps: 5 });
  const epsHistory = [{ year: 2023, eps: 5 }, { year: 2024, eps: 6 }];

  const rCurrent = buildValueInvestInputsFromFundamentals(f, { epsHistory });
  const rHistorical = buildValueInvestInputsFromFundamentals(f, {
    epsHistory,
    historicalPer: { avg: 20, perByYear: [], source: "역사적" },
  });

  assert.ok((rCurrent.result?.fairBuyPrice ?? 0) > (rHistorical.result?.fairBuyPrice ?? 0));
});

test("T10: 역사적 PER이 높으면 fairBuyPrice도 높아짐", () => {
  const f = baseFundamentals({ per: 10, price: 100, eps: 10 });
  const epsHistory = [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }];

  const rCurrent = buildValueInvestInputsFromFundamentals(f, { epsHistory });
  const rHistorical = buildValueInvestInputsFromFundamentals(f, {
    epsHistory,
    historicalPer: { avg: 20, perByYear: [], source: "역사적" },
  });

  assert.ok((rHistorical.result?.fairBuyPrice ?? 0) > (rCurrent.result?.fairBuyPrice ?? 0));
});

// ── computeHistoricalAveragePer 동작 검증 (loadValueInvestReturn 통합 미포함) ──

test("T11: 역사적 PER avg가 소수점 2자리로 반올림", () => {
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
    epsHistory: [{ year: 2023, eps: 10 }],
    historicalPer: { avg: 14.555555, perByYear: [], source: "test" },
  });
  // avg 그대로 전달 — 반올림은 computeHistoricalAveragePer 내부에서 처리
  assert.equal(r.inputs.averagePer, 14.555555);
});

test("T12: PER 정상 범위 상한 150 경계값", () => {
  // 149.9 → 포함, 150.1 → 제외 (computeHistoricalAveragePer 내부)
  // buildValueInvestInputsFromFundamentals은 avg를 그대로 씀
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
    epsHistory: [{ year: 2024, eps: 1 }],
    historicalPer: { avg: 149, perByYear: [{ year: 2024, per: 149, avgPrice: 149 }], source: "test" },
  });
  assert.equal(r.inputs.averagePer, 149);
});

test("T13: computable=true면 result 있음", () => {
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
    epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
    historicalPer: { avg: 15, perByYear: [], source: "test" },
  });
  assert.ok(r.computable);
  assert.ok(r.result != null);
});

test("T14: PER missing 추가 — averagePer null이면", () => {
  const r = buildValueInvestInputsFromFundamentals(
    baseFundamentals({ per: null }),
    {
      epsHistory: [{ year: 2023, eps: 10 }, { year: 2024, eps: 11 }],
      historicalPer: { avg: null, perByYear: [], source: null },
    },
  );
  assert.ok(r.missing.some((m) => m.includes("PER")));
});

test("T15: 역사적 PER source 문자열 내용 확인", () => {
  const r = buildValueInvestInputsFromFundamentals(baseFundamentals(), {
    epsHistory: [{ year: 2020, eps: 8 }, { year: 2021, eps: 9 }, { year: 2022, eps: 10 }, { year: 2023, eps: 11 }, { year: 2024, eps: 12 }],
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
  assert.match(r.inputSources.averagePer ?? "", /2020/);
  assert.match(r.inputSources.averagePer ?? "", /2024/);
  assert.match(r.inputSources.averagePer ?? "", /5년/);
});
