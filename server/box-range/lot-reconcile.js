/**
 * 박스별 lot — box-range-state.json + live-trade-portfolio.json 이중 기록·재기동 복구
 */
import { readStoreSync } from "../live-trade-portfolio-store.js";
import { readBoxRangeStoreSync, writeBoxRangeStoreSync } from "./store.js";

/**
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {import("../live-trade-portfolio-store.js").LiveTradeRecord[]} trades
 */
export function resolveBoxOpenLotFromTrades(box, trades) {
  const pid = String(box.programId ?? "").trim();
  const boxId = String(box.boxId ?? "").trim();
  if (!pid || !boxId) return null;

  /** @type {import("../live-trade-portfolio-store.js").LiveTradeRecord | null} */
  let buy = null;
  const bid = String(box.buyTradeId ?? "").trim();
  if (bid) {
    buy =
      trades.find(
        (t) =>
          t.id === bid &&
          t.side === "buy" &&
          t.programId === pid &&
          t.boxId === boxId,
      ) ?? null;
  }
  if (!buy) {
    const buys = trades
      .filter(
        (t) =>
          t.side === "buy" &&
          t.programId === pid &&
          t.boxId === boxId &&
          t.symbol === box.symbol,
      )
      .sort((a, b) => b.atMs - a.atMs);
    buy = buys[0] ?? null;
  }
  if (!buy || buy.quantity <= 0) return null;

  const sold = trades
    .filter(
      (t) =>
        t.side === "sell" &&
        t.programId === pid &&
        t.boxId === boxId &&
        t.atMs >= buy.atMs,
    )
    .reduce((s, t) => s + t.quantity, 0);

  const openQty = buy.quantity - sold;
  if (openQty <= 1e-9) {
    return {
      closed: true,
      buyTradeId: buy.id,
      entryPrice: buy.price,
      buyAtMs: buy.atMs,
      quantity: 0,
    };
  }

  return {
    closed: false,
    buyTradeId: buy.id,
    entryPrice: buy.price,
    buyAtMs: buy.atMs,
    quantity: openQty,
  };
}

/**
 * 매도·FSM용 — 박스 상태 우선, 없으면 portfolio에서 잔여 수량
 * @param {import("./store.js").BoxRangeRecord} box
 */
export function resolveBoxSellQuantitySync(box) {
  const lot = resolveBoxOpenLotFromTrades(box, readStoreSync().trades);
  if (lot?.closed) return { quantity: 0, entryPrice: lot.entryPrice, closed: true };
  if (lot && lot.quantity > 0) {
    return {
      quantity: lot.quantity,
      entryPrice: lot.entryPrice,
      buyTradeId: lot.buyTradeId,
      closed: false,
    };
  }
  if (box.state === "in_position" && box.lotQty > 0) {
    return {
      quantity: box.lotQty,
      entryPrice: box.entryPrice ?? box.mid,
      buyTradeId: box.buyTradeId,
      closed: false,
    };
  }
  return { quantity: 0, entryPrice: null, closed: false };
}

/**
 * 재기동 후 box-range-state ↔ portfolio 체결 동기화
 */
export function reconcileBoxRangeLotsFromPortfolioSync() {
  const store = readBoxRangeStoreSync();
  const trades = readStoreSync().trades;
  let changed = 0;

  for (let i = 0; i < store.boxes.length; i++) {
    const box = store.boxes[i];
    if (box.state === "closed" && !box.buyTradeId && box.lotQty <= 0) {
      continue;
    }

    const lot = resolveBoxOpenLotFromTrades(box, trades);
    if (!lot) {
      if (box.state === "in_position" || box.lotQty > 0 || box.buyTradeId) {
        store.boxes[i] = {
          ...box,
          state: box.state === "in_position" ? "armed" : box.state,
          lotQty: 0,
          buyTradeId: null,
          entryPrice: null,
          buyAtMs: null,
          updatedAtMs: Date.now(),
        };
        changed += 1;
      }
      continue;
    }

    if (lot.closed) {
      if (box.state !== "closed" || box.lotQty !== 0) {
        store.boxes[i] = {
          ...box,
          state: "closed",
          lotQty: 0,
          buyTradeId: lot.buyTradeId,
          entryPrice: lot.entryPrice,
          buyAtMs: lot.buyAtMs,
          updatedAtMs: Date.now(),
        };
        changed += 1;
      }
      continue;
    }

    const needPatch =
      box.state !== "in_position" ||
      Math.abs(box.lotQty - lot.quantity) > 1e-9 ||
      box.buyTradeId !== lot.buyTradeId ||
      Math.abs((box.entryPrice ?? 0) - lot.entryPrice) > 1e-6 ||
      box.buyAtMs !== lot.buyAtMs;

    if (needPatch) {
      store.boxes[i] = {
        ...box,
        state: "in_position",
        lotQty: lot.quantity,
        buyTradeId: lot.buyTradeId,
        entryPrice: lot.entryPrice,
        buyAtMs: lot.buyAtMs,
        updatedAtMs: Date.now(),
      };
      changed += 1;
    }
  }

  if (changed > 0) writeBoxRangeStoreSync(store);
  return { patched: changed };
}
