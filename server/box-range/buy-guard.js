import { orderDedupeKey } from "../live-trade-buy-guard.js";

/** 박스별 매수 — 동일 종목 다른 박스는 허용 */
export function boxRangeBuyDedupeKey(programId, boxId, symbol) {
  return orderDedupeKey(`${programId}:box:${boxId}`, symbol);
}
