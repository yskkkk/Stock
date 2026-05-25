import { useEffect, useState } from "react";
import type { LiveTradeHolding } from "../api";
import LiveAccountTradesMainPanel from "./LiveAccountTradesMainPanel";
import {
  LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT,
  readDockAccountProvider,
  readDockAccountProviderEvent,
} from "../lib/liveTradeDockAccount";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";

/** 상단 «거래내역» — 우측 도크 «계좌»에서 고른 거래소만 반영 */
export default function TradeHistoryTab({
  onOpenHoldingChart,
}: {
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const [exchange, setExchange] = useState<LiveTradeTradesExchange>(
    readDockAccountProvider,
  );

  useEffect(() => {
    const onProvider = (e: Event) => {
      const p = readDockAccountProviderEvent(e);
      if (p === "bithumb" || p === "toss") setExchange(p);
    };
    window.addEventListener(LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT, onProvider);
    return () =>
      window.removeEventListener(
        LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT,
        onProvider,
      );
  }, []);

  return (
    <div className="workspace trade-history-workspace">
      <LiveAccountTradesMainPanel
        exchange={exchange}
        onOpenHoldingChart={onOpenHoldingChart}
      />
    </div>
  );
}
