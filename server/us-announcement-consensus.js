/**
 * Yahoo — 컨센(earningsTrend) + 실적 히스토리(earningsHistory)
 */
import { yahooGet } from "./yahoo.js";
import { queueYahooRequest } from "./yahoo-queue.js";

/**
 * @param {unknown} data
 */
function quoteSummaryFirstResult(data) {
  const root = /** @type {Record<string, unknown>} */ (data ?? {});
  if (root.finance && typeof root.finance === "object") {
    const fin = /** @type {Record<string, unknown>} */ (root.finance);
    if (fin.error) return null;
  }
  const qs = root.quoteSummary;
  if (!qs || typeof qs !== "object") return null;
  const results = /** @type {unknown[]} */ (
    /** @type {Record<string, unknown>} */ (qs).result
  );
  if (!Array.isArray(results) || results.length === 0) return null;
  return /** @type {Record<string, unknown>} */ (results[0]);
}

/**
 * @param {unknown} node
 * @returns {number | null}
 */
function rawNum(node) {
  if (node == null) return null;
  if (typeof node === "number" && Number.isFinite(node)) return node;
  if (typeof node === "object") {
    const raw = /** @type {Record<string, unknown>} */ (node).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

/**
 * @typedef {{
 *   epsAvg: number | null;
 *   yearAgoEps: number | null;
 *   numAnalysts: number | null;
 *   growthPct: number | null;
 * }} TrendPeriod
 */

/**
 * @param {string} symbol
 */
export async function fetchYahooConsensusSnapshot(symbol) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const enc = encodeURIComponent(sym);
  const modules = [
    "earningsTrend",
    "earningsHistory",
    "defaultKeyStatistics",
    "summaryDetail",
  ].join(",");
  const data = await queueYahooRequest(() =>
    yahooGet(`/v10/finance/quoteSummary/${enc}?modules=${modules}`),
  );
  const r0 = quoteSummaryFirstResult(data);
  if (!r0) {
    return {
      symbol: sym,
      forwardEps: null,
      trailingEps: null,
      periods: {},
      lastReported: null,
      at: Date.now(),
    };
  }

  const stats =
    r0.defaultKeyStatistics && typeof r0.defaultKeyStatistics === "object"
      ? /** @type {Record<string, unknown>} */ (r0.defaultKeyStatistics)
      : {};
  const summary =
    r0.summaryDetail && typeof r0.summaryDetail === "object"
      ? /** @type {Record<string, unknown>} */ (r0.summaryDetail)
      : {};
  const forwardEps =
    rawNum(stats.forwardEps) ?? rawNum(summary.epsForward);
  const trailingEps =
    rawNum(stats.trailingEps) ??
    rawNum(summary.trailingEps) ??
    rawNum(summary.epsTrailingTwelveMonths);

  /** @type {Record<string, TrendPeriod>} */
  const periods = {};
  const et =
    r0.earningsTrend && typeof r0.earningsTrend === "object"
      ? /** @type {Record<string, unknown>} */ (r0.earningsTrend)
      : null;
  const trend = Array.isArray(et?.trend) ? et.trend : [];
  for (const row of trend) {
    if (!row || typeof row !== "object") continue;
    const period = String(/** @type {Record<string, unknown>} */ (row).period ?? "");
    if (!period) continue;
    const est = /** @type {Record<string, unknown>} */ (row).earningsEstimate;
    const growth = /** @type {Record<string, unknown>} */ (row).growth;
    const epsAvg =
      est && typeof est === "object"
        ? rawNum(/** @type {Record<string, unknown>} */ (est).avg)
        : null;
    const yearAgoEps =
      est && typeof est === "object"
        ? rawNum(/** @type {Record<string, unknown>} */ (est).yearAgoEps)
        : null;
    const numAnalysts =
      est && typeof est === "object"
        ? rawNum(/** @type {Record<string, unknown>} */ (est).numberOfAnalysts)
        : null;
    let growthPct = rawNum(growth);
    if (growthPct != null && Math.abs(growthPct) <= 5) {
      // Yahoo often returns ratio (0.12) not percent
      growthPct = Math.round(growthPct * 1000) / 10;
    }
    periods[period] = {
      epsAvg,
      yearAgoEps,
      numAnalysts,
      growthPct,
    };
  }

  /** @type {{ epsActual: number | null; epsEstimate: number | null; surprisePct: number | null } | null} */
  let lastReported = null;
  const eh =
    r0.earningsHistory && typeof r0.earningsHistory === "object"
      ? /** @type {Record<string, unknown>} */ (r0.earningsHistory)
      : null;
  const history = Array.isArray(eh?.history) ? eh.history : [];
  if (history.length) {
    const last = history[0];
    if (last && typeof last === "object") {
      const row = /** @type {Record<string, unknown>} */ (last);
      const epsActual = rawNum(row.epsActual);
      const epsEstimate = rawNum(row.epsEstimate);
      let surprisePct = rawNum(row.surprisePercent);
      if (
        surprisePct == null &&
        epsActual != null &&
        epsEstimate != null &&
        epsEstimate !== 0
      ) {
        surprisePct =
          Math.round(((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 1000) /
          10;
      } else if (surprisePct != null && Math.abs(surprisePct) <= 5) {
        surprisePct = Math.round(surprisePct * 1000) / 10;
      }
      lastReported = { epsActual, epsEstimate, surprisePct };
    }
  }

  return {
    symbol: sym,
    forwardEps,
    trailingEps,
    periods,
    lastReported,
    at: Date.now(),
  };
}

/**
 * @param {{ epsAvg: number | null } | undefined} prev
 * @param {{ epsAvg: number | null } | undefined} next
 * @param {number} [minAbsPct]
 */
export function consensusEpsChangedEnough(prev, next, minAbsPct = 2) {
  const a = prev?.epsAvg;
  const b = next?.epsAvg;
  if (a == null || b == null) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return false;
  const pct = ((b - a) / Math.abs(a)) * 100;
  return Math.abs(pct) >= minAbsPct;
}

/**
 * 공시 카드용 — Yahoo 스냅으로 비교 지표 채우기
 * @param {string} kind
 * @param {Awaited<ReturnType<typeof fetchYahooConsensusSnapshot>>} snap
 * @param {{ priorQuarterEpsAvg?: number | null; priorForwardEps?: number | null }} [prior]
 */
export function metricsFromYahooSnapshot(kind, snap, prior = {}) {
  const q0 = snap?.periods?.["0q"] ?? null;
  const y0 = snap?.periods?.["0y"] ?? null;
  const forwardEps = snap?.forwardEps ?? y0?.epsAvg ?? null;
  const trailingEps = snap?.trailingEps ?? null;
  const quarterCons = q0?.epsAvg ?? null;
  const yearAgo = q0?.yearAgoEps ?? null;
  const last = snap?.lastReported ?? null;

  /** @type {string | null} */
  let vsConsensusLabel = null;
  /** @type {number | null} */
  let vsConsensusPct = null;
  /** @type {string | null} */
  let yoyLabel = null;
  /** @type {number | null} */
  let yoyPct = null;
  /** @type {string | null} */
  let consensusChangeLabel = null;
  /** @type {number | null} */
  let consensusChangePct = null;

  // 컨센 대비: 최근 확정 분기 Beat/Miss 우선, 없으면 포워드 vs 당분기 컨센
  if (last?.surprisePct != null) {
    vsConsensusPct = last.surprisePct;
    vsConsensusLabel = `최근 확정 EPS(${fmtNum(last.epsActual)}) vs 당시 컨센(${fmtNum(last.epsEstimate)})`;
  } else if (
    kind === "guidance" &&
    forwardEps != null &&
    quarterCons != null &&
    forwardEps !== quarterCons
  ) {
    vsConsensusPct = pct(forwardEps, quarterCons);
    vsConsensusLabel = `포워드 EPS(${fmtNum(forwardEps)}) vs 당분기 컨센(${fmtNum(quarterCons)})`;
  }

  // 전년 대비: 당분기 컨센 vs 전년 동기 EPS, 또는 Yahoo growth, 또는 포워드 vs 트레일링(명시)
  if (quarterCons != null && yearAgo != null && yearAgo !== 0) {
    yoyPct = pct(quarterCons, yearAgo);
    yoyLabel = `당분기 컨센 EPS(${fmtNum(quarterCons)}) vs 전년 동기 EPS(${fmtNum(yearAgo)})`;
  } else if (q0?.growthPct != null) {
    yoyPct = q0.growthPct;
    yoyLabel = `Yahoo 당분기 EPS 성장률(컨센 기준, 전년 동기 대비)`;
  } else if (forwardEps != null && trailingEps != null && trailingEps !== 0) {
    yoyPct = pct(forwardEps, trailingEps);
    yoyLabel = `포워드 EPS(${fmtNum(forwardEps)}) vs 트레일링 EPS(${fmtNum(trailingEps)}) — 전년 실적 YoY 아님`;
  }

  const priorQ = prior.priorQuarterEpsAvg;
  const priorF = prior.priorForwardEps;
  if (quarterCons != null && priorQ != null && priorQ !== 0) {
    consensusChangePct = pct(quarterCons, priorQ);
    consensusChangeLabel = `당분기 컨센 EPS 직전 스냅(${fmtNum(priorQ)}) → 현재(${fmtNum(quarterCons)})`;
  } else if (forwardEps != null && priorF != null && priorF !== 0) {
    consensusChangePct = pct(forwardEps, priorF);
    consensusChangeLabel = `포워드 EPS 직전 스냅(${fmtNum(priorF)}) → 현재(${fmtNum(forwardEps)})`;
  }

  return {
    consensusEps: forwardEps,
    priorConsensusEps: priorF ?? priorQ ?? null,
    guidanceEps: null,
    trailingEps,
    quarterConsensusEps: quarterCons,
    yearAgoEps: yearAgo,
    reportedEps: last?.epsActual ?? null,
    reportedConsensusEps: last?.epsEstimate ?? null,
    yoyPct,
    vsConsensusPct,
    consensusChangePct,
    vsConsensusLabel,
    yoyLabel,
    consensusChangeLabel,
    period: q0 ? "0q" : y0 ? "0y" : null,
    numAnalysts: q0?.numAnalysts ?? y0?.numAnalysts ?? null,
  };
}

/**
 * @param {number | null | undefined} a
 * @param {number | null | undefined} b
 */
function pct(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return null;
  return Math.round(((x - y) / Math.abs(y)) * 1000) / 10;
}

/**
 * @param {number | null | undefined} n
 */
function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(2);
}
