import { useCallback, useEffect, useState } from "react";
import { fetchLiveTradingTradeHistory, type LiveTradeRecord } from "../api";
import type { LiveTradeHistoryScenario } from "../lib/liveTradeHistoryScenario";

/** 토스·빗썸 실매매 전체 체결 (잔고·거래내역 공용) */
export function useLiveExchangeTrades(
  scenario: LiveTradeHistoryScenario | null,
  enabled: boolean,
) {
  const live =
    scenario === "live-toss" || scenario === "live-bithumb" ? scenario : null;
  const [trades, setTrades] = useState<LiveTradeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!live) {
      setTrades([]);
      setErr(null);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchLiveTradingTradeHistory({
        all: true,
        scenario: live,
      });
      setTrades(data.trades);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useEffect(() => {
    if (!enabled || !live) {
      setTrades([]);
      setErr(null);
      setLoading(false);
      return;
    }
    void reload();
  }, [enabled, live, reload]);

  return { trades, loading, err, reload };
}
