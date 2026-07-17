import {
  loadStock,
  VAULT_RESCAN_LOAD_OPTS,
} from "./stock-data.js";
import { detectDailyMaAlignment } from "./ma-align-detect.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { normalizeVaultScanTimeframe } from "./vault-scan-timeframe.js";
import { candlesForWeeklyMaScan } from "./weekly-candle-trim.js";
import { resolveDisplayName } from "./names-ko.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import {
  listStockVaultItemsSync,
  removeStockVaultItemBySourceSync,
  upsertStockVaultItemSync,
} from "./stock-vault-store.js";
import {
  runWithYahooScanTune,
  waitForYahooQueueReady,
} from "./yahoo-queue.js";

const BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_MA_ALIGN_INTRADAY_BATCH ?? 6);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 16) : 6;
})();

const US_BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_MA_ALIGN_INTRADAY_US_BATCH ?? 4);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 4;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(process.env.STOCK_MA_ALIGN_INTRADAY_BATCH_DELAY_MS ?? 280);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 280;
})();

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {unknown} err */
function isRateLimitError(err) {
  if (!err) return false;
  if (typeof err === "object" && err && "code" in err && err.code === "RATE_LIMIT") {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /\(rate\)|RATE_LIMIT|too many requests/i.test(msg);
}

/**
 * @param {import("./stock-vault-store.js").StockVaultItem} item
 * @param {string} scanDate
 */
async function rescanVaultMaAlignItemOnce(item, scanDate) {
  const sym = String(item.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return { symbol: sym, status: "skip" };
  const tf = normalizeVaultScanTimeframe(item.timeframe);
  const chartTf = tf === "1wk" ? "1wk" : "1d";
  const data = await loadStock(sym, chartTf, VAULT_RESCAN_LOAD_OPTS);
  const tradable = await isGoldenCrossTradable(data, item.market, {
    timeframe: tf,
  });
  if (!tradable.ok) {
    removeStockVaultItemBySourceSync(sym, "ma_align", tf);
    return { symbol: sym, status: "removed", reason: tradable.reason };
  }
  let candles = Array.isArray(data?.candles) ? data.candles : [];
  if (tf === "1wk") {
    const daily = await loadStock(sym, "1d", VAULT_RESCAN_LOAD_OPTS);
    candles = candlesForWeeklyMaScan(
      candles,
      Array.isArray(daily?.candles) ? daily.candles : [],
    );
  }
  if (!detectDailyMaAlignment(candles)) {
    removeStockVaultItemBySourceSync(sym, "ma_align", tf);
    return { symbol: sym, status: "removed", reason: "not_aligned" };
  }
  upsertStockVaultItemSync({
    symbol: sym,
    name: resolveDisplayName(
      sym,
      String(item.name ?? data?.quote?.name ?? sym).trim() || sym,
    ),
    market: item.market,
    source: "ma_align",
    timeframe: tf,
    scanDate,
  });
  return { symbol: sym, status: "kept" };
}

/**
 * @param {import("./stock-vault-store.js").StockVaultItem} item
 * @param {string} scanDate
 */
async function rescanVaultMaAlignItem(item, scanDate) {
  const sym = String(item.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return { symbol: sym, status: "skip" };
  try {
    return await rescanVaultMaAlignItemOnce(item, scanDate);
  } catch (e) {
    // rate-limit 이면 cool-down 대기 후 1회 재시도 — 기능(정배열 재검증)은 동일
    if (isRateLimitError(e)) {
      try {
        await waitForYahooQueueReady({ minWaitMs: 1200, jitterMs: 600 });
        return await rescanVaultMaAlignItemOnce(item, scanDate);
      } catch (e2) {
        liveTradeLogWarn(
          "[ma-align:intraday]",
          sym,
          e2 instanceof Error ? e2.message : e2,
        );
        return { symbol: sym, status: "error", rateLimited: true };
      }
    }
    liveTradeLogWarn(
      "[ma-align:intraday]",
      sym,
      e instanceof Error ? e.message : e,
    );
    return { symbol: sym, status: "error" };
  }
}

/**
 * 종목보관 ma_align 항목만 재검증(전체 유니버스 스캔 없음).
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 */
export async function runMaAlignVaultIntradayRefresh(market, scanDate) {
  const items = listStockVaultItemsSync().filter(
    (it) =>
      it.source === "ma_align" &&
      it.market === market &&
      (it.timeframe == null ||
        normalizeVaultScanTimeframe(it.timeframe) === "1d" ||
        normalizeVaultScanTimeframe(it.timeframe) === "1wk"),
  );

  liveTradeLogInfo("[ma-align:intraday] start", {
    market,
    scanDate,
    items: items.length,
  });

  /** @type {Array<Awaited<ReturnType<typeof rescanVaultMaAlignItem>>>} */
  const results = [];
  const batchSize = market === "us" ? US_BATCH_SIZE : BATCH_SIZE;
  // US 콜드스타트 시 Yahoo 429 가 잦음 — 기능 동일, 동시성만 낮춤
  const yahooTune =
    market === "us"
      ? { maxConcurrent: 2, minGapMs: 550 }
      : { maxConcurrent: 3, minGapMs: 400 };

  await runWithYahooScanTune(yahooTune, async () => {
    let streakRateErrors = 0;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((item) => rescanVaultMaAlignItem(item, scanDate)),
      );
      results.push(...batchResults);
      const rateHits = batchResults.filter((r) => r.rateLimited).length;
      if (rateHits > 0) streakRateErrors += 1;
      else streakRateErrors = 0;
      if (i + batchSize < items.length) {
        // rate 연속이면 배치 간격을 늘려 다음 배치가 cool-down 을 존중하게
        const extra =
          streakRateErrors > 0
            ? Math.min(8_000, 1_500 * streakRateErrors)
            : 0;
        const wait = BATCH_DELAY_MS + extra;
        if (wait > 0) await delay(wait);
      }
    }
  });

  const kept = results.filter((r) => r.status === "kept").length;
  const removed = results.filter((r) => r.status === "removed").length;
  const errors = results.filter((r) => r.status === "error").length;
  liveTradeLogInfo("[ma-align:intraday] done", {
    market,
    scanDate,
    checked: items.length,
    kept,
    removed,
    errors,
  });

  return { market, scanDate, checked: items.length, kept, removed, errors };
}
