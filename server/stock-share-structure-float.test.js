import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveIndexAdjustmentShares,
  finalizeKrFloatShares,
  sumStrategicInvestorSharesFromDart,
} from "./stock-share-structure-float.js";

describe("deriveIndexAdjustmentShares", () => {
  it("derives index base from KRX float and pct", () => {
    const base = deriveIndexAdjustmentShares(49_477_255, 64.92, 76_211_850);
    assert.ok(Math.abs(base - 76_211_117) < 2_000);
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
