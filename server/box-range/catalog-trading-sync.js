import {
  readCatalogIndexSync,
  listTradeEligibleCatalogBoxesSync,
  markCatalogBoxConsumedSync,
  resolveCatalogMarket,
  resolveCatalogRootDir,
} from "./catalog-store.js";
import {
  listBoxesForProgramSync,
  upsertDetectedBoxSync,
  patchBoxSync,
  readBoxRangeStoreSync,
} from "./store.js";
import {
  BOX_RANGE_CATALOG_DIR_PRO,
  isBoxRangeCryptoHtfManaged,
  isBoxRangeCryptoHtfSymbol,
  isBoxRangeProgram,
} from "./constants.js";

const MAX_NEW_SLOTS_PER_TICK = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_CATALOG_SLOTS_PER_TICK ?? 500);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 5000) : 500;
})();

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {"us"|"kr"|"crypto"} catalogMarket
 * @param {string} [catalogRoot]
 */
export function syncCatalogTradingBoxesFromCatalogSync(
  program,
  catalogMarket,
  catalogRoot = BOX_RANGE_CATALOG_DIR_PRO,
) {
  const market = resolveCatalogMarket(catalogMarket);
  if (!isBoxRangeProgram(program)) return { linked: 0 };
  if (market === "us" && !program.markets?.us) return { linked: 0 };
  if (market === "kr" && !program.markets?.kr) return { linked: 0 };
  if (market === "crypto" && !program.markets?.crypto) return { linked: 0 };

  const index = readCatalogIndexSync(market, catalogRoot);
  const symbols = Array.isArray(index?.symbols) ? index.symbols : [];
  const existing = listBoxesForProgramSync(program.id);
  const linkedIds = new Set(
    existing
      .filter((b) => b.state !== "closed")
      .map((b) => String(b.catalogBoxId ?? "").trim())
      .filter(Boolean),
  );

  let linked = 0;
  for (const row of symbols) {
    if (linked >= MAX_NEW_SLOTS_PER_TICK) break;
    const sym = String(row.symbol ?? "").trim().toUpperCase();
    if (!sym) continue;
    if (market === "crypto" && !isBoxRangeCryptoHtfSymbol(sym)) continue;
    const eligible = listTradeEligibleCatalogBoxesSync(sym, market, catalogRoot);
    for (const cb of eligible) {
      if (linked >= MAX_NEW_SLOTS_PER_TICK) break;
      if (linkedIds.has(cb.catalogBoxId)) continue;
      if (
        market === "crypto" &&
        !isBoxRangeCryptoHtfManaged(sym, cb.timeframe)
      ) {
        continue;
      }

      upsertDetectedBoxSync({
        programId: program.id,
        userId: String(program.userId ?? "").trim(),
        symbol: sym,
        timeframe: cb.timeframe,
        top: cb.top,
        bottom: cb.bottom,
        mid: cb.mid,
        leftTime: cb.leftTime,
        rightTime: cb.rightTime,
        catalogBoxId: cb.catalogBoxId,
        catalogMarket: market,
        tradeEligible: true,
      });
      linkedIds.add(cb.catalogBoxId);
      linked += 1;
    }
  }
  return { linked };
}

/** @deprecated — use syncCatalogTradingBoxesFromCatalogSync(program, "us") */
export function syncUsTradingBoxesFromCatalogSync(program) {
  return syncCatalogTradingBoxesFromCatalogSync(program, "us");
}

/**
 * @param {string} boxId
 * @param {string} [reason]
 */
export function consumeBoxForTradingSync(boxId, reason = "closed") {
  const store = readBoxRangeStoreSync();
  const box = store.boxes.find((b) => b.boxId === boxId);
  if (!box) return;
  patchBoxSync(boxId, {
    state: "closed",
    tradeEligible: false,
    lotQty: 0,
    buyTradeId: null,
    entryPrice: null,
    buyAtMs: null,
  });
  const cid = String(box.catalogBoxId ?? "").trim();
  if (cid) markCatalogBoxConsumedSync(cid, reason);
}
