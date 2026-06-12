import { loadStock } from "./stock-data.js";
import {
  detectDailyMaAlignment,
  getDailyMaValues,
  isPriceNearMa120,
} from "./ma-align-detect.js";
import { isVaultMarketScanRunning } from "./golden-cross-poller.js";
import { getTradingSessionKey, isStockTradableBySchedule } from "./market-hours.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";
import { listStockVaultItemsSync } from "./stock-vault-store.js";
import { notifyMaAlignMa120NearTelegram } from "./ma-align-ma120-telegram.js";

const DEDUP_FILE = "ma-align-ma120-near-sent.json";

const WATCH_MS = (() => {
  const n = Number(process.env.STOCK_MA120_NEAR_POLL_MS ?? 60_000);
  return Number.isFinite(n) && n >= 30_000 ? Math.min(n, 600_000) : 60_000;
})();

const NEAR_PCT = (() => {
  const n = Number(process.env.STOCK_MA120_NEAR_PCT ?? 3);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 3;
})();

const BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_MA120_NEAR_BATCH ?? 8);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 16) : 8;
})();

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {unknown} raw */
function normalizeDedup(raw) {
  const entries =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  /** @type {Record<string, { session: string; atMs: number }>} */
  const out = {};
  for (const [key, row] of Object.entries(entries)) {
    const session = String(row?.session ?? "").trim();
    const atMs = Number(row?.atMs);
    if (!session || !Number.isFinite(atMs)) continue;
    out[key] = { session, atMs };
  }
  return out;
}

function readDedup() {
  return readJsonStoreSync(DEDUP_FILE, normalizeDedup, () => ({}));
}

/** @param {Record<string, { session: string; atMs: number }>} dedup */
function writeDedup(dedup) {
  writeJsonStoreSync(DEDUP_FILE, normalizeDedup(dedup));
}

export function maAlignMa120WatchEnabled() {
  return String(process.env.STOCK_MA120_NEAR_WATCH ?? "1").trim() !== "0";
}

/** @param {string} market @param {string} symbol @param {string} session */
export function wasMa120NearAlertSentSync(market, symbol, session) {
  const key = `${market}:${String(symbol).trim().toUpperCase()}`;
  const row = readDedup()[key];
  return row?.session === session;
}

/** @param {string} market @param {string} symbol @param {string} session */
export function markMa120NearAlertSentSync(market, symbol, session) {
  const key = `${market}:${String(symbol).trim().toUpperCase()}`;
  const dedup = readDedup();
  dedup[key] = { session, atMs: Date.now() };
  writeDedup(dedup);
}

/**
 * @param {number} price
 * @param {number} ma120
 * @param {number} [thresholdPct]
 */
export function ma120NearDistancePct(price, ma120, thresholdPct = NEAR_PCT) {
  const p = Number(price);
  const m = Number(ma120);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(m) || m <= 0) {
    return null;
  }
  return (Math.abs(p - m) / m) * 100;
}

/**
 * @param {{
 *   symbol: string;
 *   name: string;
 *   market: "kr"|"us";
 *   price: number;
 *   candles: Array<{ close?: number }>;
 *   thresholdPct?: number;
 * }} input
 */
export function evaluateMa120NearHit(input) {
  const thresholdPct = input.thresholdPct ?? NEAR_PCT;
  if (!detectDailyMaAlignment(input.candles)) return null;
  const ma = getDailyMaValues(input.candles);
  if (!ma) return null;
  if (!isPriceNearMa120(input.price, ma.ma120, thresholdPct)) return null;
  const distancePct = ma120NearDistancePct(input.price, ma.ma120, thresholdPct);
  if (distancePct == null) return null;
  return {
    symbol: input.symbol,
    name: input.name,
    market: input.market,
    price: input.price,
    ma120: ma.ma120,
    distancePct,
  };
}

/**
 * @param {import("./stock-vault-store.js").StockVaultItem} item
 * @param {Record<string, { price?: number | null }>} quotes
 * @param {string} sessionKey
 */
async function checkVaultItem(item, quotes, sessionKey) {
  const sym = String(item.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return null;
  if (wasMa120NearAlertSentSync(item.market, sym, sessionKey)) return null;

  const quotePrice = Number(quotes[sym]?.price);
  let price = Number.isFinite(quotePrice) && quotePrice > 0 ? quotePrice : NaN;

  const data = await loadStock(sym, "1d", { live: true });
  const candles = Array.isArray(data?.candles) ? data.candles : [];
  if (!Number.isFinite(price) || price <= 0) {
    const fallback = Number(data?.quote?.price ?? data?.quote?.regularMarketPrice);
    if (Number.isFinite(fallback) && fallback > 0) price = fallback;
  }
  if (!Number.isFinite(price) || price <= 0) return null;

  const hit = evaluateMa120NearHit({
    symbol: sym,
    name: item.name,
    market: item.market,
    price,
    candles,
  });
  if (!hit) return null;

  return { ...hit, sessionKey };
}

/** @param {Date} [now] */
export async function runMaAlignMa120NearWatchOnce(now = new Date()) {
  if (!maAlignMa120WatchEnabled()) return { checked: 0, sent: 0 };

  const tradableMarkets = /** @type {Set<"kr"|"us">} */ (new Set());
  for (const market of /** @type {const} */ (["kr", "us"])) {
    if (isStockTradableBySchedule(market, now)) tradableMarkets.add(market);
  }
  if (!tradableMarkets.size) return { checked: 0, sent: 0 };

  const items = listStockVaultItemsSync().filter(
    (it) => it.source === "ma_align" && tradableMarkets.has(it.market),
  );
  if (!items.length) return { checked: 0, sent: 0 };

  const symbols = [...new Set(items.map((it) => it.symbol))];
  const quotes = await fetchQuoteSnapshotsForSymbols(symbols, { maxAgeMs: 0 });

  let sent = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((item) =>
        checkVaultItem(
          item,
          quotes,
          getTradingSessionKey(item.market),
        ).catch((e) => {
          liveTradeLogWarn(
            "[ma-align:ma120:watch]",
            item.symbol,
            e instanceof Error ? e.message : e,
          );
          return null;
        }),
      ),
    );
    for (const hit of results) {
      if (!hit) continue;
      const notify = await notifyMaAlignMa120NearTelegram(hit);
      if (notify.sent) {
        markMa120NearAlertSentSync(hit.market, hit.symbol, hit.sessionKey);
        sent += 1;
        liveTradeLogInfo("[ma-align:ma120:watch] alert sent", {
          symbol: hit.symbol,
          market: hit.market,
          distancePct: hit.distancePct,
        });
      }
    }
    if (i + BATCH_SIZE < items.length) await delay(200);
  }

  return { checked: items.length, sent };
}

export function startMaAlignMa120WatchPoller() {
  if (!maAlignMa120WatchEnabled()) return;
  const g = /** @type {typeof globalThis & { __stockMaAlignMa120Watch?: boolean }} */ (
    globalThis
  );
  if (g.__stockMaAlignMa120Watch) return;
  g.__stockMaAlignMa120Watch = true;

  let running = false;
  const tick = () => {
    if (running || isVaultMarketScanRunning()) return;
    running = true;
    void pollerGuardAsync("ma120-near-watch", () => runMaAlignMa120NearWatchOnce())
      .catch((e) => {
        liveTradeLogWarn(
          "[ma-align:ma120:watch]",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        running = false;
      });
  };

  tick();
  markPollerBootStarted("ma120-near-watch");
  setInterval(tick, WATCH_MS);
}
