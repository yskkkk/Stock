import type { LiveTradeTradesExchange } from "./liveTradeTradesWorkspace";

export type LiveTradeDockAccountSubTab = "balance" | "trades";

export type LiveTradeDockAccountView = {
  subTab?: LiveTradeDockAccountSubTab;
  provider?: LiveTradeTradesExchange;
  /** 거래내역: null이면 토스·빗썸 카드, 지정 시 해당 거래소 체결 */
  tradesExchange?: LiveTradeTradesExchange | null;
};

export const LIVE_TRADE_DOCK_OPEN_ACCOUNT_EVENT =
  "ystock-live-trade-dock-open-account";

export const LIVE_TRADE_DOCK_ACCOUNT_VIEW_EVENT =
  "ystock-live-trade-dock-account-view";

const PENDING_KEY = "ystock-live-trade-dock-account-view";

export function setPendingDockAccountView(view: LiveTradeDockAccountView): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(view));
  } catch {
    /* ignore */
  }
}

export function consumePendingDockAccountView(): LiveTradeDockAccountView | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LiveTradeDockAccountView;
  } catch {
    return null;
  }
}

export function dispatchLiveTradeDockOpenAccount(
  view?: LiveTradeDockAccountView,
): void {
  if (typeof window === "undefined") return;
  const detail = view ?? consumePendingDockAccountView() ?? undefined;
  if (detail) setPendingDockAccountView(detail);
  window.dispatchEvent(
    new CustomEvent<LiveTradeDockAccountView | undefined>(
      LIVE_TRADE_DOCK_OPEN_ACCOUNT_EVENT,
      { detail },
    ),
  );
}

export function readDockAccountViewEvent(
  e: Event,
): LiveTradeDockAccountView | undefined {
  return (e as CustomEvent<LiveTradeDockAccountView | undefined>).detail;
}
