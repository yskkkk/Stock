/**
 * 박스권 FSM용 체결가 — 빗썸 KRW 티커(매매 거래소와 동일) 우선, 짧은 TTL.
 */
import { isCryptoUsdtSymbol, loadBithumbKrwQuotesBatch } from "../bithumb-krw.js";
import { getBithumbWsTickerQuote } from "../bithumb-ws-ticker.js";
import { fetchQuoteSnapshotsForSymbols } from "../picks-live-quotes.js";

/** 박스 틱마다 허용하는 시세 캐시(기본 1초, 0=매 틱 빗썸 재조회) */
export const BOX_RANGE_QUOTE_TTL_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_QUOTE_TTL_MS ?? 1_000);
  return Number.isFinite(n) && n >= 0 ? Math.min(10_000, Math.floor(n)) : 1_000;
})();

/** 이보다 오래된 quotedAtMs면 FSM 매매 스킵 */
export const BOX_RANGE_QUOTE_MAX_STALE_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_QUOTE_MAX_STALE_MS ?? 5_000);
  return Number.isFinite(n) && n >= 1_000 ? Math.min(60_000, Math.floor(n)) : 5_000;
})();

/** WebSocket trade_price 신선도 (기본 3초) */
export const BOX_RANGE_WS_MAX_STALE_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_WS_MAX_STALE_MS ?? 3_000);
  return Number.isFinite(n) && n >= 500 ? Math.min(30_000, Math.floor(n)) : 3_000;
})();

/**
 * @typedef {{
 *   price: number;
 *   quotedAtMs: number;
 *   priceSource: string;
 *   interval?: string;
 *   changePercent?: number;
 *   currency?: string;
 * }} BoxRangeQuoteRow
 */

/**
 * @param {string[]} symbols — Yahoo USDT 심볼 등
 * @returns {Promise<Record<string, BoxRangeQuoteRow>>}
 */
export async function fetchBoxRangeLastPrices(symbols) {
  const uniq = [...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((s) => String(s ?? "").trim().toUpperCase())
      .filter(Boolean),
  )];
  /** @type {Record<string, BoxRangeQuoteRow>} */
  const out = {};

  const usdt = uniq.filter((s) => isCryptoUsdtSymbol(s));
  const other = uniq.filter((s) => !isCryptoUsdtSymbol(s));

  if (usdt.length > 0) {
    const restNeeded = [];
    for (const sym of usdt) {
      const ws = getBithumbWsTickerQuote(sym);
      if (
        ws &&
        Number.isFinite(ws.price) &&
        ws.price > 0 &&
        Date.now() - ws.quotedAtMs <= BOX_RANGE_WS_MAX_STALE_MS
      ) {
        out[sym] = {
          price: ws.price,
          quotedAtMs: ws.quotedAtMs,
          priceSource: "bithumb-ws",
          interval: "bithumb-ws",
          currency: "KRW",
        };
      } else {
        restNeeded.push(sym);
      }
    }
    if (restNeeded.length > 0) {
      const { quotes, updatedAt } = await loadBithumbKrwQuotesBatch(restNeeded, {
        maxAgeMs: BOX_RANGE_QUOTE_TTL_MS,
      });
      for (const sym of restNeeded) {
        const q = quotes[sym];
        const price = Number(q?.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        out[sym] = {
          price,
          quotedAtMs: updatedAt,
          priceSource: "bithumb-ticker",
          interval: "bithumb",
          changePercent:
            typeof q.changePercent === "number" &&
            Number.isFinite(q.changePercent)
              ? q.changePercent
              : undefined,
          currency: "KRW",
        };
      }
    }
  }

  if (other.length > 0) {
    // FSM은 quotedAtMs 5초 이내 필수 — picks 1m 스냅샷의 오래된 시각을 그대로 쓰면 전부 스킵됨
    const fetchedAt = Date.now();
    const yahoo = await fetchQuoteSnapshotsForSymbols(other, {
      maxAgeMs: 0,
    });
    for (const sym of other) {
      const q = yahoo[sym];
      if (!q?.price || !Number.isFinite(q.price) || q.price <= 0) continue;
      const snapAt =
        typeof q.quotedAtMs === "number" &&
        q.quotedAtMs > 0 &&
        fetchedAt - q.quotedAtMs <= BOX_RANGE_QUOTE_MAX_STALE_MS
          ? q.quotedAtMs
          : fetchedAt;
      out[sym] = {
        price: q.price,
        quotedAtMs: snapAt,
        priceSource:
          typeof q.priceSource === "string" && q.priceSource
            ? q.priceSource
            : "yahoo-1m",
        interval: typeof q.interval === "string" ? q.interval : undefined,
        changePercent: q.changePercent,
        currency: q.currency,
      };
    }
  }

  return out;
}

/**
 * @param {BoxRangeQuoteRow | null | undefined} q
 */
export function isBoxRangeQuoteFresh(q) {
  if (!q || !Number.isFinite(q.price) || q.price <= 0) return false;
  const at = q.quotedAtMs;
  if (!Number.isFinite(at) || at <= 0) return false;
  const maxStale =
    q.priceSource === "bithumb-ws"
      ? BOX_RANGE_WS_MAX_STALE_MS
      : BOX_RANGE_QUOTE_MAX_STALE_MS;
  return Date.now() - at <= maxStale;
}
