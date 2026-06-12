/**
 * 10년 수익 모델 — 성장률 산출 (연간 EPS 이력 CAGR)
 */

/** EPS CAGR 산출에 쓰는 최대 연수 */
export const EPS_GROWTH_HISTORY_YEARS = 10;

/**
 * @param {{ year: number; eps: number }[]} series
 * @param {number} [maxYears]
 * @returns {{ start: { year: number; eps: number }; end: { year: number; eps: number }; periodYears: number; fromListing: boolean } | null}
 */
export function epsGrowthWindow(series, maxYears = EPS_GROWTH_HISTORY_YEARS) {
  const sorted = (series ?? [])
    .filter((s) => s.year > 0 && s.eps > 0)
    .sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return null;

  const end = sorted[sorted.length - 1];
  const listingSpan = end.year - sorted[0].year;
  const fromListing = listingSpan < maxYears;
  const start = fromListing
    ? sorted[0]
    : (sorted.find((s) => s.year >= end.year - maxYears) ?? sorted[0]);

  const periodYears = end.year - start.year;
  if (periodYears < 1) return null;

  return { start, end, periodYears, fromListing };
}

/**
 * 연간 EPS CAGR: (EPS_최근 / EPS_과거)^(1/기간년수) − 1
 * @param {{ year: number; eps: number }[]} series
 * @param {number} [maxYears]
 */
export function epsCagrFromHistory(series, maxYears = EPS_GROWTH_HISTORY_YEARS) {
  const window = epsGrowthWindow(series, maxYears);
  if (!window) return null;
  const ratio = window.end.eps / window.start.eps;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const cagr = ratio ** (1 / window.periodYears) - 1;
  return Number.isFinite(cagr) ? cagr : null;
}

/**
 * @param {{ year: number; eps: number }[]} series
 */
function formatEpsCagrSource(series) {
  const window = epsGrowthWindow(series);
  if (!window) return "EPS CAGR";
  const { start, end, periodYears, fromListing } = window;
  const spanNote = fromListing ? `, API 가용 ${periodYears}년` : "";
  return `EPS CAGR ${start.year}→${end.year} (${periodYears}년${spanNote})`;
}

/** @param {number} v */
function fmtEpsNum(v) {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString("ko-KR");
  const rounded = Math.round(v * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** @param {number} v */
function fmtPct(v) {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * @param {{ year: number; eps: number }[]} series
 * @param {number} value
 */
function buildEpsCagrDetail(series, value) {
  const window = epsGrowthWindow(series);
  if (!window) {
    return { method: "eps_cagr", lines: ["연간 EPS 이력 CAGR", `결과: ${fmtPct(value)}`] };
  }
  const { start, end, periodYears, fromListing } = window;
  const startEps = fmtEpsNum(start.eps);
  const endEps = fmtEpsNum(end.eps);
  return {
    method: "eps_cagr",
    lines: [
      "연간 EPS 이력으로 CAGR 산출",
      fromListing
        ? `구간: ${start.year}→${end.year} (상장 ${periodYears}년, 전체 이력)`
        : `구간: ${start.year}→${end.year} (최근 ${periodYears}년)`,
      `시작 EPS (${start.year}): ${startEps}`,
      `종료 EPS (${end.year}): ${endEps}`,
      `식: (${endEps} ÷ ${startEps})^(1/${periodYears}) − 1`,
      `결과: ${fmtPct(value)}`,
    ],
  };
}

/**
 * @param {{
 *   eps: number | null;
 *   forwardEps: number | null;
 *   revenueGrowth: number | null;
 *   epsHistory?: { year: number; eps: number }[];
 * }} f
 */
export function deriveValueInvestGrowth10y(f) {
  /** @type {string[]} */
  const warnings = [];

  const histGrowth = epsCagrFromHistory(f.epsHistory ?? []);
  if (histGrowth != null && Number.isFinite(histGrowth)) {
    if (histGrowth < -0.4) {
      warnings.push(`EPS CAGR ${(histGrowth * 100).toFixed(1)}% — 음수 성장 구간`);
    }
    return {
      value: histGrowth,
      source: formatEpsCagrSource(f.epsHistory ?? []),
      detail: buildEpsCagrDetail(f.epsHistory ?? [], histGrowth),
      warnings,
    };
  }

  const rg = f.revenueGrowth;
  if (rg != null && Number.isFinite(rg)) {
    return {
      value: rg,
      source: "Yahoo revenueGrowth",
      detail: {
        method: "revenue_growth",
        lines: [
          "EPS 이력 부족 → Yahoo revenueGrowth 사용",
          "Yahoo Finance 매출 성장률 필드",
          `결과: ${fmtPct(rg)}`,
        ],
      },
      warnings,
    };
  }

  const eps = f.eps;
  const fwd = f.forwardEps;
  if (eps != null && eps > 0 && fwd != null && fwd > 0) {
    const implied1y = fwd / eps - 1;
    if (implied1y < -0.5) {
      warnings.push(`Forward÷Trailing ${(implied1y * 100).toFixed(0)}% — 급격한 이익 감소 구간`);
    }
    const trailing = fmtEpsNum(eps);
    const forward = fmtEpsNum(fwd);
    return {
      value: implied1y,
      source: "Forward EPS ÷ Trailing EPS (차기 1년 추정)",
      detail: {
        method: "forward_trailing",
        lines: [
          "EPS 이력 부족 → Forward÷Trailing 폴백",
          `Trailing EPS: ${trailing}`,
          `Forward EPS: ${forward}`,
          `식: (${forward} ÷ ${trailing}) − 1`,
          `결과: ${fmtPct(implied1y)} (차기 1년 추정, 10년 CAGR 아님)`,
        ],
      },
      warnings,
    };
  }

  return { value: null, source: null, detail: null, warnings };
}
