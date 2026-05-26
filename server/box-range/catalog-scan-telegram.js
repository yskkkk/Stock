/**
 * 카탈로그 스캔 완료·현재가↔박스권 1% 근접 — 텔레그램 알림
 */
import { pickQuoteFromMap } from "../quote-symbol-resolve.js";
import {
  escHtml,
  isTelegramNotifyEnabled,
  resolveStockTelegramCreds,
  sendTelegramMessage,
} from "../telegram-notify.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";
import { liveTradeCurrency } from "../live-trade-market.js";
import {
  readCatalogIndexSync,
  readSymbolCatalogSync,
  resolveCatalogMarket,
  resolveCatalogRootDir,
  summarizeCatalogRootSync,
} from "./catalog-store.js";
import { fetchBoxRangeLastPrices, isBoxRangeQuoteFresh } from "./quotes.js";

/** @typedef {"us"|"kr"|"crypto"} CatalogMarket */

const NEAR_PCT = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_NEAR_PCT ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 1;
})();

const MAX_NEAR_LINES = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_SCAN_TG_NEAR_MAX ?? 40);
  return Number.isFinite(n) && n >= 5 ? Math.min(n, 80) : 40;
})();

const QUOTE_CHUNK = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_SCAN_TG_QUOTE_CHUNK ?? 80);
  return Number.isFinite(n) && n >= 10 ? Math.min(n, 150) : 80;
})();

const MARKET_LABEL = { us: "미국", kr: "국내", crypto: "코인" };

function scanTelegramEnabled() {
  return String(process.env.STOCK_BOX_RANGE_SCAN_TELEGRAM ?? "1").trim() !== "0";
}

/**
 * @param {number} n
 * @param {CatalogMarket} market
 */
