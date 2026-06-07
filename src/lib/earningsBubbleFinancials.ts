import {
  fetchFinancialPeriods,
  fetchFinancialStatementAnalysis,
} from "../api";
import { formatPercent, formatPrice } from "./format";
import {
  buildPeerPerComparison,
  type PeerPerComparison,
} from "./peerPerComparison";

const CACHE_TTL_MS = 5 * 60_000;

/** @type {Map<string, { at: number; data: EarningsBubbleFinancialSummary | null }>} */
const cache = new Map();

export type EarningsBubbleFinancialSummary = {
  periodLabel: string;
  currency: string;
  per: number | null;
  eps: number | null;
  pbr: number | null;
  profitMargin: number | null;
  roe: number | null;
  revenueYoyPct: number | null;
  netIncomeYoyPct: number | null;
  peerGroup: string | null;
  peerMedianPer: number | null;
};

function findRowYoy(
  sections: Array<{ rows?: Array<{ label: string; yoyPct?: number | null }> }> | undefined,
  pattern: RegExp,
): number | null {
  for (const sec of sections ?? []) {
    for (const row of sec.rows ?? []) {
      if (!pattern.test(row.label)) continue;
      const pct = row.yoyPct;
      return pct != null && Number.isFinite(pct) ? pct : null;
    }
  }
  return null;
}

export async function loadEarningsBubbleFinancials(
  symbol: string,
  signal?: AbortSignal,
): Promise<EarningsBubbleFinancialSummary | null> {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;

  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  try {
    const periods = await fetchFinancialPeriods(sym, signal);
    const first = periods.periods?.[0];
    if (!first) {
      cache.set(sym, { at: Date.now(), data: null });
      return null;
    }

    const analysis = await fetchFinancialStatementAnalysis(sym, first.id, signal);
    const pm = analysis.periodMetrics;
    const peer = analysis.peerComparison;
    const data: EarningsBubbleFinancialSummary = {
      periodLabel: first.label,
      currency: pm.currency ?? periods.currency ?? "USD",
      per: pm.per,
      eps: pm.eps,
      pbr: pm.pbr,
      profitMargin: pm.profitMargin,
      roe: pm.roe,
      revenueYoyPct: findRowYoy(analysis.sections, /매출|revenue|totalrevenue|sales/i),
      netIncomeYoyPct: findRowYoy(
        analysis.sections,
        /당기순이익|순이익|netincome/i,
      ),
      peerGroup: peer?.peerGroup ?? null,
      peerMedianPer: peer?.medianPer ?? null,
    };
    cache.set(sym, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (signal?.aborted) throw e;
    cache.set(sym, { at: Date.now(), data: null });
    return null;
  }
}

function fmtRatio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}배`;
}

function fmtEps(v: number | null | undefined, currency: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (currency === "KRW") return `${Math.round(v).toLocaleString("ko-KR")}원`;
  return formatPrice(v, currency);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatPercent(v);
}

function fmtYoy(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

/** @param {EarningsBubbleFinancialSummary} s @param {typeof import("../i18n/ko").ko.macro} labels */
export function formatEarningsBubbleFinancialLines(
  s: EarningsBubbleFinancialSummary,
  labels: {
    per: string;
    eps: string;
    pbr: string;
    profitMargin: string;
    roe: string;
    yoyRevenue: string;
    yoyNetIncome: string;
    peerMedianPer: string;
    vsPeerHigh: string;
    vsPeerLow: string;
    vsPeerSimilar: string;
  },
) {
  const line1 = `${labels.per} ${fmtRatio(s.per)} · ${labels.eps} ${fmtEps(s.eps, s.currency)} · ${labels.pbr} ${fmtRatio(s.pbr)}`;
  const line2 = `${labels.profitMargin} ${fmtPct(s.profitMargin != null ? s.profitMargin * 100 : null)} · ${labels.roe} ${fmtPct(s.roe != null ? s.roe * 100 : null)}`;
  let peerLine: PeerPerComparison | null = null;
  if (
    s.per != null &&
    s.peerMedianPer != null &&
    s.peerGroup &&
    Number.isFinite(s.per) &&
    Number.isFinite(s.peerMedianPer)
  ) {
    peerLine = buildPeerPerComparison(s.per, s.peerMedianPer, s.peerGroup, {
      vsPeerHigh: labels.vsPeerHigh,
      vsPeerLow: labels.vsPeerLow,
      vsPeerSimilar: labels.vsPeerSimilar,
    });
  }
  /** @type {{ text: string; yoyPct?: number | null }[]} */
  const yoyLines = [];
  if (s.revenueYoyPct != null) {
    yoyLines.push({
      text: `${labels.yoyRevenue} ${fmtYoy(s.revenueYoyPct)}`,
      yoyPct: s.revenueYoyPct,
    });
  }
  if (s.netIncomeYoyPct != null) {
    yoyLines.push({
      text: `${labels.yoyNetIncome} ${fmtYoy(s.netIncomeYoyPct)}`,
      yoyPct: s.netIncomeYoyPct,
    });
  }
  return { line1, line2, peerLine, yoyLines };
}
