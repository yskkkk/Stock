/**
 * Yahoo — 컨센(earningsTrend) 스냅샷
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
 * @param {string} symbol
 */
export async function fetchYahooConsensusSnapshot(symbol) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const enc = encodeURIComponent(sym);
  const modules = [
    "earningsTrend",
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

  /** @type {Record<string, { epsAvg: number | null; numAnalysts: number | null }>} */
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
    if (!est || typeof est !== "object") continue;
    periods[period] = {
      epsAvg: rawNum(/** @type {Record<string, unknown>} */ (est).avg),
      numAnalysts: rawNum(
        /** @type {Record<string, unknown>} */ (est).numberOfAnalysts,
      ),
    };
  }

  return {
    symbol: sym,
    forwardEps,
    trailingEps,
    periods,
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
