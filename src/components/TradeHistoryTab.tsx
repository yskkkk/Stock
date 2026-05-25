import { useEffect, useState } from "react";
import LiveAccountTradesMainPanel from "./LiveAccountTradesMainPanel";
import {
  LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT,
  readDockAccountProvider,
  readDockAccountProviderEvent,
} from "../lib/liveTradeDockAccount";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";

/** 상단 «거래내역» — 우측 계좌에서 선택한 거래소 체결 */
export default function TradeHistoryTab() {
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
      <LiveAccountTradesMainPanel exchange={exchange} />
    </div>
  );
}
