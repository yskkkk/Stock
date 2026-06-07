/**
 * 재무제표 기간별 밸류에이션·수익성 지표 추출
 */
import { parseStatementNumber } from "./stock-financials-analysis.js";

/** @param {string} label */
function normLabel(label) {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * @param {{ label: string; value: string; note?: string }[]} flat
 * @param {string[]} patterns
 */
function findRow(flat, patterns) {
  for (const row of flat) {
    const n = normLabel(row.label);
    if (patterns.some((p) => n.includes(p))) return row;
  }
  return null;
}

/**
 * @param {{ label: string; value: string; note?: string }[]} flat
 * @param {string[]} patterns
 */
function rowNumber(flat, patterns) {
  const row = findRow(flat, patterns);
  if (!row) return null;
  return parseStatementNumber(row.value, row.note);
}

/**
 * @param {{ label: string; value: string; note?: string }[]} flat
 * @param {string[]} patterns
 */
function rowRatio(flat, patterns) {
  const row = findRow(flat, patterns);
  if (!row) return null;
  const raw = String(row.value ?? "");
  const n = parseStatementNumber(raw, row.note);
  if (n == null) return null;
  if (raw.includes("%") || raw.includes("％")) return n / 100;
  if (Math.abs(n) > 1 && patterns.some((p) => p.includes("roe") || p.includes("이익률"))) {
    return n / 100;
  }
  return n;
}

/**
 * @param {{ sections?: { unitNote?: string; rows?: { label: string; value: string }[] }[]; periodId?: string; label?: string; kind?: string; isForecast?: boolean }} detail
 * @param {{ currency: string; market: "kr"|"us" }} meta
 */
export function extractPeriodMetricsFromDetail(detail, meta) {
  /** @type {{ label: string; value: string; note?: string }[]} */
  const flat = [];
  for (const sec of detail?.sections ?? []) {
    const note = sec?.unitNote;
    for (const row of sec?.rows ?? []) {
      flat.push({ label: row.label, value: row.value, note });
    }
  }

  const per = rowNumber(flat, ["per", "주가수익"]);
  const forwardPer = rowNumber(flat, ["forwardper", "예상per", "cnsper"]);
  const eps = rowNumber(flat, ["eps", "주당순이익", "basiceps", "dilutedeps"]) ??
    rowNumber(flat, ["basicaverageeps"]);
  const forwardEps = rowNumber(flat, ["forwardeps", "예상eps", "cnseps"]);
  const bps = rowNumber(flat, ["bps", "주당순자산"]);
  const pbr = rowNumber(flat, ["pbr", "주가순자산"]);
  let roe = rowRatio(flat, ["roe", "자기자본이익", "자본이익률"]);
  let profitMargin = rowRatio(flat, ["순이익률", "당기순이익률", "profitmargin", "netmargin"]);
  const dividendYield = rowRatio(flat, ["배당수익률", "dividendyield"]);

  const netIncome = rowNumber(flat, ["당기순이익", "순이익", "netincome"]);
  const revenue = rowNumber(flat, ["매출액", "매출", "totalrevenue", "sales", "revenue"]);
  const equity = rowNumber(flat, [
    "총자본",
    "자본총계",
    "totalstockholderequity",
    "stockholdersequity",
  ]);

  if (profitMargin == null && netIncome != null && revenue != null && Math.abs(revenue) > 0) {
    profitMargin = netIncome / revenue;
  }
  if (roe == null && netIncome != null && equity != null && Math.abs(equity) > 0) {
    roe = netIncome / equity;
  }

  return {
    periodId: detail.periodId,
    periodLabel: detail.label,
    kind: detail.kind,
    isForecast: Boolean(detail.isForecast),
    currency: meta.currency,
    market: meta.market,
    per,
    forwardPer,
    eps,
    forwardEps,
    bps,
    pbr,
    price: null,
    marketCap: null,
    dividendYield,
    profitMargin,
    roe,
  };
}
