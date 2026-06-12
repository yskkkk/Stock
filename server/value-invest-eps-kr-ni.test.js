import assert from "node:assert/strict";
import test from "node:test";
import { parseStatementNumber } from "./stock-financials-analysis.js";

/** @param {Awaited<ReturnType<typeof import('./stock-financials.js').loadFinancialStatementDetail>>} detail @param {number} shares */
function epsFromNetIncomeAndShares(detail, shares) {
  if (!detail?.sections?.length || shares <= 0) return null;
  for (const sec of detail.sections) {
    for (const row of sec.rows ?? []) {
      const n = String(row.label ?? "").toLowerCase().replace(/\s+/g, "");
      if (!n.includes("당기순이익")) continue;
      const unitNote = sec.unitNote ?? "";
      let netIncome = parseStatementNumber(row.value, unitNote);
      if (netIncome == null || netIncome <= 0) return null;
      if (unitNote.includes("억원")) netIncome *= 1e8;
      return netIncome / shares;
    }
  }
  return null;
}

test("KR 당기순이익(억원) ÷ 발행주식 → EPS 원/주", () => {
  const detail = {
    sections: [
      {
        unitNote: "단위: 억원",
        rows: [{ label: "당기순이익", value: "547,300" }],
      },
    ],
  };
  const eps = epsFromNetIncomeAndShares(detail, 5_764_191_903);
  assert.ok(eps != null && eps > 9000 && eps < 10000);
});
