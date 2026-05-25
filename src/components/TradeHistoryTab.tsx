import { useCallback, useEffect, useState } from "react";
import type { LiveTradeHolding } from "../api";
import LiveAccountTradesMainPanel from "./LiveAccountTradesMainPanel";
import { LiveTradeExchangePicker } from "./LiveTradeExchangePicker";
import {
  dispatchDockAccountProvider,
  LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT,
  readDockAccountProvider,
  readDockAccountProviderEvent,
} from "../lib/liveTradeDockAccount";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";

/** 상단 «거래내역» — 우측 계좌에서 선택한 거래소 체결 */
export default function TradeHistoryTab({
  onOpenHoldingChart,
}: {
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const [exchange, setExchange] = useState<LiveTradeTradesExchange>(
    readDockAccountProvider,
  );

  const selectExchange = useCallback((next: LiveTradeTradesExchange) => {
    setExchange(next);
    dispatchDockAccountProvider(next);
  }, []);

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
      <div className="trade-history-workspace__picker card">
        <LiveTradeExchangePicker
          compact
          selected={exchange}
          onSelect={selectExchange}
        />
      </div>
      <LiveAccountTradesMainPanel
        exchange={exchange}
        onOpenHoldingChart={onOpenHoldingChart}
      />
    </div>
  );
}
