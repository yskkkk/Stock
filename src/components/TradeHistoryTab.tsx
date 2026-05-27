import { useEffect, useState } from "react";
import type { LiveTradeHolding } from "../api";
import LiveAccountTradesMainPanel from "./LiveAccountTradesMainPanel";
import {
  LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT,
  readDockAccountProvider,
  readDockAccountProviderEvent,
} from "../lib/liveTradeDockAccount";
import type { LiveTradeHistoryScenario } from "../lib/liveTradeHistoryScenario";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";

function scenarioFromDockExchange(
  ex: LiveTradeTradesExchange,
): LiveTradeHistoryScenario {
  return ex === "toss" ? "live-toss" : "live-bithumb";
}

/** 거래내역 — 메인 영역 */
export default function TradeHistoryTab({
  onOpenHoldingChart,
}: {
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const [scenario, setScenario] = useState<LiveTradeHistoryScenario>(() =>
    scenarioFromDockExchange(readDockAccountProvider()),
  );

  useEffect(() => {
    const onProvider = (e: Event) => {
      const p = readDockAccountProviderEvent(e);
      if (p === "bithumb" || p === "toss") {
        setScenario(scenarioFromDockExchange(p));
      }
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
        scenario={scenario}
        onOpenHoldingChart={onOpenHoldingChart}
      />
    </div>
  );
}
