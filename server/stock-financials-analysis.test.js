import { test } from "vitest";
import assert from "node:assert/strict";
import { loadFinancialStatementAnalysis } from "./stock-financials-analysis.js";

test("US LITE analysis merges fundamentals into periodMetrics", async () => {
  const periods = await import("./stock-financials.js").then((m) =>
    m.loadFinancialPeriods("LITE"),
  );
  const pid = periods.periods?.[0]?.id;
  assert.ok(pid, "expected at least one period");

  const analysis = await loadFinancialStatementAnalysis("LITE", pid);
  assert.ok(analysis.periodMetrics?.per != null, "PER should come from fundamentals");
  assert.ok(analysis.periodMetrics?.eps != null, "EPS should come from fundamentals");
  assert.ok(analysis.periodMetrics?.price != null, "price should come from fundamentals");

  const income = analysis.sections?.find((s) => s.title === "손익계산서");
  const labels = (income?.rows ?? []).map((r) => r.label);
  assert.ok(labels.includes("매출액"));
  assert.ok(labels.includes("당기순이익"));
  assert.ok(!labels.includes("nonRecurring"));
  assert.ok(!labels.some((l) => l === "매출원가" && income?.rows?.find((r) => r.label === l)?.value === "0"));
});
