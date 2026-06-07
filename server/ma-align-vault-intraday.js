import { loadStock } from "./stock-data.js";
import { detectDailyMaAlignment } from "./ma-align-detect.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import {
  listStockVaultItemsSync,
  removeStockVaultItemBySourceSync,
  upsertStockVaultItemSync,
} from "./stock-vault-store.js";

const BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_MA_ALIGN_INTRADAY_BATCH ?? 8);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 16) : 8;
})();

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    const data = await loadStock(sym, "1d", { live: true });
    const tradable = await isGoldenCrossTradable(data, item.market);
    if (!tradable.ok) {
      removeStockVaultItemBySourceSync(sym, "ma_align");
      return { symbol: sym, status: "removed", reason: tradable.reason };
    }
    const candles = Array.isArray(data?.candles) ? data.candles : [];
    if (!detectDailyMaAlignment(candles)) {
      removeStockVaultItemBySourceSync(sym, "ma_align");
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
      scanDate,
    });
    return { symbol: sym, status: "kept" };
  } catch (e) {
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
    (it) => it.source === "ma_align" && it.market === market,
  );

  liveTradeLogInfo("[ma-align:intraday] start", {
    market,
    scanDate,
    items: items.length,
  });

  /** @type {Array<Awaited<ReturnType<typeof rescanVaultMaAlignItem>>>} */
  const results = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((item) => rescanVaultMaAlignItem(item, scanDate)),
    );
    results.push(...batchResults);
    if (i + BATCH_SIZE < items.length) await delay(150);
  }

  const kept = results.filter((r) => r.status === "kept").length;
  const removed = results.filter((r) => r.status === "removed").length;
  liveTradeLogInfo("[ma-align:intraday] done", {
    market,
    scanDate,
    checked: items.length,
    kept,
    removed,
  });

  return { market, scanDate, checked: items.length, kept, removed };
}
