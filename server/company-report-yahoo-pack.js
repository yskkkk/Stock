/**
 * 기업 보고서용 Yahoo quoteSummary 팩 (US)
 */
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";

/** @param {unknown} v */
export function yahooNum(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object") {
    const raw = /** @type {{ raw?: unknown }} */ (v).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const fmt = /** @type {{ fmt?: unknown }} */ (v).fmt;
    if (typeof fmt === "string") {
      const n = Number(String(fmt).replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** @param {unknown} v */
export function yahooStr(v) {
  if (typeof v === "string") return v.trim();
  if (v != null && typeof v === "object") {
    const fmt = /** @type {{ fmt?: unknown }} */ (v).fmt;
    if (typeof fmt === "string") return fmt.trim();
    const long = /** @type {{ longFmt?: unknown }} */ (v).longFmt;
    if (typeof long === "string") return long.trim();
  }
  return "";
}

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

const YAHOO_REPORT_MODULES = [
  "assetProfile",
  "summaryProfile",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "price",
  "earnings",
  "earningsTrend",
  "earningsHistory",
  "recommendationTrend",
  "upgradeDowngradeHistory",
  "institutionOwnership",
  "insiderHoldings",
  "insiderTransactions",
  "majorHoldersBreakdown",
  "fundOwnership",
  "calendarEvents",
  "esgScores",
  "netSharePurchaseActivity",
  "secFilings",
].join(",");

/**
 * @param {string} symbol
 */
export async function fetchYahooCompanyReportPack(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  const enc = encodeURIComponent(sym);
  try {
    const data = await queueYahooRequest(() =>
      yahooGet(
        `/v10/finance/quoteSummary/${enc}?modules=${YAHOO_REPORT_MODULES}`,
      ),
    );
    return quoteSummaryFirstResult(data);
  } catch {
    return null;
  }
}

/**
 * Yahoo pack → 평탄 팩트 맵
 * @param {Record<string, unknown> | null} pack
 */
export function flattenYahooReportFacts(pack) {
  if (!pack || typeof pack !== "object") {
    return /** @type {Record<string, unknown>} */ ({});
  }
  const profile =
    (pack.assetProfile && typeof pack.assetProfile === "object"
      ? /** @type {Record<string, unknown>} */ (pack.assetProfile)
      : null) ||
    (pack.summaryProfile && typeof pack.summaryProfile === "object"
      ? /** @type {Record<string, unknown>} */ (pack.summaryProfile)
      : {});
  const price =
    pack.price && typeof pack.price === "object"
      ? /** @type {Record<string, unknown>} */ (pack.price)
      : {};
  const summary =
    pack.summaryDetail && typeof pack.summaryDetail === "object"
      ? /** @type {Record<string, unknown>} */ (pack.summaryDetail)
      : {};
  const stats =
    pack.defaultKeyStatistics && typeof pack.defaultKeyStatistics === "object"
      ? /** @type {Record<string, unknown>} */ (pack.defaultKeyStatistics)
      : {};
  const fin =
    pack.financialData && typeof pack.financialData === "object"
      ? /** @type {Record<string, unknown>} */ (pack.financialData)
      : {};
  const holders =
    pack.majorHoldersBreakdown && typeof pack.majorHoldersBreakdown === "object"
      ? /** @type {Record<string, unknown>} */ (pack.majorHoldersBreakdown)
      : {};
  const esg =
    pack.esgScores && typeof pack.esgScores === "object"
      ? /** @type {Record<string, unknown>} */ (pack.esgScores)
      : {};
  const cal =
    pack.calendarEvents && typeof pack.calendarEvents === "object"
      ? /** @type {Record<string, unknown>} */ (pack.calendarEvents)
      : {};

  const officers = Array.isArray(profile.companyOfficers)
    ? profile.companyOfficers
        .slice(0, 12)
        .map((o) => {
          if (!o || typeof o !== "object") return null;
          const r = /** @type {Record<string, unknown>} */ (o);
          return {
            name: String(r.name ?? "").trim(),
            title: String(r.title ?? "").trim(),
            age: yahooNum(r.age),
            totalPay: yahooNum(r.totalPay),
          };
        })
        .filter(Boolean)
    : [];

  const insiderTx = Array.isArray(
    /** @type {{ transactions?: unknown }} */ (pack.insiderTransactions)
      ?.transactions,
  )
    ? /** @type {unknown[]} */ (
        /** @type {{ transactions: unknown[] }} */ (pack.insiderTransactions)
          .transactions
      )
        .slice(0, 20)
        .map((t) => {
          if (!t || typeof t !== "object") return null;
          const r = /** @type {Record<string, unknown>} */ (t);
          return {
            filerName: String(r.filerName ?? "").trim(),
            transactionText: String(r.transactionText ?? r.transactionCode ?? "").trim(),
            shares: yahooNum(r.shares),
            value: yahooNum(r.value),
            startDate: yahooStr(r.startDate) || yahooStr(r.ownership),
          };
        })
        .filter(Boolean)
    : [];

  const institutions = Array.isArray(
    /** @type {{ ownershipList?: unknown }} */ (pack.institutionOwnership)
      ?.ownershipList,
  )
    ? /** @type {unknown[]} */ (
        /** @type {{ ownershipList: unknown[] }} */ (pack.institutionOwnership)
          .ownershipList
      )
        .slice(0, 15)
        .map((t) => {
          if (!t || typeof t !== "object") return null;
          const r = /** @type {Record<string, unknown>} */ (t);
          const org =
            r.organization && typeof r.organization === "object"
              ? String(
                  /** @type {{ displayName?: unknown }} */ (r.organization)
                    .displayName ?? "",
                )
              : String(r.organization ?? "");
          return {
            organization: org.trim(),
            pctHeld: yahooNum(r.pctHeld),
            position: yahooNum(r.position),
            value: yahooNum(r.value),
          };
        })
        .filter(Boolean)
    : [];

  const recTrend = Array.isArray(
    /** @type {{ trend?: unknown }} */ (pack.recommendationTrend)?.trend,
  )
    ? /** @type {unknown[]} */ (
        /** @type {{ trend: unknown[] }} */ (pack.recommendationTrend).trend
      )
        .slice(0, 6)
        .map((t) => {
          if (!t || typeof t !== "object") return null;
          const r = /** @type {Record<string, unknown>} */ (t);
          return {
            period: String(r.period ?? "").trim(),
            strongBuy: yahooNum(r.strongBuy),
            buy: yahooNum(r.buy),
            hold: yahooNum(r.hold),
            sell: yahooNum(r.sell),
            strongSell: yahooNum(r.strongSell),
          };
        })
        .filter(Boolean)
    : [];

  const upgrades = Array.isArray(
    /** @type {{ history?: unknown }} */ (pack.upgradeDowngradeHistory)?.history,
  )
    ? /** @type {unknown[]} */ (
        /** @type {{ history: unknown[] }} */ (pack.upgradeDowngradeHistory)
          .history
      )
        .slice(0, 15)
        .map((t) => {
          if (!t || typeof t !== "object") return null;
          const r = /** @type {Record<string, unknown>} */ (t);
          return {
            firm: String(r.firm ?? "").trim(),
            toGrade: String(r.toGrade ?? "").trim(),
            fromGrade: String(r.fromGrade ?? "").trim(),
            action: String(r.action ?? "").trim(),
            epochGradeDate: yahooNum(r.epochGradeDate),
          };
        })
        .filter(Boolean)
    : [];

  return {
    longName: yahooStr(price.longName) || yahooStr(price.shortName),
    shortName: yahooStr(price.shortName),
    currency: yahooStr(price.currency) || yahooStr(summary.currency) || "USD",
    exchange: yahooStr(price.exchangeName) || yahooStr(price.fullExchangeName),
    sector: yahooStr(profile.sector),
    industry: yahooStr(profile.industry),
    country: yahooStr(profile.country),
    city: yahooStr(profile.city),
    website: yahooStr(profile.website),
    fullTimeEmployees: yahooNum(profile.fullTimeEmployees),
    longBusinessSummary: yahooStr(profile.longBusinessSummary),
    officers,
    price: yahooNum(price.regularMarketPrice) ?? yahooNum(fin.currentPrice),
    marketCap: yahooNum(summary.marketCap) ?? yahooNum(price.marketCap),
    enterpriseValue: yahooNum(stats.enterpriseValue),
    trailingPE: yahooNum(summary.trailingPE) ?? yahooNum(stats.trailingPE),
    forwardPE: yahooNum(summary.forwardPE) ?? yahooNum(stats.forwardPE),
    pegRatio: yahooNum(stats.pegRatio),
    priceToBook: yahooNum(stats.priceToBook) ?? yahooNum(summary.priceToBook),
    priceToSales: yahooNum(stats.priceToSalesTrailing12Months),
    enterpriseToRevenue: yahooNum(stats.enterpriseToRevenue),
    enterpriseToEbitda: yahooNum(stats.enterpriseToEbitda),
    trailingEps: yahooNum(stats.trailingEps),
    forwardEps: yahooNum(stats.forwardEps),
    bookValue: yahooNum(stats.bookValue),
    dividendYield:
      yahooNum(summary.dividendYield) ??
      yahooNum(summary.trailingAnnualDividendYield),
    dividendRate: yahooNum(summary.dividendRate),
    payoutRatio: yahooNum(summary.payoutRatio) ?? yahooNum(stats.payoutRatio),
    exDividendDate: yahooStr(summary.exDividendDate),
    beta: yahooNum(summary.beta) ?? yahooNum(stats.beta),
    fiftyTwoWeekHigh: yahooNum(summary.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: yahooNum(summary.fiftyTwoWeekLow),
    fiftyDayAverage: yahooNum(summary.fiftyDayAverage),
    twoHundredDayAverage: yahooNum(summary.twoHundredDayAverage),
    averageVolume: yahooNum(summary.averageVolume),
    averageVolume10days: yahooNum(summary.averageVolume10days),
    sharesOutstanding: yahooNum(stats.sharesOutstanding),
    floatShares: yahooNum(stats.floatShares),
    sharesShort: yahooNum(stats.sharesShort),
    shortRatio: yahooNum(stats.shortRatio),
    shortPercentOfFloat: yahooNum(stats.shortPercentOfFloat),
    heldPercentInsiders: yahooNum(stats.heldPercentInsiders),
    heldPercentInstitutions: yahooNum(stats.heldPercentInstitutions),
    impliedSharesOutstanding: yahooNum(stats.impliedSharesOutstanding),
    totalCash: yahooNum(fin.totalCash),
    totalDebt: yahooNum(fin.totalDebt),
    totalRevenue: yahooNum(fin.totalRevenue),
    revenuePerShare: yahooNum(fin.revenuePerShare),
    revenueGrowth: yahooNum(fin.revenueGrowth),
    earningsGrowth: yahooNum(fin.earningsGrowth),
    grossMargins: yahooNum(fin.grossMargins),
    operatingMargins: yahooNum(fin.operatingMargins),
    profitMargins: yahooNum(fin.profitMargins),
    ebitdaMargins: yahooNum(fin.ebitdaMargins),
    returnOnAssets: yahooNum(fin.returnOnAssets),
    returnOnEquity: yahooNum(fin.returnOnEquity),
    freeCashflow: yahooNum(fin.freeCashflow),
    operatingCashflow: yahooNum(fin.operatingCashflow),
    currentRatio: yahooNum(fin.currentRatio),
    quickRatio: yahooNum(fin.quickRatio),
    debtToEquity: yahooNum(fin.debtToEquity),
    targetHighPrice: yahooNum(fin.targetHighPrice),
    targetLowPrice: yahooNum(fin.targetLowPrice),
    targetMeanPrice: yahooNum(fin.targetMeanPrice),
    targetMedianPrice: yahooNum(fin.targetMedianPrice),
    recommendationKey: yahooStr(fin.recommendationKey),
    recommendationMean: yahooNum(fin.recommendationMean),
    numberOfAnalystOpinions: yahooNum(fin.numberOfAnalystOpinions),
    holdersInsidersPercent: yahooNum(holders.insidersPercentHeld),
    holdersInstitutionsPercent: yahooNum(holders.institutionsPercentHeld),
    holdersInstitutionsFloatPercent: yahooNum(
      holders.institutionsFloatPercentHeld,
    ),
    holdersInstitutionsCount: yahooNum(holders.institutionsCount),
    esgTotal: yahooNum(esg.totalEsg),
    esgEnvironment: yahooNum(esg.environmentScore),
    esgSocial: yahooNum(esg.socialScore),
    esgGovernance: yahooNum(esg.governanceScore),
    earningsDate: yahooStr(
      /** @type {{ earnings?: { earningsDate?: unknown } }} */ (cal).earnings
        ?.earningsDate,
    ),
    insiderTransactions: insiderTx,
    institutions,
    recommendationTrend: recTrend,
    upgradeDowngradeHistory: upgrades,
  };
}
