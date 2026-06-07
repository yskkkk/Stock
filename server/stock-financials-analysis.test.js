import { test } from "vitest";
import assert from "node:assert/strict";
import { loadFinancialPeriods, loadFinancialStatementDetail } from "./stock-financials.js";
import { loadFinancialStatementAnalysis } from "./stock-financials-analysis.js";
import {
  buildHistoricalPeriodMetrics,
  fetchHistoricalCloseNearDate,
} from "./stock-financial-period-valuation.js";
import { extractPeriodMetricsFromDetail } from "./stock-financial-period-metrics.js";

test("US LITE period metrics differ by selected fiscal period", async () => {
  const periods = await loadFinancialPeriods("LITE");
  const q202603 = periods.periods.find((p) => p.label === "2026.03");
  const a2024 = periods.periods.find((p) => p.label === "2024" && p.kind === "annual");
  assert.ok(q202603 && a2024);

  const [qAnalysis, aAnalysis] = await Promise.all([
    loadFinancialStatementAnalysis("LITE", q202603.id),
    loadFinancialStatementAnalysis("LITE", a2024.id),
  ]);

  assert.ok(qAnalysis.periodMetrics.price != null);
  assert.ok(aAnalysis.periodMetrics.price != null);
  assert.notEqual(qAnalysis.periodMetrics.price, aAnalysis.periodMetrics.price);
  assert.ok(aAnalysis.periodMetrics.price < 200, "2024 disclosure price should be far below current");
  assert.equal(aAnalysis.periodMetrics.per, null, "negative EPS year should not show PER");
  assert.notEqual(
    qAnalysis.periodMetrics.per,
    aAnalysis.periodMetrics.per,
  );
});

test("buildHistoricalPeriodMetrics keeps KR statement PER", async () => {
  const metrics = extractPeriodMetricsFromDetail(
    {
      periodId: "n:q:202503",
      label: "2025.03",
      kind: "quarter",
      sections: [{ title: "재무제표", rows: [{ label: "PER", value: "12.3" }] }],
    },
    { currency: "KRW", market: "kr" },
  );
  const out = await buildHistoricalPeriodMetrics(
    "005930.KS",
    { endDateMs: Date.UTC(2025, 2, 31), kind: "quarter" },
    metrics,
    {},
  );
  assert.equal(out.per, 12.3);
  assert.equal(out.valuationBasis, "period_statement");
});

test("fetchHistoricalCloseNearDate returns positive price", async () => {
  const ms = Date.UTC(2024, 7, 15);
  const px = await fetchHistoricalCloseNearDate("LITE", ms);
  assert.ok(px != null && px > 0 && px < 200);
});
