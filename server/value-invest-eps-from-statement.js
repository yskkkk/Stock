/**
 * 재무제표 당기순이익 ÷ 발행주식 → 연간 EPS
 */
import {
  absoluteMoneyFromStatementRow,
} from "./stock-financials-analysis.js";

/**
 * @param {Awaited<ReturnType<typeof import("./stock-financials.js").loadFinancialStatementDetail>>} detail
 * @param {number} shares
 */
export function epsFromNetIncomeAndShares(detail, shares) {
  if (!detail?.sections?.length || shares <= 0) return null;
  for (const sec of detail.sections) {
    for (const row of sec.rows ?? []) {
      const n = String(row.label ?? "")
        .toLowerCase()
        .replace(/\s+/g, "");
      if (!n.includes("netincome") && !n.includes("당기순이익")) continue;
      const unitNote = sec.unitNote ?? "";
      const netIncome = absoluteMoneyFromStatementRow(row.value, unitNote);
      if (netIncome == null || netIncome <= 0) return null;
      return netIncome / shares;
    }
  }
  return null;
}