function fmtPrice(n, market) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const cur = liveTradeCurrency(market);
  if (cur === "USD") {
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (v >= 1000) return `${Math.round(v).toLocaleString("ko-KR")}원`;
  return `${v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
}

/**
 * @param {number} price
 * @param {{ mid: number; top: number; bottom: number }} box
 * @param {number} maxPct
 */
export function nearestBoxLevelWithinPct(price, box, maxPct = NEAR_PCT) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return null;
  /** @type {Array<["중심"|"상단"|"하단", number]>} */
  const levels = [
    ["중심", Number(box.mid)],
    ["상단", Number(box.top)],
    ["하단", Number(box.bottom)],
  ];
  let best = null;
  for (const [label, lv] of levels) {
    if (!Number.isFinite(lv) || lv <= 0) continue;
    const pct = (Math.abs(p - lv) / lv) * 100;
    if (pct <= maxPct && (!best || pct < best.pct)) {
      best = { label, level: lv, pct };
    }
  }
  return best;
}

/**
 * @param {CatalogMarket} market
 * @param {number} maxPct
 */
export async function collectNearPriceCatalogHits(market, maxPct = NEAR_PCT) {
  const m = resolveCatalogMarket(market);
  const idx = readCatalogIndexSync(m);
  const symbols = (Array.isArray(idx?.symbols) ? idx.symbols : [])
    .filter((r) => (r.boxCount ?? 0) > 0)
    .map((r) => String(r.symbol ?? "").trim().toUpperCase())
    .filter(Boolean);

  /** @type {{ symbol: string; timeframe: string; levelLabel: string; level: number; pct: number; price: number; mid: number; top: number; bottom: number }[]} */
  const hits = [];
  const root = resolveCatalogRootDir();

  for (let i = 0; i < symbols.length; i += QUOTE_CHUNK) {
    const chunk = symbols.slice(i, i + QUOTE_CHUNK);
    const quotes = await fetchBoxRangeLastPrices(chunk);
    for (const sym of chunk) {
      const q = pickQuoteFromMap(quotes, sym, m);
      if (!isBoxRangeQuoteFresh(q)) continue;
      const price = Number(q.price);
      const cat = readSymbolCatalogSync(sym, m, root);
      if (!cat?.boxes?.length) continue;
      for (const b of cat.boxes) {
        if (b.consumedAtMs || b.tradeEligible === false) continue;
        const near = nearestBoxLevelWithinPct(price, b, maxPct);
        if (!near) continue;
        hits.push({
          symbol: sym,
          timeframe: b.timeframe,
          levelLabel: near.label,
          level: near.level,
          pct: near.pct,
          price,
          mid: b.mid,
          top: b.top,
          bottom: b.bottom,
        });
      }
    }
  }

  hits.sort((a, b) => a.pct - b.pct);
  return hits;
}

/**
 * @param {CatalogMarket} market
 * @param {{ scanned?: number; ok?: number; errors?: number; withBoxes?: number; boxes?: number }} scanRun
 */
export function buildCatalogScanSummaryMessage(market, scanRun = {}) {
  const m = resolveCatalogMarket(market);
  const label = MARKET_LABEL[m] ?? m;
  const root = resolveCatalogRootDir();
  const sum = summarizeCatalogRootSync(root, m);
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  const scopeNote =
    m === "us" && scanRun.usSp500 != null
      ? `범위: S&P500 ${scanRun.usSp500 ?? scanRun.usTotal ?? scanRun.scanned ?? "—"}종목`
      : m === "kr" && scanRun.kr != null
        ? `범위: 국내 시총 상위 ${scanRun.kr}종목`
        : null;

  const lines = [
    `<b>📊 박스권 카탈로그 스캔 완료 · ${escHtml(label)}</b>`,
    "",
    `🕐 ${escHtml(now)} KST`,
    ...(scopeNote ? [escHtml(scopeNote), ""] : []),
    `이번 스캔: 종목 ${scanRun.scanned ?? "—"} · 성공 ${scanRun.ok ?? "—"} · 오류 ${scanRun.errors ?? 0} · 박스있음 ${scanRun.withBoxes ?? "—"}`,
    "",
    `<b>카탈로그 누적</b>`,
    `종목 ${sum.symbols} · 박스 ${sum.total}`,
    `1h ${sum.byTf["1h"]} · 4h ${sum.byTf["4h"]} · 1d ${sum.byTf["1d"]}`,
  ];
  return lines.join("\n");
}

/**
 * @param {CatalogMarket} market
 * @param {Awaited<ReturnType<typeof collectNearPriceCatalogHits>>} hits
 */
export function buildNearPriceMessage(market, hits) {
  const m = resolveCatalogMarket(market);
  const label = MARKET_LABEL[m] ?? m;
  const lines = [
    `<b>🎯 현재가 ↔ 박스권 ${NEAR_PCT}% 이내 · ${escHtml(label)}</b>`,
    "",
    `기준: 중심·상단·하단 중 가장 가까운 가격 (tradeEligible·미소진 박스)`,
  ];

  if (!hits.length) {
    lines.push("", "해당 종목 없음");
    return lines.join("\n");
  }

  const show = hits.slice(0, MAX_NEAR_LINES);
  for (const h of show) {
    lines.push(
      "",
      `<b>${escHtml(h.symbol)}</b> · ${escHtml(h.timeframe)} · ${escHtml(h.levelLabel)}`,
      `현재 ${escHtml(fmtPrice(h.price, m))} · ${escHtml(h.levelLabel)} ${escHtml(fmtPrice(h.level, m))} (<b>${h.pct.toFixed(2)}%</b>)`,
      `박스 중심 ${escHtml(fmtPrice(h.mid, m))} · 상 ${escHtml(fmtPrice(h.top, m))} · 하 ${escHtml(fmtPrice(h.bottom, m))}`,
    );
  }
  if (hits.length > show.length) {
    lines.push("", `… 외 ${hits.length - show.length}건 (상위 ${MAX_NEAR_LINES}건만 표시)`);
  }
  lines.push("", `총 ${hits.length}건`);
  return lines.join("\n");
}

/**
 * @param {CatalogMarket} market
 * @param {{ scanned?: number; ok?: number; errors?: number; withBoxes?: number }} [scanRun]
 */
export async function notifyCatalogScanTelegram(market, scanRun = {}) {
  if (!scanTelegramEnabled()) {
    return { ok: false, skipped: true, reason: "disabled" };
  }
  if (!isTelegramNotifyEnabled()) {
    liveTradeLogWarn("[box-range:scan-tg]", "telegram not configured");
    return { ok: false, skipped: true, reason: "telegram_off" };
  }

  const m = resolveCatalogMarket(market);
  const creds = resolveStockTelegramCreds();
  const summaryText = buildCatalogScanSummaryMessage(m, scanRun);
  const nearHits = await collectNearPriceCatalogHits(m, NEAR_PCT);
  const nearText = buildNearPriceMessage(m, nearHits);

  const ok1 = await sendTelegramMessage(summaryText, undefined, creds);
  const ok2 = await sendTelegramMessage(nearText, undefined, creds);

  if (ok1 || ok2) {
    liveTradeLogInfo(
      "[box-range:scan-tg]",
      "sent",
      m,
      `near=${nearHits.length}`,
      `scan ok=${ok1} near=${ok2}`,
    );
  } else {
    liveTradeLogWarn("[box-range:scan-tg]", "send failed", m);
  }

  return {
    ok: Boolean(ok1 && ok2),
    market: m,
    nearCount: nearHits.length,
    summarySent: ok1,
    nearSent: ok2,
  };
}
