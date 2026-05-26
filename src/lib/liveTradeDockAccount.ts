import type { LiveTradeTradesExchange } from "./liveTradeTradesWorkspace";

export type { LiveTradeTradesExchange };

/** 상단 «거래내역» 탭으로 전환 */
export const LIVE_TRADE_NAVIGATE_TRADE_HISTORY_TAB_EVENT =
  "ystock-navigate-trade-history-tab";

/** @deprecated 거래내역은 메인 영역; `openAccountTrades` 사용 */
export type LiveTradeDockAccountSubTab = "balance" | "trades";

export type LiveTradeDockAccountView = {
  provider?: LiveTradeTradesExchange;
  /** @deprecated `openAccountTrades` 또는 `provider`만 사용 */
  subTab?: LiveTradeDockAccountSubTab;
};

const PROVIDER_KEY = "ystock-dock-account-provider";

export const LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT =
  "ystock-dock-account-provider";

export function readDockAccountProvider(): LiveTradeTradesExchange {
  try {
    const v = sessionStorage.getItem(PROVIDER_KEY);
    if (v === "toss" || v === "bithumb") return v;
  } catch {
    /* ignore */
  }
  return "bithumb";
}

export function persistDockAccountProvider(
  provider: LiveTradeTradesExchange,
): void {
  try {
    sessionStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    /* ignore */
  }
}

export function dispatchDockAccountProvider(
  provider: LiveTradeTradesExchange,
): void {
  if (typeof window === "undefined") return;
  persistDockAccountProvider(provider);
  window.dispatchEvent(
    new CustomEvent<LiveTradeTradesExchange>(
      LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT,
      { detail: provider },
    ),
  );
}

export function readDockAccountProviderEvent(
  e: Event,
): LiveTradeTradesExchange | undefined {
  return (e as CustomEvent<LiveTradeTradesExchange>).detail;
}

export function navigateToTradeHistoryTab(
  exchange: LiveTradeTradesExchange = readDockAccountProvider(),
): void {
  if (typeof window === "undefined") return;
  dispatchDockAccountProvider(exchange);
  window.dispatchEvent(
    new CustomEvent<LiveTradeTradesExchange>(
      LIVE_TRADE_NAVIGATE_TRADE_HISTORY_TAB_EVENT,
      { detail: exchange },
    ),
  );
}

/** 거래내역 탭 열기(계좌·포트폴리오 등) */
export function openAccountTrades(
  exchange: LiveTradeTradesExchange = readDockAccountProvider(),
): void {
  navigateToTradeHistoryTab(exchange);
}

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
