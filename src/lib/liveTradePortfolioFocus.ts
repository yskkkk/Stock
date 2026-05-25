export type LiveTradePortfolioPanelTab =
  | "summary"
  | "holdings"
  | "trade"
  | "trades"
  | "openOrders";

export type LiveTradePortfolioFocus = {
  programId: string;
  userId?: string;
  programName?: string;
};

export const LIVE_TRADE_PORTFOLIO_PANEL_TAB_EVENT =
  "ystock-live-trade-portfolio-panel-tab";

const PENDING_KEY = "ystock-live-trade-portfolio-focus";

export const LIVE_TRADE_PORTFOLIO_FOCUS_EVENT = "ystock-live-trade-portfolio-focus";
export const LIVE_TRADE_DOCK_OPEN_PORTFOLIO_EVENT =
  "ystock-live-trade-dock-open-portfolio";

export function setPendingLiveTradePortfolioFocus(
  focus: LiveTradePortfolioFocus,
): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(focus));
  } catch {
    /* ignore */
  }
}

export function consumePendingLiveTradePortfolioFocus(): LiveTradePortfolioFocus | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveTradePortfolioFocus;
    if (!parsed?.programId?.trim()) return null;
    return {
      programId: parsed.programId.trim(),
      userId: parsed.userId?.trim() || undefined,
      programName: parsed.programName?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

export function dispatchLiveTradePortfolioFocus(
  focus?: LiveTradePortfolioFocus,
): void {
  if (typeof window === "undefined") return;
  if (focus) setPendingLiveTradePortfolioFocus(focus);
  window.dispatchEvent(
    new CustomEvent<LiveTradePortfolioFocus>(LIVE_TRADE_PORTFOLIO_FOCUS_EVENT, {
      detail: focus ?? consumePendingLiveTradePortfolioFocus() ?? undefined,
    }),
  );
}

export function dispatchLiveTradeDockOpenPortfolio(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_TRADE_DOCK_OPEN_PORTFOLIO_EVENT));
}

/** 우측 도크 «보유·거래» — 패널 내부 탭(실거래·거래내역) */
export function dispatchLiveTradePortfolioPanelTab(
  tab: LiveTradePortfolioPanelTab,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LiveTradePortfolioPanelTab>(
      LIVE_TRADE_PORTFOLIO_PANEL_TAB_EVENT,
      { detail: tab },
    ),
  );
}
