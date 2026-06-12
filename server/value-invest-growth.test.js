import assert from "node:assert/strict";
import test from "node:test";
import { epsCagrFromHistory, deriveValueInvestGrowth10y, GROWTH_10Y_CAP } from "./value-invest-growth.js";

// ── epsCagrFromHistory (YoY 전년 대비 이익성장률) ───────────────────────────

test("T01: 정상 YoY 성장 — (7.5-7)/7 ≈ 7.14%", () => {
  const r = epsCagrFromHistory([
    { year: 2022, eps: 6 },
    { year: 2023, eps: 7 },
    { year: 2024, eps: 7.5 },
  ]);
  assert.ok(r != null);
  assert.ok(Math.abs(r - (7.5 - 7) / 7) < 0.0001);
});

test("T02: 2개 연도만 있어도 계산 가능", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: 10 },
    { year: 2024, eps: 12 },
  ]);
  assert.ok(r != null);
  assert.ok(Math.abs(r - 0.2) < 0.0001);
});

test("T03: 1개 연도만 있으면 null 반환", () => {
  const r = epsCagrFromHistory([{ year: 2024, eps: 10 }]);
  assert.equal(r, null);
});

test("T04: 빈 배열이면 null 반환", () => {
  assert.equal(epsCagrFromHistory([]), null);
});

test("T05: null/undefined 인자 처리", () => {
  assert.equal(epsCagrFromHistory(null), null);
  assert.equal(epsCagrFromHistory(undefined), null);
});

test("T06: EPS 0 있는 연도는 제외하고 계산", () => {
  const r = epsCagrFromHistory([
    { year: 2022, eps: 0 },
    { year: 2023, eps: 10 },
    { year: 2024, eps: 12 },
  ]);
  assert.ok(r != null);
  assert.ok(Math.abs(r - 0.2) < 0.0001);
});

test("T07: EPS 음수 연도 제외 후 2개 미만이면 null", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: -5 },
    { year: 2024, eps: 10 },
  ]);
  assert.equal(r, null);
});

test("T08: 연도 역순으로 입력돼도 최신 2개 기준 계산", () => {
  const r = epsCagrFromHistory([
    { year: 2024, eps: 12 },
    { year: 2022, eps: 8 },
    { year: 2023, eps: 10 },
  ]);
  // 정렬 후 2023→2024: (12-10)/10 = 20%
  assert.ok(r != null);
  assert.ok(Math.abs(r - 0.2) < 0.0001);
});

test("T09: 이익 감소 (음수 성장률)", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: 10 },
    { year: 2024, eps: 8 },
  ]);
  assert.ok(r != null);
  assert.ok(Math.abs(r - (-0.2)) < 0.0001);
});

test("T10: 급성장 100% 성장률", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: 5 },
    { year: 2024, eps: 10 },
  ]);
  assert.ok(r != null);
  assert.ok(Math.abs(r - 1.0) < 0.0001);
});

test("T11: 미세한 성장률 (0.1%)", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: 1000 },
    { year: 2024, eps: 1001 },
  ]);
  assert.ok(r != null);
  assert.ok(Math.abs(r - 0.001) < 0.00001);
});

test("T12: 소수점 EPS 처리", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: 3.33 },
    { year: 2024, eps: 3.83 },
  ]);
  assert.ok(r != null);
  assert.ok(Math.abs(r - (0.5 / 3.33)) < 0.0001);
});

test("T13: 10개 연도 — 최신 2개 기준 (2023→2024)", () => {
  const series = Array.from({ length: 10 }, (_, i) => ({
    year: 2015 + i,
    eps: 5 + i,
  }));
  const r = epsCagrFromHistory(series);
  // 2023(eps=13), 2024(eps=14): (14-13)/13
  assert.ok(r != null);
  assert.ok(Math.abs(r - (1 / 13)) < 0.0001);
});

test("T14: 동일 EPS — 성장률 0%", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: 10 },
    { year: 2024, eps: 10 },
  ]);
  assert.ok(r != null);
  assert.equal(r, 0);
});

test("T15: 전기 EPS가 0이면 null", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: 0 },
    { year: 2024, eps: 10 },
  ]);
  assert.equal(r, null);
});

// ── deriveValueInvestGrowth10y ────────────────────────────────────────────

test("T16: 이력 있으면 YoY 우선 사용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 8,
    forwardEps: 9,
    revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 10 },
      { year: 2024, eps: 11 },
    ],
  });
  assert.ok(r.value != null);
  assert.ok(Math.abs(r.value - 0.1) < 0.0001);
  assert.match(r.source ?? "", /전년 대비/);
});

test("T17: 이력 없으면 revenueGrowth 폴백", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10,
    forwardEps: null,
    revenueGrowth: 0.12,
    epsHistory: [],
  });
  assert.ok(r.value != null);
  assert.ok(Math.abs(r.value - 0.12) < 0.0001);
  assert.match(r.source ?? "", /revenueGrowth/);
});

