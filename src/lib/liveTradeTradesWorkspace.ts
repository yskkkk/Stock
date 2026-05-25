export type LiveTradeTradesExchange = "toss" | "bithumb";

export type LiveTradeTradesWorkspaceState =
  | { mode: "picker" }
  | { mode: "history"; exchange: LiveTradeTradesExchange };

export const LIVE_TRADE_TRADES_WORKSPACE_EVENT =
  "ystock-live-trade-trades-workspace";

export function dispatchLiveTradeTradesWorkspace(
  state: LiveTradeTradesWorkspaceState | null,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LiveTradeTradesWorkspaceState | null>(
      LIVE_TRADE_TRADES_WORKSPACE_EVENT,
      { detail: state },
    ),
  );
}

export function readLiveTradeTradesWorkspaceEvent(
  e: Event,
): LiveTradeTradesWorkspaceState | null {
  const d = (e as CustomEvent<LiveTradeTradesWorkspaceState | null>).detail;
  return d === undefined ? null : d;
}
