import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLiveTradingPortfolio,
  type LiveTradeHolding,
  type LiveTradePortfolioResponse,
} from "../api";
import LiveTradeHistorySimSection from "./LiveTradeHistorySimSection";
import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import LiveAccountHoldingsTossCards from "./LiveAccountHoldingsTossCards";
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import LiveTradeApiNotConnectedNotice from "./LiveTradeApiNotConnectedNotice";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";
import { liveTradeHistoryScenarioSub } from "./LiveTradeHistoryScenarioTabs";
import { ko } from "../i18n/ko";
import type { LiveTradeHistoryScenario } from "../lib/liveTradeHistoryScenario";
import { liveTradeHoldingMatchesExchange } from "../lib/liveTradeTradesExchangeFilter";
import {
  TOSS_LEDGER_POLL_MS,
  useTossAccountSnapshot,
} from "../hooks/useTossAccountSnapshot";
import { useTossSnapshotLiveQuotes } from "../hooks/useTossSnapshotLiveQuotes";
import { mapTossHoldingsToLiveTrade } from "../lib/tossHoldingsAsLiveTrade";
import { useLiveExchangeTrades } from "../hooks/useLiveExchangeTrades";
import { useUsdKrwRate } from "../hooks/useUsdKrwRate";
import { exchangeAccountPnlSummary } from "../lib/exchangeAccountPnlSummary";
import LiveAccountPnlSummaryBar from "./LiveAccountPnlSummaryBar";

export default function LiveAccountTradesMainPanel({
  scenario,
  onOpenHoldingChart,
}: {
  scenario: LiveTradeHistoryScenario;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const exchange =
    scenario === "live-toss"
      ? "toss"
      : scenario === "live-bithumb"
        ? "bithumb"
        : null;
  const { user } = useLiveTradeAuth();
  const status = useLiveTradingStatusPoll();
  const apiReady =
    exchange === "toss"
      ? Boolean(status?.toss?.ready)
      : exchange === "bithumb"
        ? Boolean(status?.bithumb?.ready)
        : true;
  const [portfolio, setPortfolio] = useState<LiveTradePortfolioResponse | null>(
    null,
  );
  const [pfLoading, setPfLoading] = useState(false);
  const [pfErr, setPfErr] = useState<string | null>(null);
  const {
    snapshot: tossSnapshot,
    loading: tossSnapshotLoading,
    err: tossSnapshotErr,
  } = useTossAccountSnapshot({
    poll: scenario === "live-toss" && apiReady,
    pollIntervalMs: TOSS_LEDGER_POLL_MS,
  });
  const { snapshot: liveTossSnapshot } = useTossSnapshotLiveQuotes(
    tossSnapshot,
    scenario === "live-toss" && apiReady,
  );

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
    if (scenario === "sim" || scenario === "live-toss") {
      setPortfolio(null);
      setPfErr(null);
      setPfLoading(false);
      return;
    }
    if (!apiReady) {
      setPortfolio(null);
      setPfErr(null);
      setPfLoading(false);
      return;
    }
    void loadPortfolio();
  }, [loadPortfolio, scenario, apiReady]);

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
    if (scenario === "live-toss") {
      return mapTossHoldingsToLiveTrade(liveTossSnapshot?.holdings ?? []);
    }
    if (!portfolio || !exchange) return [];
    return portfolio.holdings.filter((h) =>
      liveTradeHoldingMatchesExchange(h, exchange),
    );
  }, [scenario, liveTossSnapshot, portfolio, exchange]);

  const showBalance = scenario !== "sim" && exchange != null;

  const {
    trades: exchangeTrades,
    loading: exchangeTradesLoading,
    err: exchangeTradesErr,
  } = useLiveExchangeTrades(scenario, showBalance && apiReady);
  const { rate: usdKrwRate } = useUsdKrwRate(
    showBalance && scenario === "live-toss" && liveHoldings.length > 0,
  );
  const accountPnl = useMemo(() => {
    if (!showBalance) return null;
    if (exchangeTrades.length === 0 && liveHoldings.length === 0) return null;
    return exchangeAccountPnlSummary(exchangeTrades, liveHoldings, {
      usdKrwRate,
    });
  }, [showBalance, scenario, exchangeTrades, liveHoldings, usdKrwRate]);
  const cumulativeReturnBySymbol = useMemo(() => {
    if (!accountPnl) return undefined;
    const m = new Map<string, number | null>();
    for (const [key, row] of accountPnl.bySymbol) {
      m.set(key, row.totalReturnPct);
    }
    return m;
  }, [accountPnl]);

  const holdingsLoading =
    scenario === "live-toss" ? tossSnapshotLoading && !tossSnapshot : pfLoading && !portfolio;
  const holdingsErr = scenario === "live-toss" ? tossSnapshotErr : pfErr;

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
        {showBalance && !apiReady && exchange ? (
          <LiveTradeApiNotConnectedNotice exchange={exchange} />
        ) : showBalance ? (
          holdingsLoading ? (
            <p className="live-trade-history__muted">{ko.app.liveTradePfLoading}</p>
          ) : holdingsErr ? (
            <p className="live-trade-history__err" role="alert">
              {holdingsErr}
            </p>
          ) : (
            <div className="trade-history-main-workspace__holdings-pane">
              {accountPnl ? <LiveAccountPnlSummaryBar summary={accountPnl} /> : null}
              {exchangeTradesErr ? (
                <p className="live-trade-history__err" role="alert">
                  {exchangeTradesErr}
                </p>
              ) : null}
              <LiveAccountHoldingsTossCards
                exchange={exchange}
                holdings={liveHoldings}
                cumulativeReturnBySymbol={cumulativeReturnBySymbol}
                onOpenHoldingChart={onOpenHoldingChart}
              />
            </div>
          )
        ) : null}

        {scenario === "sim" || (showBalance && !apiReady) ? null : (
          <header className="trade-history-main-workspace__subhead">
            <h3 className="live-trade-trades-workspace__title live-trade-trades-workspace__title--sub">
              {title} · {ko.app.liveTradePfTabTrades}
            </h3>
            <p className="live-trade-history__sub trade-history-main-workspace__scenario-sub">
              {liveTradeHistoryScenarioSub(scenario)}
            </p>
          </header>
        )}
        {scenario === "sim" ? (
          <LiveTradeHistorySimSection workspaceMode loadAll />
        ) : showBalance && !apiReady ? null : (
          <LiveTradeTradesHistoryPanel
            scenario={scenario}
            loadAll
            workspaceMode
            holdings={liveHoldings}
            sharedTrades={exchangeTrades}
            sharedTradesLoading={exchangeTradesLoading}
            suppressAccountSummary
          />
        )}
      </div>
    </div>
  );
}
