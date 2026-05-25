import { orderDedupeKey } from "../live-trade-buy-guard.js";

/** 박스별 매수 — 동일 종목 다른 박스는 허용 */
export function boxRangeBuyDedupeKey(programId, boxId, symbol) {
  return orderDedupeKey(`${programId}:box:${boxId}`, symbol);
}

/** @param {{ signalIds?: string[] }} pick */
export function isBoxRangePickSignal(pick) {
  return (
    Array.isArray(pick?.signalIds) &&
    pick.signalIds.some((s) => String(s ?? "").startsWith("box-range:"))
  );
}
