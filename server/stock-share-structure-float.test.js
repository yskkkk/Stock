import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveIndexAdjustmentShares,
  finalizeKrFloatShares,
  isPlausibleKrFloatPct,
  isSuspiciousKrShareTotals,
  reconcileKrIssuedShares,
  sumStrategicInvestorSharesFromDart,
} from "./stock-share-structure-float.js";

describe("isPlausibleKrFloatPct", () => {
  it("rejects institutional-style pct mistaken for float pct", () => {
    assert.equal(isPlausibleKrFloatPct(24.654), false);
    assert.equal(isPlausibleKrFloatPct(56.37), true);
  });
});

describe("reconcileKrIssuedShares", () => {
  it("fixes float mistaken for total (강원랜드 구 파서)", () => {
    const out = reconcileKrIssuedShares(
      {
        totalShares: 120_603_557,
        publishedFloatShares: 120_603_557,
        publishedFloatPct: 56.37,
      },
      213_940_500,
    );
    assert.equal(out.totalShares, 213_940_500);
  });

  it("prefers Naver when total diverges >12%", () => {
    const out = reconcileKrIssuedShares(
      {
        totalShares: 489_184_542,
        publishedFloatShares: 120_603_557,
        publishedFloatPct: 24.654,
      },
      213_940_500,
    );
    assert.equal(out.totalShares, 213_940_500);
    assert.equal(out.publishedFloatPct, null);
  });
});

describe("isSuspiciousKrShareTotals", () => {
  it("flags inflated total vs float", () => {
    assert.equal(isSuspiciousKrShareTotals(489_184_542, 120_603_557), true);
    assert.equal(isSuspiciousKrShareTotals(213_940_500, 120_603_557), false);
  });
});

describe("deriveIndexAdjustmentShares", () => {
  it("derives index base from KRX float and pct", () => {
    const base = deriveIndexAdjustmentShares(49_477_255, 64.92, 76_211_850);
    assert.ok(Math.abs(base - 76_211_117) < 2_000);
  });

  it("ignores implausible pct (Yahoo 기관비율 오인)", () => {
    const base = deriveIndexAdjustmentShares(120_603_557, 24.654, 213_940_500);
    assert.equal(base, 213_940_500);
  });
});

describe("finalizeKrFloatShares", () => {
  it("subtracts major and treasury from index base (리노공업)", () => {
    const out = finalizeKrFloatShares({
      totalShares: 76_211_850,
      publishedFloatShares: 49_477_255,
      publishedFloatPct: 64.92,
      majorShareholderShares: 26_418_345,
      treasuryShares: 316_250,
    });
    assert.ok(out.floatShares != null);
    assert.ok(Math.abs(out.floatShares - 49_477_255) < 10_000);
    assert.ok(out.floatPct != null && out.floatPct > 64 && out.floatPct < 65);
    assert.equal(out.treasuryShares, 316_250);
  });

  it("prefers published float when computed gap is large (삼성전자)", () => {
    const out = finalizeKrFloatShares({
      totalShares: 5_846_278_608,
      publishedFloatShares: 4_435_473_721,
      publishedFloatPct: 75.87,
      majorShareholderShares: 1_151_505_282,
      treasuryShares: 82_086_705,
    });
    assert.equal(out.floatShares, 4_435_473_721);
    assert.ok(out.otherNonFloatShares != null && out.otherNonFloatShares > 100_000_000);
  });

  it("never uses major-only fallback", () => {
    const out = finalizeKrFloatShares({
      totalShares: 10_000_000,
      majorShareholderShares: 3_000_000,
    });
    assert.equal(out.floatShares, null);
  });

  it("강원랜드 — 발행주식수·유동주식 분리", () => {
    const out = finalizeKrFloatShares({
      totalShares: 213_940_500,
      publishedFloatShares: 120_603_557,
      publishedFloatPct: 56.37,
    });
    assert.equal(out.totalShares, 213_940_500);
    assert.ok(out.indexAdjustmentShares != null);
    assert.ok(Math.abs(out.indexAdjustmentShares - 213_949_897) < 5_000);
    assert.equal(out.floatShares, 120_603_557);
  });
});

describe("sumStrategicInvestorSharesFromDart", () => {
  it("sums latest strategic reporter holdings", () => {
    const total = sumStrategicInvestorSharesFromDart([
      {
        repror: "A전략",
        rcept_dt: "20260101",
        stkqy: "1000",
        report_tp: "전략적 투자",
        report_resn: "사업협력",
      },
      {
        repror: "A전략",
        rcept_dt: "20260201",
        stkqy: "1,500",
        report_tp: "전략적 투자",
        report_resn: "경영참여",
      },
      {
        repror: "B투자",
        rcept_dt: "20260201",
        stkqy: "900",
        report_tp: "단순투자",
        report_resn: "재무적 투자",
      },
    ]);
    assert.equal(total, 1500);
  });
});