test("T18: revenueGrowth도 없으면 Forward÷Trailing 폴백", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10,
    forwardEps: 11,
    revenueGrowth: null,
    epsHistory: [],
  });
  assert.ok(r.value != null);
  assert.ok(Math.abs(r.value - 0.1) < 0.0001);
  assert.match(r.source ?? "", /Forward/);
});

test("T19: 모두 없으면 value null 반환", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null,
    forwardEps: null,
    revenueGrowth: null,
    epsHistory: [],
  });
  assert.equal(r.value, null);
});

test("T20: 25% 상한 적용 — YoY 50% → 25%", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null,
    forwardEps: null,
    revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 10 },
      { year: 2024, eps: 15 },
    ],
  });
  assert.equal(r.value, GROWTH_10Y_CAP);
  assert.ok(r.warnings.some((w) => w.includes("10년")));
});

test("T21: 정확히 25% — 상한 미적용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null,
    forwardEps: null,
    revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 8 },
      { year: 2024, eps: 10 },
    ],
  });
  assert.equal(r.value, GROWTH_10Y_CAP);
});

test("T22: revenueGrowth 25% 상한 적용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10, forwardEps: 11,
    revenueGrowth: 0.4,
    epsHistory: [],
  });
  assert.equal(r.value, GROWTH_10Y_CAP);
  assert.ok(r.warnings.some((w) => w.includes("10년")));
});

test("T23: Forward EPS 상한 25% 초과 경고 (Samsung-like)", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 12372,
    forwardEps: 43833,
    revenueGrowth: null,
  });
  assert.equal(r.value, GROWTH_10Y_CAP);
  assert.ok(r.warnings.some((w) => w.includes("10년")));
});

test("T24: 음수 성장 −40% 이하 경고", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 10 },
      { year: 2024, eps: 5 },
    ],
  });
  assert.ok(r.value != null);
  assert.ok(r.value < 0);
  assert.ok(r.warnings.some((w) => w.includes("음수")));
});

test("T25: 음수 성장 −39.9% — 경고 없음", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 10 },
      { year: 2024, eps: 6.01 },
    ],
  });
  assert.ok(r.value != null);
  assert.equal(r.warnings.length, 0);
});

test("T26: 이력 1개뿐이면 Forward 폴백 사용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10,
    forwardEps: 11,
    revenueGrowth: null,
    epsHistory: [{ year: 2024, eps: 10 }],
  });
  assert.ok(r.value != null);
  assert.match(r.source ?? "", /Forward/);
});

test("T27: epsHistory 없음(undefined) — revenueGrowth 사용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10,
    forwardEps: 12,
    revenueGrowth: 0.08,
  });
  assert.ok(r.value != null);
  assert.ok(Math.abs(r.value - 0.08) < 0.0001);
});

test("T28: revenueGrowth 정확히 0% — 0 반환", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10, forwardEps: null,
    revenueGrowth: 0,
    epsHistory: [],
  });
  assert.equal(r.value, 0);
});

test("T29: 이익성장률 source에 연도 포함", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 10 },
      { year: 2024, eps: 11 },
    ],
  });
  assert.match(r.source ?? "", /2023/);
  assert.match(r.source ?? "", /2024/);
});

test("T30: 이익성장률 소수점 정밀도 확인", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 3 },
      { year: 2024, eps: 4 },
    ],
  });
  // (4-3)/3 = 1/3 ≈ 33.33% → 상한 25% 적용
  assert.equal(r.value, GROWTH_10Y_CAP);
});

test("T31: warnings 배열 항상 반환", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null, epsHistory: [],
  });
  assert.ok(Array.isArray(r.warnings));
});

test("T32: EPS 이력에 중복 연도 있어도 최신 2개 사용", () => {
  const r = epsCagrFromHistory([
    { year: 2024, eps: 10 },
    { year: 2024, eps: 11 },  // 중복
    { year: 2023, eps: 9 },
  ]);
  // 정렬: [2023:9, 2024:10, 2024:11] → prev=2024:10, curr=2024:11
  assert.ok(r != null);
});

test("T33: 매우 큰 EPS 값 처리 (원화 단위)", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: 50000 },
    { year: 2024, eps: 55000 },
  ]);
  assert.ok(r != null);
  assert.ok(Math.abs(r - 0.1) < 0.0001);
});

test("T34: EPS 1원미만 소수 (작은 값)", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: 0.01 },
    { year: 2024, eps: 0.012 },
  ]);
  assert.ok(r != null);
  assert.ok(Math.abs(r - 0.2) < 0.0001);
});

test("T35: Forward EPS 음수면 Forward 폴백 미사용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10,
    forwardEps: -2,
    revenueGrowth: null,
    epsHistory: [],
  });
  assert.equal(r.value, null);
});

test("T36: eps 0이면 Forward 폴백 미사용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 0,
    forwardEps: 5,
    revenueGrowth: null,
    epsHistory: [],
  });
  assert.equal(r.value, null);
});

test("T37: revenueGrowth 음수도 반환", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10, forwardEps: null,
    revenueGrowth: -0.05,
    epsHistory: [],
  });
  assert.ok(r.value != null);
  assert.ok(Math.abs(r.value - (-0.05)) < 0.0001);
});

