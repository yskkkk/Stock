/**
 * 기간별 PER·PBR — 공시 시점(추정) 주가 + 해당 기간 EPS/BPS
 */
import { parseStatementNumber } from "./stock-financials-analysis.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";

const CACHE_MS = 30 * 60_000;
const DISCLOSURE_LAG_DAYS = { quarter: 40, annual: 75 };

/** @type {Map<string, { at: number; data: unknown }>} */
const cache = new Map();

/** @param {string} key */
function getCache(key) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  return hit.data;
}

/** @param {string} key @param {unknown} data */
function setCache(key, data) {
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 300) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    const removeCount = Math.ceil(sorted.length * 0.2);
    for (let i = 0; i < removeCount; i++) cache.delete(sorted[i][0]);
  }
}

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

/** @param {number | null} num @param {number | null} den */
function safeRatio(num, den) {
  if (num == null || den == null || !Number.isFinite(num) || !Number.isFinite(den)) {
    return null;
  }
  if (Math.abs(den) < 1e-12) return null;
  return num / den;
}

/**
 * @param {string} symbol
 * @param {number} targetMs disclosure proxy (unix ms)
 */
export async function fetchHistoricalCloseNearDate(symbol, targetMs) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym || !Number.isFinite(targetMs)) return null;
  const dayKey = Math.floor(targetMs / 86_400_000);
  const cacheKey = `histClose:${sym}:${dayKey}`;
  const hit = getCache(cacheKey);
  if (hit !== undefined && hit !== null) return /** @type {number | null} */ (hit);

  const period1 = Math.floor((targetMs - 14 * 86_400_000) / 1000);
  const period2 = Math.floor((targetMs + 21 * 86_400_000) / 1000);
  const url = `/v8/finance/chart/${encodeURIComponent(sym)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;

  try {
    const data = await queueYahooRequest(() => yahooGet(url));
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const targetSec = Math.floor(targetMs / 1000);

    /** @type {{ sec: number; close: number }[]} */
    const bars = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
      bars.push({ sec: timestamps[i], close });
    }
    if (!bars.length) {
      setCache(cacheKey, null);
      return null;
    }

    const onOrAfter = bars.find((b) => b.sec >= targetSec);
    const picked = onOrAfter ?? bars.at(-1);
    setCache(cacheKey, picked?.close ?? null);
    return picked?.close ?? null;
  } catch {
    setCache(cacheKey, null);
    return null;
  }
}

/** @param {string} symbol */
async function fetchYahooEarningsHistory(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const cacheKey = `earnHist:${sym}`;
  const hit = getCache(cacheKey);
  if (hit != null) return /** @type {object[]} */ (hit);

  try {
    const data = await queueYahooRequest(() =>
      yahooGet(
        `/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=earningsHistory`,
      ),
    );
    const history =
      data?.quoteSummary?.result?.[0]?.earningsHistory?.history ?? [];
    setCache(cacheKey, history);
    return history;
  } catch {
    setCache(cacheKey, []);
    return [];
  }
}

/** @param {object[]} history @param {number} endRaw */
function matchEarningsByEndRaw(history, endRaw) {
  return (
    history.find(
      (h) =>
        h &&
        typeof h === "object" &&
        /** @type {{ quarter?: { raw?: number } }} */ (h).quarter?.raw === endRaw,
    ) ?? null
  );
}

/** @param {object[]} history @param {number} endRaw */
function ttmEpsFromHistory(history, endRaw) {
  const rows = history
    .filter(
      (h) =>
        typeof /** @type {{ quarter?: { raw?: number } }} */ (h).quarter?.raw ===
          "number" &&
        /** @type {{ quarter?: { raw?: number } }} */ (h).quarter.raw <= endRaw,
    )
    .sort(
      (a, b) =>
        /** @type {{ quarter?: { raw?: number } }} */ (b).quarter.raw -
        /** @type {{ quarter?: { raw?: number } }} */ (a).quarter.raw,
    )
    .slice(0, 4);
  if (rows.length < 2) return null;
  let sum = 0;
  for (const row of rows) {
    const eps = numField(/** @type {{ epsActual?: unknown }} */ (row).epsActual);
    if (eps == null) return null;
    sum += eps;
  }
  return sum;
}

/** @param {unknown} detail */
function rowNumberFromDetail(detail, patterns) {
  for (const sec of detail?.sections ?? []) {
    for (const row of sec?.rows ?? []) {
      const n = String(row?.label ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
      if (!patterns.some((p) => n.includes(p))) continue;
      return parseStatementNumber(row.value, sec?.unitNote);
    }
  }
  return null;
}

/**
 * @param {string} symbol
 * @param {{ endDateMs?: number | null; kind?: string } | null | undefined} period
 * @param {ReturnType<import("./stock-financial-period-metrics.js").extractPeriodMetricsFromDetail>} extracted
 * @param {unknown} detail
 */
export async function buildHistoricalPeriodMetrics(symbol, period, extracted, detail) {
  if (extracted.market === "kr") {
    return {
      ...extracted,
      valuationBasis: extracted.per != null ? "period_statement" : null,
    };
  }

  const endDateMs = period?.endDateMs;
  if (!endDateMs || !Number.isFinite(endDateMs)) {
    return extracted;
  }

  const kind = period?.kind === "annual" ? "annual" : "quarter";
  const lagDays = DISCLOSURE_LAG_DAYS[kind] ?? 40;
  const disclosureMs = endDateMs + lagDays * 86_400_000;
  const endRaw = Math.floor(endDateMs / 1000);

  const [histPrice, earningsHistory] = await Promise.all([
    fetchHistoricalCloseNearDate(symbol, disclosureMs),
    fetchYahooEarningsHistory(symbol),
  ]);

  let eps = extracted.eps;
  if (eps == null) {
    eps = ttmEpsFromHistory(earningsHistory, endRaw);
    if (eps == null) {
      const match = matchEarningsByEndRaw(earningsHistory, endRaw);
      const qEps = numField(match?.epsActual);
      if (qEps != null) eps = kind === "quarter" ? qEps * 4 : qEps;
    }
  }

  let bps = extracted.bps;
  const equity = rowNumberFromDetail(detail, [
    "totalstockholderequity",
    "stockholdersequity",
    "총자본",
    "자본총계",
  ]);
  const netIncome = rowNumberFromDetail(detail, [
    "netincome",
    "당기순이익",
    "순이익",
  ]);
  if (bps == null && equity != null && netIncome != null && eps != null && Math.abs(eps) > 0) {
    const shares = netIncome / eps;
    if (Math.abs(shares) > 0) bps = equity / shares;
  }

  const per =
    extracted.per ??
    (eps != null && eps > 0 && histPrice != null ? histPrice / eps : null);
  const pbr =
    extracted.pbr ??
    (bps != null && bps > 0 && histPrice != null ? histPrice / bps : null);

  return {
    ...extracted,
    price: histPrice,
    marketCap: null,
    eps,
    bps,
    per,
    pbr,
    forwardPer: null,
    forwardEps: null,
    dividendYield: extracted.dividendYield,
    valuationBasis: "disclosure_proxy",
    disclosureDateMs: disclosureMs,
  };
}
