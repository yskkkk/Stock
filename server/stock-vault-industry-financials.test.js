import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIndustryFinancialVerdict,
  computeIndustryFinancialSnapshots,
} from "./stock-vault-industry-financials.js";

test("buildIndustryFinancialVerdict — better when metrics beat industry medians", () => {
  const v = buildIndustryFinancialVerdict(
    { per: 10, roe: 0.2, profitMargin: 0.15, pbr: 1.2 },
    { per: 20, roe: 0.1, profitMargin: 0.08, pbr: 2.0 },
    "반도체",
  );
  assert.equal(v.verdict, "better");
  assert.equal(v.verdictLabel, "업계 평균보다 양호");
  assert.match(v.verdictDetail, /반도체/);
});

test("buildIndustryFinancialVerdict — worse when metrics lag industry", () => {
  const v = buildIndustryFinancialVerdict(
    { per: 40, roe: 0.04, profitMargin: 0.02, pbr: 5 },
    { per: 15, roe: 0.12, profitMargin: 0.1, pbr: 2 },
    "은행",
  );
  assert.equal(v.verdict, "worse");
  assert.equal(v.verdictLabel, "업계 평균보다 부진");
});

test("computeIndustryFinancialSnapshots — sector leader by market cap", () => {
  const snap = computeIndustryFinancialSnapshots([
    {
      symbol: "AAA",
      industry: "반도체",
      fund: { per: 20, roe: 0.1, profitMargin: 0.1, pbr: 2, marketCap: 100 },
    },
    {
      symbol: "BBB",
      industry: "반도체",
      fund: { per: 18, roe: 0.12, profitMargin: 0.11, pbr: 1.8, marketCap: 500 },
    },
  ]);
  assert.equal(snap.bySymbol.AAA.sectorLeader, false);
  assert.equal(snap.bySymbol.BBB.sectorLeader, true);
  assert.equal(snap.bySymbol.BBB.industryPeerCount, 2);
  assert.ok(snap.bySymbol.AAA.industryMedianPer != null);
});
