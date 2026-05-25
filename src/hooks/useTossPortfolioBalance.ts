import { useCallback, useEffect, useState } from "react";
import {
  fetchAuthMe,
  fetchLiveTradingPortfolio,
  type AuthUser,
  type LiveTradeHolding,
} from "../api";
import { LIVE_TRADE_AUTH_CHANGE } from "../lib/liveTradeAuthEvents";
import { summarizeHoldingsPnl } from "../lib/livePortfolioPnl";

const POLL_MS = 45_000;

function isTossMarket(m: string): boolean {
  return m === "kr" || m === "us";
}

export function useTossPortfolioBalance() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [holdings, setHoldings] = useState<LiveTradeHolding[]>([]);
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const me = await fetchAuthMe();
      setUser(me.user);
      if (!me.user) {
        setHoldings([]);
        setUpdatedAtMs(null);
        setErr(null);
        return;
      }
      const pf = await fetchLiveTradingPortfolio();
      const list = (pf.holdings ?? []).filter((h) => isTossMarket(h.market));
      setHoldings(list);
      setUpdatedAtMs(pf.updatedAtMs ?? Date.now());
      setErr(null);
    } catch (e) {
      setHoldings([]);
      setUpdatedAtMs(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthChecked(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), POLL_MS);
    const onAuth = () => void reload();
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuth);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onAuth);
    };
  }, [reload]);

  const agg = summarizeHoldingsPnl(holdings);

  return {
    user,
    authChecked,
    holdings,
    updatedAtMs,
    loading,
    err,
    reload,
    unrealKrw: agg.pnlByCurrency.KRW,
  };
}
