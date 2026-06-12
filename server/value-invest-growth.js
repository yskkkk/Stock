/**
 * 10년 수익 모델 — 성장률 산출 (연간 EPS 이력 CAGR)
 */

/** 10년 복리 가정 상한 (단기 EPS 이력·1년 추정 폴백) */
export const GROWTH_10Y_CAP = 0.25;

/** EPS CAGR 산출에 쓰는 최대 연수 */
export const EPS_GROWTH_HISTORY_YEARS = 10;

/** 이 연수 이하 연말 EPS만 있으면 CAGR 왜곡 방지를 위해 상한 적용 */
export const EPS_SHORT_HISTORY_CAP_YEARS = 3;

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

  // 구간 내 양수 EPS 없는 연도 수 (CAGR 왜곡 감지용)
  const positiveInRange = sorted.filter((s) => s.year >= start.year && s.year <= end.year);
  const gapYearsCount = (periodYears + 1) - positiveInRange.length;

  return { start, end, periodYears, fromListing, gapYearsCount };
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

/** @param {{ year: number; eps: number }[]} series */
export function buildEpsGrowthByYear(series) {
  const sorted = (series ?? [])
    .filter((s) => s.year > 0 && s.eps > 0)
    .sort((a, b) => a.year - b.year);
  return sorted.map((row, i) => ({
    year: row.year,
    eps: row.eps,
    yoyPct: i === 0 ? null : ((row.eps / sorted[i - 1].eps) - 1) * 100,
  }));
}

/** @param {{ year: number; eps: number }[]} series */
function countPositiveEpsYears(series) {
  return (series ?? []).filter((s) => s.year > 0 && s.eps > 0).length;
}

/** @param {{ year: number; eps: number }[]} series */
function shouldCapShortEpsHistory(series) {
  return countPositiveEpsYears(series) <= EPS_SHORT_HISTORY_CAP_YEARS;
}

/**
 * @param {{ year: number; eps: number }[]} series
 * @param {number} [rawGrowth]
 * @param {number} [appliedGrowth]
 */
