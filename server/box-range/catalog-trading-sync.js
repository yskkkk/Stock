import {
  readCatalogIndexSync,
  listTradeEligibleCatalogBoxesSync,
  markCatalogBoxConsumedSync,
} from "./catalog-store.js";
import {
  listBoxesForProgramSync,
  upsertDetectedBoxSync,
  patchBoxSync,
  readBoxRangeStoreSync,
} from "./store.js";
import { isBoxRangeProgram } from "./constants.js";

const MAX_NEW_SLOTS_PER_TICK = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_US_SLOTS_PER_TICK ?? 20);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : 20;
})();

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 */
export function syncUsTradingBoxesFromCatalogSync(program) {
  if (!isBoxRangeProgram(program) || !program.markets?.us) return { linked: 0 };

  const index = readCatalogIndexSync();
  const symbols = Array.isArray(index?.symbols) ? index.symbols : [];
  const existing = listBoxesForProgramSync(program.id);
  const linkedIds = new Set(
    existing.map((b) => String(b.catalogBoxId ?? "").trim()).filter(Boolean),
  );

  let linked = 0;
  for (const row of symbols) {
    if (linked >= MAX_NEW_SLOTS_PER_TICK) break;
    const sym = String(row.symbol ?? "").trim().toUpperCase();
    if (!sym) continue;
    const eligible = listTradeEligibleCatalogBoxesSync(sym);
    for (const cb of eligible) {
      if (linked >= MAX_NEW_SLOTS_PER_TICK) break;
      if (linkedIds.has(cb.catalogBoxId)) continue;
      const hasTf = existing.some(
        (b) =>
          b.symbol === sym &&
          b.timeframe === cb.timeframe &&
          b.state !== "closed" &&
          b.catalogBoxId === cb.catalogBoxId,
      );
      if (hasTf) continue;

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
        tradeEligible: true,
      });
      linkedIds.add(cb.catalogBoxId);
      linked += 1;
    }
  }
  return { linked };
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
