/** 우측 실매매 도크 패널 접기·펼치기 */
export const LIVE_TRADE_DOCK_TOGGLE_EVENT = "ystock-live-trade-dock-toggle";

export function dispatchLiveTradeDockToggle() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_TRADE_DOCK_TOGGLE_EVENT));
}