function formatEpsCagrSource(series, rawGrowth, appliedGrowth) {
  const window = epsGrowthWindow(series);
  if (!window) return "EPS CAGR";
  const { start, end, periodYears, fromListing } = window;
  const spanNote = fromListing ? `, API 가용 ${periodYears}년` : "";
  const base = `EPS CAGR ${start.year}→${end.year} (${periodYears}년${spanNote})`;
  if (
    rawGrowth != null &&
    appliedGrowth != null &&
    rawGrowth > GROWTH_10Y_CAP &&
    appliedGrowth === GROWTH_10Y_CAP
  ) {
    return `${base} → 10년 상한 ${GROWTH_10Y_CAP * 100}%`;
  }
  return base;
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
 * @param {number} rawGrowth
 * @param {number} appliedGrowth
 */
function buildEpsCagrDetail(series, rawGrowth, appliedGrowth) {
  const window = epsGrowthWindow(series);
  if (!window) {
    return { method: "eps_cagr", lines: ["연간 EPS 이력 CAGR", `결과: ${fmtPct(appliedGrowth)}`] };
  }
  const { start, end, periodYears, fromListing } = window;
  const startEps = fmtEpsNum(start.eps);
  const endEps = fmtEpsNum(end.eps);
  const capped =
    rawGrowth > GROWTH_10Y_CAP &&
    appliedGrowth === GROWTH_10Y_CAP &&
    shouldCapShortEpsHistory(series);
  /** @type {string[]} */
  const lines = [
    "연말 결산 EPS 이력 CAGR (분기·전망 제외)",
    fromListing
      ? `구간: ${start.year}→${end.year} (API 가용 ${periodYears}년, 연말 실적 전체)`
      : `구간: ${start.year}→${end.year} (최근 ${periodYears}년 연말 실적)`,
    `시작 EPS (${start.year}): ${startEps}`,
    `종료 EPS (${end.year}): ${endEps}`,
    `식: (${endEps} ÷ ${startEps})^(1/${periodYears}) − 1`,
    `원 CAGR: ${fmtPct(rawGrowth)}`,
  ];
  if (capped) {
    lines.push(
      `단기 이력 ${countPositiveEpsYears(series)}년 — 10년 복리 가정 ${fmtPct(GROWTH_10Y_CAP)} 상한`,
    );
  }
  lines.push(`적용: ${fmtPct(appliedGrowth)}`);
  return {
    method: "eps_cagr",
    lines,
    table: buildEpsGrowthByYear(series),
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

  const epsHistory = f.epsHistory ?? [];
  const histGrowth = epsCagrFromHistory(epsHistory);
  if (histGrowth != null && Number.isFinite(histGrowth)) {
    const window = epsGrowthWindow(epsHistory);
    if (window != null && window.gapYearsCount > 0) {
      warnings.push(
        `EPS CAGR 구간 ${window.periodYears}년 내 음수/결손 ${window.gapYearsCount}개 연도 포함 — CAGR 왜곡 가능`,
      );
    }
    const shortHistory = shouldCapShortEpsHistory(epsHistory);
    const applied =
      shortHistory && histGrowth > GROWTH_10Y_CAP ? GROWTH_10Y_CAP : histGrowth;
    if (shortHistory && histGrowth > GROWTH_10Y_CAP) {
      warnings.push(
        `EPS CAGR ${(histGrowth * 100).toFixed(1)}% — 단기 이력 ${countPositiveEpsYears(epsHistory)}년, 10년 복리 ${GROWTH_10Y_CAP * 100}% 상한`,
      );
    } else if (histGrowth < -0.15) {
      warnings.push(`EPS CAGR ${(histGrowth * 100).toFixed(1)}% — 심각한 이익 감소 구간`);
    }
    return {
      value: applied,
      source: formatEpsCagrSource(epsHistory, histGrowth, applied),
      detail: buildEpsCagrDetail(epsHistory, histGrowth, applied),
      warnings,
    };
  }

  const rg = f.revenueGrowth;
  if (rg != null && Number.isFinite(rg)) {
    const capped = Math.min(rg, GROWTH_10Y_CAP);
    if (rg > GROWTH_10Y_CAP) {
      warnings.push(`매출 성장률 ${(rg * 100).toFixed(1)}% — 10년 상한 ${GROWTH_10Y_CAP * 100}% 적용`);
    }
    return {
      value: capped,
      source: "Yahoo revenueGrowth",
      detail: {
        method: "revenue_growth",
        lines: [
          "EPS 이력 부족 → Yahoo revenueGrowth 사용",
          "Yahoo Finance 매출 성장률 필드",
          rg > GROWTH_10Y_CAP
            ? `원: ${fmtPct(rg)} → 적용: ${fmtPct(capped)} (10년 상한)`
            : `결과: ${fmtPct(capped)}`,
        ],
      },
      warnings,
    };
  }

  const eps = f.eps;
  const fwd = f.forwardEps;
  if (eps != null && eps > 0 && fwd != null && fwd > 0) {
    const implied1y = fwd / eps - 1;
    if (implied1y > GROWTH_10Y_CAP) {
      warnings.push(
        `Forward EPS(${fwd.toLocaleString()})는 차기 1년 컨센서스, Trailing EPS(${eps.toLocaleString()}) 대비 +${(implied1y * 100).toFixed(0)}%입니다. 10년 성장률은 ${GROWTH_10Y_CAP * 100}% 상한을 적용했습니다.`,
      );
      const trailing = fmtEpsNum(eps);
      const forward = fmtEpsNum(fwd);
      return {
        value: GROWTH_10Y_CAP,
        source: `Forward÷Trailing +${(implied1y * 100).toFixed(0)}% (1년) → 10년 상한 ${GROWTH_10Y_CAP * 100}%`,
        detail: {
          method: "forward_trailing",
          lines: [
            "EPS 이력 부족 → Forward÷Trailing 폴백",
            `Trailing EPS: ${trailing}`,
            `Forward EPS: ${forward}`,
            `식: (${forward} ÷ ${trailing}) − 1`,
            `원: ${fmtPct(implied1y)} (차기 1년) → 적용: ${fmtPct(GROWTH_10Y_CAP)}`,
          ],
        },
        warnings,
      };
    }
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
