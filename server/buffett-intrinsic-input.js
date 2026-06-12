/**
 * 버핏식 내재가치 — 실제 시장·재무 데이터만 조립 (가상 수치 없음)
 */
import {
  calcEpsVolatility,
  calcFullIntrinsic,
  calcImpliedYield,
  calcMarginOfSafetyPrice,
  calcSimpleFairPrice,
} from "./buffett-intrinsic-value.js";
import { fetchRiskFreeRate } from "./risk-free-rate.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";
import {
  loadFinancialPeriods,
  loadFinancialStatementDetail,
} from "./stock-financials.js";
import { extractPeriodMetricsFromDetail } from "./stock-financial-period-metrics.js";
import { buildHistoricalPeriodMetrics } from "./stock-financial-period-valuation.js";
import { parseStatementNumber } from "./stock-financials-analysis.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";

/** @param {unknown} v */
function numField(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object") {
    const raw = /** @type {{ raw?: unknown }} */ (v).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

/**
 * @param {string} symbol
 * @returns {Promise<{ shares: number | null; source: string | null }>}
 */
async function fetchSharesOutstanding(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  try {
    const data = await queueYahooRequest(() =>
      yahooGet(
        `/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=defaultKeyStatistics`,
      ),
    );
    const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    const shares =
      numField(stats?.sharesOutstanding) ??
      numField(stats?.impliedSharesOutstanding);
    if (shares != null && shares > 0) {
      return { shares, source: "Yahoo defaultKeyStatistics" };
    }
  } catch {
    /* ignore */
  }
  return { shares: null, source: null };
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"} market
 */
async function fetchHistoricalEpsSeries(symbol, market) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const periods = await loadFinancialPeriods(sym).catch(() => null);
  if (!periods?.periods?.length) {
    return { series: [], netIncomeSharesProxy: false, periodsMeta: null, sharesInfo: { shares: null } };
  }

  /** @type {Map<number, import("./stock-financials.js").FinancialPeriodRow>} */
  const byYear = new Map();
  for (const p of periods.periods) {
    if (p.kind !== "annual" || p.isForecast) continue;
    const y = Number(String(p.label ?? "").slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const existing = byYear.get(y);
    if (!existing || String(p.id).startsWith("n:a:")) {
      byYear.set(y, p);
    }
  }

  const annual = [...byYear.values()]
    .sort((a, b) => (b.endDateMs ?? 0) - (a.endDateMs ?? 0))
    .slice(0, 6);

  const sharesInfo =
    market === "us" ? await fetchSharesOutstanding(sym) : { shares: null };

  const details = await Promise.all(
    annual.map((p) =>
      loadFinancialStatementDetail(sym, p.id).catch(() => null),
    ),
  );

  /** @type {{ year: number; eps: number; label: string }[]} */
  const out = [];
  let usedNetIncomeShares = false;
  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const p = annual[i];
    if (!d || !p) continue;
    let m = extractPeriodMetricsFromDetail(d, {
      currency: periods.currency,
      market,
    });
    if (
      market === "us" &&
      p.kind === "annual" &&
      sharesInfo.shares != null &&
      sharesInfo.shares > 0
    ) {
      const fromNi = epsFromNetIncomeAndShares(d, sharesInfo.shares);
      if (fromNi != null) {
        m = { ...m, eps: fromNi };
        usedNetIncomeShares = true;
      }
    } else if (market === "us" && (m.eps == null || m.eps <= 0)) {
      m = await buildHistoricalPeriodMetrics(sym, p, m, d);
    }
    if (m.eps == null || m.eps <= 0) continue;
    const y = Number(String(p.label ?? d.label ?? "").slice(0, 4));
    out.push({
      year: Number.isFinite(y) ? y : 0,
      eps: m.eps,
      label: p.label ?? d.label ?? "",
    });
  }
  return {
    series: out.sort((a, b) => a.year - b.year),
    netIncomeSharesProxy: usedNetIncomeShares,
    periodsMeta: periods,
    sharesInfo,
  };
}

/**
 * @param {Awaited<ReturnType<typeof loadFinancialStatementDetail>>} detail
 * @param {number} shares
 */
function epsFromNetIncomeAndShares(detail, shares) {
  if (!detail?.sections?.length || shares <= 0) return null;
  for (const sec of detail.sections) {
    for (const row of sec.rows ?? []) {
      const n = String(row.label ?? "")
        .toLowerCase()
        .replace(/\s+/g, "");
      if (!n.includes("netincome") && !n.includes("당기순이익")) continue;
      const netIncome = parseStatementNumber(row.value, sec.unitNote ?? "");
      if (netIncome == null || netIncome <= 0) return null;
      return netIncome / shares;
    }
  }
  return null;
}

/** 버핏 DCF 10년 명시구간 성장률 상한 — 미래 예측 불확실성 반영 */
const BUFFETT_GROWTH_CAP = 0.25;

/**
 * @param {{ year: number; eps: number }[]} series
 * @param {{ eps: number | null; forwardEps: number | null }} fundamentals
 */
function deriveGrowth10y(series, fundamentals) {
  const positive = series.filter((s) => s.eps > 0);
  if (positive.length >= 3) {
    const first = positive[0];
    const last = positive[positive.length - 1];
    const span = last.year - first.year;
    if (span >= 2 && first.eps > 0 && last.eps > 0) {
      const cagr = (last.eps / first.eps) ** (1 / span) - 1;
      if (Number.isFinite(cagr)) {
        const capped = Math.min(cagr, BUFFETT_GROWTH_CAP);
        return {
          value: capped,
          source:
            cagr > BUFFETT_GROWTH_CAP
              ? `연간 EPS CAGR ${first.year}–${last.year} (${positive.length}개 실적) → 보수적 상한 ${BUFFETT_GROWTH_CAP * 100}%`
              : `연간 EPS CAGR ${first.year}–${last.year} (${positive.length}개 실적)`,
        };
      }
    }
  }

  const eps = fundamentals.eps;
  const fwd = fundamentals.forwardEps;
  if (eps != null && eps > 0 && fwd != null && fwd > 0) {
    const implied = fwd / eps - 1;
    if (Number.isFinite(implied)) {
      const capped = Math.min(implied, BUFFETT_GROWTH_CAP);
      return {
        value: capped,
        source:
          implied > BUFFETT_GROWTH_CAP
            ? (fundamentals.market === "kr"
                ? `Naver Forward EPS ÷ Trailing EPS → 보수적 상한 ${BUFFETT_GROWTH_CAP * 100}%`
                : `Yahoo Forward EPS ÷ Trailing EPS → 보수적 상한 ${BUFFETT_GROWTH_CAP * 100}%`)
            : (fundamentals.market === "kr"
                ? "Naver Forward EPS ÷ Trailing EPS"
                : "Yahoo Forward EPS ÷ Trailing EPS"),
      };
    }
  }

  return null;
}

/**
 * @param {{ revenueGrowth: number | null }} fundamentals
 * @param {number | null} growth10y
 */
function deriveGrowthTerminal(fundamentals, growth10y) {
  const rg = fundamentals.revenueGrowth;
  if (rg == null || !Number.isFinite(rg)) return null;
  const capped = Math.min(rg, growth10y ?? rg, 0.05);
  return {
    value: capped,
    source: "Yahoo revenueGrowth (잔여성장 상한 5%)",
  };
}

/**
 * @param {Awaited<ReturnType<typeof loadFinancialStatementDetail>>} detail
 * @param {number | null} shares
 */
function extractDebtPerShare(detail, shares) {
  if (!detail?.sections?.length || shares == null || shares <= 0) return null;

  /** @type {{ label: string; value: string; note?: string }[]} */
  const flat = [];
  for (const sec of detail.sections) {
    for (const row of sec.rows ?? []) {
      flat.push({ label: row.label, value: row.value, note: sec.unitNote });
    }
  }

  const findNum = (patterns) => {
    for (const row of flat) {
      const n = String(row.label ?? "").toLowerCase().replace(/\s+/g, "");
      if (patterns.some((p) => n.includes(p))) {
        const v = parseStatementNumber(row.value, row.note ?? "");
        if (v != null) return v;
      }
    }
    return null;
  };

  const totalLiab = findNum(["총부채", "totalliab", "total liabilities"]);
  const cash = findNum(["현금", "cashandcashequivalents", "cash"]);
  if (totalLiab == null) return null;

  const netDebt = totalLiab - Math.max(0, cash ?? 0);
  const unitNote = detail.sections[0]?.unitNote ?? "";
  let debtAbsolute = netDebt;
  if (unitNote.includes("억원")) {
    debtAbsolute = netDebt * 1e8;
  } else if (unitNote.toLowerCase().includes("million")) {
    debtAbsolute = netDebt * 1e6;
  }

  if (!Number.isFinite(debtAbsolute)) return null;
  return {
    value: debtAbsolute / shares,
    source: "최근 연간 재무제표 총부채−현금 ÷ 발행주식수",
  };
}

/**
 * @param {string} symbol
 * @param {{ marginOfSafety?: number; years?: number }} [opts]
 */
export async function loadBuffettIntrinsicValue(symbol, opts = {}) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const fundamentals = await loadStockFundamentals(sym);
  const market = fundamentals.market;
  const margin = opts.marginOfSafety ?? 0.25;
  const years = opts.years ?? 10;

  const [riskFree, epsHistory] = await Promise.all([
    fetchRiskFreeRate(market),
    fetchHistoricalEpsSeries(sym, market),
  ]);
  const epsSeries = epsHistory.series;
  const { periodsMeta, sharesInfo } = epsHistory;

  const eps0 = fundamentals.eps;
  const price = fundamentals.price;
  const warnings = [];
  const missing = [];

  if (eps0 == null || eps0 <= 0) {
    missing.push("Trailing EPS(주당순이익) 실데이터 없음 — 계산 불가");
  }
  if (price == null || price <= 0) {
    missing.push("현재가 실데이터 없음");
  }
  if (!riskFree?.rate) {
    missing.push("10년 국채 수익률 조회 실패");
  }

  const growth10y = deriveGrowth10y(epsSeries, fundamentals);
  if (epsHistory.netIncomeSharesProxy && growth10y) {
    growth10y.source = `${growth10y.source} · 연간 EPS=당기순이익÷Yahoo 발행주식수`;
  }
  const growthTerminal = deriveGrowthTerminal(fundamentals, growth10y?.value ?? null);

  let debtPerShare = null;
  if (periodsMeta?.periods?.length && sharesInfo.shares) {
    const latestAnnual = periodsMeta.periods
      .filter((p) => p.kind === "annual" && !p.isForecast)
      .sort((a, b) => (b.endDateMs ?? 0) - (a.endDateMs ?? 0))[0];
    if (latestAnnual) {
      try {
        const detail = await loadFinancialStatementDetail(sym, latestAnnual.id);
        const debt = extractDebtPerShare(detail, sharesInfo.shares);
        debtPerShare = debt;
        if (!debt) warnings.push("주당 순부채 산출 불가 — 부채 차감 생략");
      } catch {
        warnings.push("재무제표 부채 항목 조회 실패 — 부채 차감 생략");
      }
    }
  } else {
    warnings.push("발행주식수 또는 연간 재무제표 없음 — 부채 차감 생략");
  }

  const epsVol = calcEpsVolatility(epsSeries.map((s) => s.eps));
  if (epsVol != null && epsVol > 0.35) {
    warnings.push(`EPS 변동계수 ${(epsVol * 100).toFixed(0)}% — 순환·예측 난이도 높음`);
  }
  if (growth10y?.value != null && growth10y.value > 0.35) {
    warnings.push(
      `EPS 성장률 ${(growth10y.value * 100).toFixed(0)}% — 일시적 회복·기저효과일 수 있음`,
    );
  }

  const discountRate = riskFree?.rate ?? null;
  const simpleFairPrice =
    eps0 != null && eps0 > 0 && discountRate
      ? calcSimpleFairPrice(eps0, discountRate)
      : null;

  let full = null;
  if (eps0 != null && eps0 > 0 && discountRate && growth10y) {
    full = calcFullIntrinsic({
      eps0,
      growth10y: growth10y.value,
      growthTerminal: growthTerminal?.value ?? null,
      years,
      discountRate,
      debtPerShare: debtPerShare?.value ?? null,
    });
    if (full?.terminalDetail?.gapWarning) {
      warnings.push("할인율−잔여성장 격차 3%p 미만 — 잔여가치 민감");
    }
    if (!growthTerminal) {
      warnings.push("매출 성장률(revenueGrowth) 없음 — 10년 명시구간만 합산(잔여가치 생략)");
    }
  } else if (!growth10y) {
    missing.push("EPS 성장률 산출 불가(연간 EPS 3개 이상 또는 Forward/Trailing 필요)");
  }

  const intrinsic = full?.intrinsicPerShare ?? simpleFairPrice;
  const impliedYield = calcImpliedYield(eps0 ?? 0, price ?? 0);
  const hurdleSpread =
    impliedYield != null && discountRate != null
      ? impliedYield - discountRate
      : null;
  const mosPrice =
    intrinsic != null ? calcMarginOfSafetyPrice(intrinsic, margin) : null;

  let verdict = null;
  if (price != null && intrinsic != null && intrinsic > 0) {
    const gapPct = ((intrinsic - price) / price) * 100;
    if (mosPrice != null && price <= mosPrice) verdict = "below_margin";
    else if (price < intrinsic) verdict = "below_intrinsic";
    else if (gapPct < -15) verdict = "rich";
    else verdict = "near_fair";
  }

  return {
    symbol: sym,
    name: fundamentals.name,
    currency: fundamentals.currency,
    market,
    updatedAtMs: Date.now(),
    inputs: {
      eps0,
      epsSource: fundamentals.source,
      forwardEps: fundamentals.forwardEps,
      price,
      discountRate,
      discountRatePct: riskFree?.ratePct ?? null,
      discountRateSource: riskFree?.source ?? null,
      discountRateAsOfMs: riskFree?.asOfMs ?? null,
      growth10y: growth10y?.value ?? null,
      growth10ySource: growth10y?.source ?? null,
      growthTerminal: growthTerminal?.value ?? null,
      growthTerminalSource: growthTerminal?.source ?? null,
      years,
      debtPerShare: debtPerShare?.value ?? null,
      debtPerShareSource: debtPerShare?.source ?? null,
      sharesOutstanding: sharesInfo.shares,
      marginOfSafety: margin,
    },
    historicalEps: epsSeries,
    outputs: {
      simpleFairPrice,
      explicitPv: full?.explicitPv ?? null,
      terminalPv: full?.terminalPv ?? null,
      intrinsicPerShare: intrinsic,
      marginOfSafetyPrice: mosPrice,
      impliedYield,
      hurdleSpread,
      yearly: full?.yearly ?? null,
      verdict,
    },
    quality: {
      epsVolatility: epsVol,
      warnings,
      missing,
      computable: Boolean(simpleFairPrice || full?.intrinsicPerShare),
    },
    disclaimer:
      "실제 공시·시장 데이터 기반 추정이며 투자 권유가 아닙니다. 성장·할인 가정에 따라 결과가 크게 달라집니다.",
  };
}
