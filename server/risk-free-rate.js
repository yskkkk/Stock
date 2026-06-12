/**
 * 무위험 수익률(10년 국채) — 실시간 시장 데이터만
 * KR: Naver 금융 국고채 10년 (KR10YT=RR)
 * US: Yahoo ^TNX (10년 미국채 수익률)
 */
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";

const CACHE_MS = 15 * 60_000;
const NAVER_BOND_URL =
  "https://m.stock.naver.com/front-api/marketIndex/productDetail?category=bond&reutersCode=KR10YT%3DRR";
const NAVER_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

/** @type {Map<string, { at: number; data: object }>} */
const cache = new Map();

/** @param {string} market */
function cacheKey(market) {
  return market === "kr" ? "kr10y" : "us10y";
}

/** @param {unknown} raw */
function parseYieldPct(raw) {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0 || n > 30) return null;
  return n / 100;
}

/** @returns {Promise<{ rate: number; ratePct: number; source: string; asOfMs: number | null } | null>} */
async function fetchKr10yBondYield() {
  const key = cacheKey("kr");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const res = await fetch(NAVER_BOND_URL, {
    headers: { "User-Agent": NAVER_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const ratePct = parseYieldPct(body?.result?.closePrice);
  if (ratePct == null) return null;

  let asOfMs = null;
  const traded = body?.result?.localTradedAt;
  if (typeof traded === "string") {
    const t = Date.parse(traded);
    if (Number.isFinite(t)) asOfMs = t;
  }

  const data = {
    rate: ratePct,
    ratePct: ratePct * 100,
    source: "Naver Finance · 한국 국채 10년 (KR10YT=RR)",
    asOfMs,
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** @returns {Promise<{ rate: number; ratePct: number; source: string; asOfMs: number | null } | null>} */
async function fetchUs10yTreasuryYield() {
  const key = cacheKey("us");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  try {
    const data = await queueYahooRequest(() =>
      yahooGet("/v8/finance/chart/%5ETNX?range=5d&interval=1d"),
    );
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.previousClose;
    const ratePct = parseYieldPct(price);
    if (ratePct == null) return null;

    const asOfMs =
      typeof meta?.regularMarketTime === "number"
        ? meta.regularMarketTime * 1000
        : null;

    const out = {
      rate: ratePct,
      ratePct: ratePct * 100,
      source: "Yahoo Finance · 미국 10년 국채 수익률 (^TNX)",
      asOfMs,
    };
    cache.set(key, { at: Date.now(), data: out });
    return out;
  } catch {
    return null;
  }
}

/**
 * @param {"kr"|"us"} market
 */
export async function fetchRiskFreeRate(market) {
  return market === "kr" ? fetchKr10yBondYield() : fetchUs10yTreasuryYield();
}
