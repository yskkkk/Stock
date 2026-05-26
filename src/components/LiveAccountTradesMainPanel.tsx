import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLiveTradingPortfolio,
  type LiveTradePortfolioResponse,
} from "../api";
import LiveTradeHistorySimSection from "./LiveTradeHistorySimSection";
import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import LiveAccountHoldingsTable from "./LiveAccountHoldingsTable";
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";
import { liveTradeHistoryScenarioSub } from "./LiveTradeHistoryScenarioTabs";
import { ko } from "../i18n/ko";
import type { LiveTradeHistoryScenario } from "../lib/liveTradeHistoryScenario";
import { liveTradeHoldingMatchesExchange } from "../lib/liveTradeTradesExchangeFilter";

export default function LiveAccountTradesMainPanel({
  scenario,
  onOpenHoldingChart,
}: {
  scenario: LiveTradeHistoryScenario;
  onOpenHoldingChart?: Parameters<
    typeof LiveAccountHoldingsTable
  >[0]["onOpenHoldingChart"];
}) {
  const exchange =
    scenario === "live-toss"
      ? "toss"
      : scenario === "live-bithumb"
        ? "bithumb"
        : null;
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
    if (scenario === "sim") {
      setPortfolio(null);
      setPfErr(null);
      setPfLoading(false);
      return;
    }
    void loadPortfolio();
  }, [loadPortfolio, scenario]);

  const title =
    scenario === "sim"
      ? ko.app.liveTradeHistoryScenarioSim
      : scenario === "live-toss"
        ? ko.app.liveTradeTossShort
        : ko.app.liveTradeBithumbShort;
  const Mark =
    scenario === "sim"
      ? null
      : scenario === "live-toss"
        ? TossBrandMark
        : BithumbBrandMark;

  const liveHoldings = useMemo(() => {
    if (!portfolio || !exchange) return [];
    return portfolio.holdings.filter((h) =>
      liveTradeHoldingMatchesExchange(h, exchange),
    );
  }, [portfolio, exchange]);

  const showBalance = scenario !== "sim" && exchange != null;

  return (
    <div className="trade-history-main-workspace card">
      {showBalance ? (
        <header className="trade-history-main-workspace__head">
          <div className="live-trade-trades-workspace__title-row">
            {Mark ? (
              <Mark className="live-trade-trades-workspace__mark" />
            ) : null}
            <h2 className="live-trade-trades-workspace__title">
              {title} · {ko.app.liveTradeDockAccountTabBalance}
            </h2>
          </div>
        </header>
      ) : null}

      <div className="trade-history-main-workspace__body">
        {showBalance ? (
          pfLoading && !portfolio ? (
            <p className="live-trade-history__muted">{ko.app.liveTradePfLoading}</p>
          ) : pfErr ? (
            <p className="live-trade-history__err" role="alert">
              {pfErr}
            </p>
          ) : portfolio ? (
            <LiveAccountHoldingsTable
              exchange={exchange}
              holdings={liveHoldings}
              onOpenHoldingChart={onOpenHoldingChart}
            />
          ) : null
        ) : null}

        <header className="trade-history-main-workspace__subhead">
          <h3 className="live-trade-trades-workspace__title live-trade-trades-workspace__title--sub">
            {title} · {ko.app.liveTradePfTabTrades}
          </h3>
          <p className="live-trade-history__sub trade-history-main-workspace__scenario-sub">
            {liveTradeHistoryScenarioSub(scenario)}
          </p>
        </header>
        {scenario === "sim" ? (
          <LiveTradeHistorySimSection workspaceMode loadAll />
        ) : (
          <LiveTradeTradesHistoryPanel scenario={scenario} loadAll workspaceMode />
        )}
      </div>
    </div>
  );
}
