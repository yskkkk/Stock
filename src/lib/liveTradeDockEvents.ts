/** 우측 실매매 도크 패널 접기·펼치기 */
export const LIVE_TRADE_DOCK_TOGGLE_EVENT = "ystock-live-trade-dock-toggle";

export function dispatchLiveTradeDockToggle() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_TRADE_DOCK_TOGGLE_EVENT));
}

/** 접혀 있을 때만 우측 도크 펼침(실행 중 프로그램 칩 등) */
export const LIVE_TRADE_DOCK_OPEN_EVENT = "ystock-live-trade-dock-open";

export function dispatchLiveTradeDockOpen() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_TRADE_DOCK_OPEN_EVENT));
}

/** 우측 도크 «거래내역» 패널 */
export const LIVE_TRADE_DOCK_OPEN_TRADES_EVENT =
  "ystock-live-trade-dock-open-trades";

export function dispatchLiveTradeDockOpenTrades(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_TRADE_DOCK_OPEN_TRADES_EVENT));
}

/** 도크 «+» — 새 프로그램 폼 초기화 */
export const LIVE_TRADE_DOCK_OPEN_FORM_EVENT = "ystock-live-trade-dock-open-form";

export function dispatchLiveTradeDockOpenForm() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_TRADE_DOCK_OPEN_FORM_EVENT));
}

/** 프로그램 폼 저장 후 — 도크 레일 클릭·리사이즈 상태 복구 */
export const LIVE_TRADE_DOCK_AFTER_FORM_SAVE_EVENT =
  "ystock-live-trade-dock-after-form-save";

export function dispatchLiveTradeDockAfterFormSave() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LIVE_TRADE_DOCK_AFTER_FORM_SAVE_EVENT),
  );
  window.dispatchEvent(new CustomEvent("live-trade-dock-close-api-popover"));
}
