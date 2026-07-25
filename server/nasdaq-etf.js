/**
 * 나스닥 상장 ETF 목록 (Yahoo Finance screener, quoteType=ETF).
 */
import { resolveDisplayName } from "./names-ko.js";
import { getYahooSession, yahooPost } from "./yahoo.js";

/** Nasdaq Global Select / Global Market / Capital Market */
const NASDAQ_ETF_EXCHANGES = ["NMS", "NGM", "NAS", "NCM"];

const TARGET = (() => {
  const n = Number(process.env.STOCK_NASDAQ_ETF_TARGET ?? 2500);
  return Number.isFinite(n) && n >= 100 ? Math.min(n, 5000) : 2500;
})();

const CACHE_MS = 6 * 60 * 60 * 1000;

/** @type {{ data: object; at: number } | null} */
let cached = null;

/**
 * @param {string} region
 * @param {number} offset
 * @param {number} size
 * @param {string} exchange
 */
async function fetchEtfScreenerPage(region, offset, size, exchange) {
  const operands = [{ operator: "eq", operands: ["region", region] }];
  const ex = String(exchange ?? "").trim();
  if (ex) {
    operands.push({ operator: "eq", operands: ["exchange", ex] });
  }
  const body = {
    size,
    offset,
    sortField: "fundnetassets",
    sortType: "DESC",
    quoteType: "ETF",
    query: {
      operator: "AND",
      operands,
    },
  };

  let data;
  try {
    data = await yahooPost("/v1/finance/screener", body);
  } catch {
    // fundnetassets 미지원 시 시총 정렬로 재시도
    data = await yahooPost("/v1/finance/screener", {
      ...body,
      sortField: "intradaymarketcap",
    });
  }

  const quotes = data?.finance?.result?.[0]?.quotes ?? [];
  return quotes
    .map((q) => {
      const symbol = String(q.symbol ?? "").trim().toUpperCase();
      if (!symbol) return null;
      const exchangeCode = String(q.exchange ?? exchange ?? "").trim().toUpperCase();
      const exchDisp = String(q.exchDisp ?? q.fullExchangeName ?? "").trim();
      const priceRaw = q.regularMarketPrice ?? q.intradayprice;
      const changeRaw = q.regularMarketChangePercent ?? q.percentchange;
      const aumRaw = q.fundNetAssets ?? q.netAssets;
      return {
        symbol,
        name: resolveDisplayName(symbol, q.shortName, q.longName),
        exchange: exchangeCode || null,
        exchangeDisp: exchDisp || null,
        price:
          typeof priceRaw === "number" && Number.isFinite(priceRaw)
            ? priceRaw
            : null,
        changePercent:
          typeof changeRaw === "number" && Number.isFinite(changeRaw)
            ? changeRaw
            : null,
        netAssets:
          typeof aumRaw === "number" && Number.isFinite(aumRaw) ? aumRaw : null,
      };
    })
    .filter(Boolean);
}

/**
 * @param {string} region
 * @param {string} exchange
 * @param {number} target
 */
async function fetchExchangeEtfUniverse(region, exchange, target) {
  const out = [];
  const seen = new Set();
  const ex = String(exchange ?? "").trim();
  if (!ex) return [];

  for (
    let offset = 0;
    offset < Math.max(target * 4, 8_000) && out.length < target;
    offset += 250
  ) {
    try {
      const page = await fetchEtfScreenerPage(region, offset, 250, ex);
      for (const item of page) {
        if (!seen.has(item.symbol)) {
          seen.add(item.symbol);
          out.push(item);
        }
      }
      if (page.length < 50) break;
    } catch (e) {
      console.warn(
        "[nasdaq-etf] screener:",
        ex,
        e instanceof Error ? e.message : e,
      );
      break;
    }
  }

  return out;
}

/**
 * @returns {Promise<{
 *   etfs: Array<{
 *     symbol: string;
 *     name: string;
 *     exchange: string | null;
 *     exchangeDisp: string | null;
 *     price: number | null;
 *     changePercent: number | null;
 *     netAssets: number | null;
 *   }>;
 *   count: number;
 *   updatedAt: number;
 *   source: string;
 * }>}
 */
export async function fetchNasdaqEtfsPayload() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return cached.data;
  }

  await getYahooSession();
  const perEx = Math.ceil(TARGET / NASDAQ_ETF_EXCHANGES.length) + 200;
  /** @type {Map<string, object>} */
  const bySym = new Map();

  for (const ex of NASDAQ_ETF_EXCHANGES) {
    const part = await fetchExchangeEtfUniverse("us", ex, perEx);
    for (const row of part) {
      if (!bySym.has(row.symbol)) bySym.set(row.symbol, row);
    }
  }

  const etfs = [...bySym.values()].sort((a, b) => {
    const an = a.netAssets;
    const bn = b.netAssets;
    if (an != null && bn != null && an !== bn) return bn - an;
    if (an != null && bn == null) return -1;
    if (an == null && bn != null) return 1;
    return String(a.symbol).localeCompare(String(b.symbol));
  });

  const data = {
    etfs,
    count: etfs.length,
    updatedAt: now,
    source: "yahoo-screener-etf-nasdaq",
  };
  cached = { data, at: now };
  return data;
}