test("T38: GROWTH_10Y_CAP 상수 0.25 확인", () => {
  assert.equal(GROWTH_10Y_CAP, 0.25);
});

test("T39: YoY 계산값이 CAGR과 다름을 확인 (고성장 기업)", () => {
  // 2018:1, 2019:2, 2020:4, 2021:8, 2022:16, 2023:32
  // YoY(2022→2023): (32-16)/16 = 100%
  // CAGR(2018→2023, 5년): (32/1)^(1/5)-1 ≈ 100% (같음)
  // 하지만 불규칙 성장에선 다름
  const r = epsCagrFromHistory([
    { year: 2021, eps: 5 },
    { year: 2022, eps: 15 },
    { year: 2023, eps: 18 },
  ]);
  // YoY: (18-15)/15 = 20%
  assert.ok(r != null);
  assert.ok(Math.abs(r - 0.2) < 0.0001);
});

test("T40: 이력 있어도 EPS 모두 0이면 Forward 폴백", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10,
    forwardEps: 12,
    revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 0 },
      { year: 2024, eps: 0 },
    ],
  });
  assert.ok(r.value != null);
  assert.match(r.source ?? "", /Forward/);
});

test("T41: 양수 EPS 하나, 음수 하나 — 2개 미만 유효 → null", () => {
  const r = epsCagrFromHistory([
    { year: 2023, eps: -3 },
    { year: 2024, eps: 10 },
  ]);
  assert.equal(r, null);
});

test("T42: 5개 연도 중 최신 2개만 사용", () => {
  const r = epsCagrFromHistory([
    { year: 2020, eps: 100 },
    { year: 2021, eps: 50 },
    { year: 2022, eps: 30 },
    { year: 2023, eps: 8 },
    { year: 2024, eps: 10 },
  ]);
  // 2023→2024: (10-8)/8 = 25%
  assert.ok(r != null);
  assert.ok(Math.abs(r - 0.25) < 0.0001);
});

test("T43: 정확히 24.99% — 상한 미적용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 10000 },
      { year: 2024, eps: 12499 },
    ],
  });
  assert.ok(r.value != null);
  assert.ok(r.value < GROWTH_10Y_CAP);
  assert.equal(r.warnings.length, 0);
});

test("T44: 25.01% — 상한 적용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 10000 },
      { year: 2024, eps: 12501 },
    ],
  });
  assert.equal(r.value, GROWTH_10Y_CAP);
  assert.ok(r.warnings.length > 0);
});

test("T45: source 문자열에 '전년 대비' 포함 확인", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 10 },
      { year: 2024, eps: 11 },
    ],
  });
  assert.match(r.source ?? "", /전년 대비/);
});

test("T46: Forward÷Trailing 음수 성장 −50% 경고", () => {
  const r = deriveValueInvestGrowth10y({
    eps: 10,
    forwardEps: 4,
    revenueGrowth: null,
    epsHistory: [],
  });
  assert.ok(r.value != null);
  assert.ok(r.value < 0);
  assert.ok(r.warnings.some((w) => w.includes("감소")));
});

test("T47: epsHistory에 year:0 있는 항목 제외", () => {
  const r = epsCagrFromHistory([
    { year: 0, eps: 100 },
    { year: 2023, eps: 10 },
    { year: 2024, eps: 11 },
  ]);
  // year:0은 filter(eps > 0)은 통과하나 year 0은 유효 year
  // 실제로 year:0도 포함되므로 정렬 후 최신 2개: 2023, 2024
  assert.ok(r != null);
  assert.ok(Math.abs(r - 0.1) < 0.0001);
});

test("T48: 대형 한국 기업 EPS 사이클 — 삼성전자 반도체 사이클 시뮬", () => {
  // 반도체 슈퍼사이클 후 다운사이클
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2021, eps: 5765 },
      { year: 2022, eps: 8057 },
      { year: 2023, eps: 1457 },  // 반도체 불황
      { year: 2024, eps: 6253 },  // 회복
    ],
  });
  // YoY: (6253-1457)/1457 ≈ 329% → 상한 25%
  assert.equal(r.value, GROWTH_10Y_CAP);
});

test("T49: NVIDIA 고성장 시뮬 — 상한 적용 확인", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 1.74 },
      { year: 2024, eps: 11.93 },
    ],
  });
  // YoY ≈ 585% → 상한 25%
  assert.equal(r.value, GROWTH_10Y_CAP);
});

test("T50: 안정적 배당주 시뮬 — 상한 미적용", () => {
  const r = deriveValueInvestGrowth10y({
    eps: null, forwardEps: null, revenueGrowth: null,
    epsHistory: [
      { year: 2023, eps: 4.20 },
      { year: 2024, eps: 4.45 },
    ],
  });
  // YoY ≈ 5.95% → 상한 미적용
  assert.ok(r.value != null);
  assert.ok(r.value < GROWTH_10Y_CAP);
  assert.equal(r.warnings.length, 0);
});
