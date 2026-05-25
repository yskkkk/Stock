import { useCallback, useEffect, useState } from "react";
import {
  fetchLiveTradingPortfolio,
  type LiveTradePortfolioResponse,
} from "../api";
import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import LiveAccountHoldingsTable from "./LiveAccountHoldingsTable";
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";
import { ko } from "../i18n/ko";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";

export default function LiveAccountTradesMainPanel({
  exchange,
  onOpenHoldingChart,
}: {
  exchange: LiveTradeTradesExchange;
  onOpenHoldingChart?: Parameters<
    typeof LiveAccountHoldingsTable
  >[0]["onOpenHoldingChart"];
}) {
  const { user } = useLiveTradeAuth();
  const [portfolio, setPortfolio] = useState<LiveTradePortfolioResponse | null>(
    null,
  );
  const [pfLoading, setPfLoading] = useState(false);
  const [pfErr, setPfErr] = useState<string | null>(null);

  const loadPortfolio = useCallback(async () => {
    if (!user) {
      setPortfolio(null);
      setPfErr(null);
      return;
    }
    setPfLoading(true);
    try {
      const data = await fetchLiveTradingPortfolio(null);
      setPortfolio(data);
      setPfErr(null);
    } catch (e) {
      setPfErr(e instanceof Error ? e.message : String(e));
      setPortfolio(null);
    } finally {
      setPfLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio, exchange]);

  const title =
    exchange === "toss" ? ko.app.liveTradeTossShort : ko.app.liveTradeBithumbShort;
  const Mark = exchange === "toss" ? TossBrandMark : BithumbBrandMark;

  return (
    <div className="trade-history-main-workspace card">
      <header className="trade-history-main-workspace__head">
        <div className="live-trade-trades-workspace__title-row">
          <Mark className="live-trade-trades-workspace__mark" />
          <h2 className="live-trade-trades-workspace__title">
            {title} · {ko.app.liveTradeDockAccountTabBalance}
          </h2>
        </div>
      </header>

      <div className="trade-history-main-workspace__body">
        {pfLoading && !portfolio ? (
          <p className="live-trade-history__muted">{ko.app.liveTradePfLoading}</p>
        ) : pfErr ? (
          <p className="live-trade-history__err" role="alert">
            {pfErr}
          </p>
        ) : portfolio ? (
          <LiveAccountHoldingsTable
            exchange={exchange}
            holdings={portfolio.holdings}
            onOpenHoldingChart={onOpenHoldingChart}
          />
        ) : null}

        <header className="trade-history-main-workspace__subhead">
          <h3 className="live-trade-trades-workspace__title live-trade-trades-workspace__title--sub">
            {title} · {ko.app.liveTradePfTabTrades}
          </h3>
        </header>
        <LiveTradeTradesHistoryPanel
          exchange={exchange}
          loadAll
          workspaceMode
        />
      </div>
    </div>
  );
}
