export const LIVE_TRADE_AUTH_CHANGE = "stock:live-trade-auth-change";

export function notifyLiveTradeAuthChange() {
  window.dispatchEvent(new Event(LIVE_TRADE_AUTH_CHANGE));
}
