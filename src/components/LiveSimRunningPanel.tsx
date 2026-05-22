import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLiveTradingMinuteQuotes,
  fetchLiveTradingPortfolio,
  type LiveTradeHolding,
  type LiveTradePortfolioResponse,
  type LiveTradeProgram,
  type LiveTradeRecord,
} from "../api";
import { useLivePortfolioQuotePoll } from "../hooks/useLivePortfolioQuotePoll";
import {
  extractQuotesFromPortfolio,
  mergeLiveQuotesIntoPortfolio,
} from "../lib/livePortfolioLiveQuotes";
import { formatPercent, formatPrice, formatSignedMoney, formatTimeMsKst } from "../lib/format";
import {
  formatUnrealizedPnlLabel,
  portfolioReturnPct,
  summarizeHoldingsPnl,
  unrealizedPnlTone,
} from "../lib/livePortfolioPnl";
import { useUsdKrwRate } from "../hooks/useUsdKrwRate";
import { buySellPricesByTradeId } from "../lib/liveTradeBuySellPrices";
import { showProgramRunError } from "../lib/liveProgramDisplay";
import { ko } from "../i18n/ko";
import LiveSimFeedbackBlock from "./LiveSimFeedbackBlock";
import {
  LiveHoldingChartSymbol,
  LiveTradeExitPriceCell,
  LiveTradeHoldingRationaleRow,
} from "./LiveTradeHoldingDisplay";

function formatTs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function programSummary(
  holdings: LiveTradeHolding[],
  usdKrwRate: number | null,
) {
  const agg = summarizeHoldingsPnl(holdings);
  const ret = portfolioReturnPct(
    agg.investedByCurrency,
    agg.marketByCurrency,
    usdKrwRate,
  );
  const unrealizedLabel = formatUnrealizedPnlLabel(
    agg.pnlByCurrency,
    usdKrwRate,
  );
  const unrealizedUp = unrealizedPnlTone(agg.pnlByCurrency, usdKrwRate);
  return {
    holdingCount: holdings.length,
    unrealizedLabel,
    unrealizedUp,
    ret,
  };
}

function SimProgramCard({
  program,
  holdings,
  trades,
  busy,
  onStop,
  refreshKey,
  onProgramUpdated,
  onOpenHoldingChart,
  usdKrwRate,
}: {
  program: LiveTradeProgram;
  holdings: LiveTradeHolding[];
  trades: LiveTradeRecord[];
  busy: boolean;
  onStop: (id: string) => void;
  refreshKey?: number;
  onProgramUpdated?: () => void;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
  usdKrwRate: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const sum = programSummary(holdings, usdKrwRate);
  const retUp = sum.ret != null && sum.ret >= 0;
  const pnlUp = sum.unrealizedUp === true;
  const pnlDown = sum.unrealizedUp === false;
  const recentTrades = trades.slice(0, 12);
  const tradeBuySell = useMemo(
    () => buySellPricesByTradeId(trades),
    [trades],
  );

  const toggleExpanded = () => setExpanded((v) => !v);

  return (
    <article
      className={`live-sim-run__card${expanded ? " live-sim-run__card--open" : ""}`}
      data-program-id={program.id}
    >
      <header className="live-sim-run__card-head">
        <div
          className="live-sim-run__card-head-main"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `${program.name} ${ko.app.liveTradeSimRunCollapse}`
              : `${program.name} ${ko.app.liveTradeSimRunExpand}`
          }
          onClick={toggleExpanded}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleExpanded();
            }
          }}
        >
          <h4 className="live-sim-run__card-title">{program.name}</h4>
          <p className="live-sim-run__card-ts">
            {ko.app.liveTradeSimRunSince} {formatTs(program.armedAtMs)}
          </p>
          {!expanded ? (
            <p className="live-sim-run__card-summary" aria-live="polite">
              <span>
                {ko.app.liveTradePfHoldings} {sum.holdingCount}
              </span>
              <span aria-hidden>·</span>
              <span
                className={
                  sum.ret == null
                    ? ""
                    : retUp
                      ? "live-sim-run__card-summary--up"
                      : "live-sim-run__card-summary--down"
                }
              >
                {ko.app.liveTradePfReturn}{" "}
                {sum.ret == null ? "—" : formatPercent(sum.ret)}
              </span>
              <span aria-hidden>·</span>
              <span
                className={
                  pnlUp
                    ? "live-sim-run__card-summary--up"
                    : pnlDown
                      ? "live-sim-run__card-summary--down"
                      : ""
                }
              >
                {sum.unrealizedLabel}
              </span>
            </p>
          ) : null}
        </div>
        <div
          className="live-sim-run__card-head-actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={busy}
            onClick={() => onStop(program.id)}
          >
            {ko.app.liveTradeSimStop}
          </button>
        </div>
      </header>

      {showProgramRunError(program, sum.holdingCount) ? (
        <p className="live-sim-run__err" role="alert">
          {program.lastError}
        </p>
      ) : null}

      {expanded ? (
      <>
      <ul className="live-sim-run__chips" aria-label={ko.app.liveTradeSimRunSettings}>
        <li>
          {program.simAutoBuy !== false
            ? ko.app.liveTradeSimRunAutoBuyOn
            : ko.app.liveTradeSimRunAutoBuyOff}
        </li>
        <li>
          {program.autoSellAtTarget !== false
            ? ko.app.liveTradeSimRunAutoSellOn
            : ko.app.liveTradeSimRunAutoSellOff}
        </li>
        {program.autoSellAtTarget !== false ? (
          <li>{ko.app.liveTradeAutoExitHint}</li>
        ) : null}
        <li>
          {ko.app.liveTradeMinScoreShort} {(program.minScoreRatio * 100).toFixed(0)}%
        </li>
        <li>
          {ko.app.liveTradeFieldMaxPos} {program.maxOpenPositions}
        </li>
      </ul>

      <LiveSimFeedbackBlock
        programId={program.id}
        refreshKey={(refreshKey ?? 0) + trades.length}
        onApplied={onProgramUpdated}
      />

      <div className="live-sim-run__tiles">
        <div className="live-sim-run__tile">
          <span className="live-sim-run__tile-k">{ko.app.liveTradePfHoldings}</span>
          <span className="live-sim-run__tile-v">{sum.holdingCount}</span>
        </div>
        <div className="live-sim-run__tile">
          <span className="live-sim-run__tile-k">{ko.app.liveTradePfUnrealized}</span>
          <span
            className={
              pnlUp
                ? "live-sim-run__tile-v live-sim-run__tile-v--up"
                : pnlDown
                  ? "live-sim-run__tile-v live-sim-run__tile-v--down"
                  : "live-sim-run__tile-v"
            }
          >
            {sum.unrealizedLabel}
          </span>
        </div>
        <div className="live-sim-run__tile">
          <span className="live-sim-run__tile-k">{ko.app.liveTradePfReturn}</span>
          <span
            className={
              sum.ret == null
                ? "live-sim-run__tile-v"
                : retUp
                  ? "live-sim-run__tile-v live-sim-run__tile-v--up"
                  : "live-sim-run__tile-v live-sim-run__tile-v--down"
            }
          >
            {sum.ret == null ? "—" : formatPercent(sum.ret)}
          </span>
        </div>
      </div>

      <h5 className="live-sim-run__sub">{ko.app.liveTradeSimRunHoldings}</h5>
      {holdings.length === 0 ? (
        <p className="live-sim-run__muted">{ko.app.liveTradePfNoHoldings}</p>
      ) : (
        <div className="live-sim-run__table-wrap">
          <table className="live-sim-run__table live-sim-run__table--stacked">
            <thead>
              <tr>
                <th>{ko.app.liveTradePfColSymbol}</th>
                <th>{ko.app.liveTradePfColQty}</th>
                <th>{ko.app.liveTradePfColBuyPrice}</th>
                <th>{ko.app.liveTradePfColCurrent}</th>
                <th className="live-table__col live-table__col--exit">
                  {ko.app.liveTradePfColTargetSell}
                </th>
                <th className="live-table__col live-table__col--exit">
                  {ko.app.liveTradePfColStopLoss}
                </th>
                <th className="live-table__col live-table__col--num-end">
                  {ko.app.liveTradePfColPnl}
                </th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const up = (h.changePct ?? 0) >= 0;
                return (
                  <Fragment key={`${h.market}:${h.symbol}`}>
                  <tr>
                    <td data-label={ko.app.liveTradePfColSymbol}>
                      <LiveHoldingChartSymbol
                        holding={h}
                        onOpen={onOpenHoldingChart}
                      />
                    </td>
                    <td className="live-sim-run__num" data-label={ko.app.liveTradePfColQty}>
                      {h.quantity}
                    </td>
                    <td
                      className="live-sim-run__num"
                      data-label={ko.app.liveTradePfColBuyPrice}
                    >
                      {h.avgEntryPrice > 0
                        ? formatPrice(h.avgEntryPrice, h.currency)
                        : "—"}
                    </td>
                    <td
                      className="live-sim-run__num"
                      data-label={ko.app.liveTradePfColCurrent}
                    >
                      {h.currentPrice != null ? (
                        <>
                          {formatPrice(h.currentPrice, h.currency)}
                          {h.quoteQuotedAtMs ? (
                            <span className="live-sim-run__quote-1m">
                              {h.priceSource === "over"
                                ? "시간외"
                                : h.priceSource === "regular"
                                  ? "정규"
                                  : "분봉"}{" "}
                              {formatTimeMsKst(h.quoteQuotedAtMs)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className="live-sim-run__num live-sim-run__num--exit live-table__col live-table__col--exit"
                      data-label={ko.app.liveTradePfColTargetSell}
                    >
                      <LiveTradeExitPriceCell
                        entry={h.avgEntryPrice}
                        exitPrice={h.targetSellPrice}
                        currency={h.currency}
                        variant="success"
                      />
                    </td>
                    <td
                      className="live-sim-run__num live-sim-run__num--exit live-table__col live-table__col--exit"
                      data-label={ko.app.liveTradePfColStopLoss}
                    >
                      <LiveTradeExitPriceCell
                        entry={h.avgEntryPrice}
                        exitPrice={h.stopLossPrice}
                        currency={h.currency}
                        variant="failure"
                      />
                    </td>
                    <td
                      className={
                        h.unrealizedPnl == null
                          ? "live-sim-run__num live-table__col live-table__col--num-end"
                          : up
                            ? "live-sim-run__num live-sim-run__num--up live-table__col live-table__col--num-end"
                            : "live-sim-run__num live-sim-run__num--down live-table__col live-table__col--num-end"
                      }
                      data-label={ko.app.liveTradePfColPnl}
                    >
                      {h.unrealizedPnl != null
                        ? formatSignedMoney(h.unrealizedPnl, h.currency)
                        : "—"}
                    </td>
                  </tr>
                  <LiveTradeHoldingRationaleRow holding={h} colSpan={7} />
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h5 className="live-sim-run__sub">{ko.app.liveTradeSimRunRecentTrades}</h5>
      {recentTrades.length === 0 ? (
        <p className="live-sim-run__muted">{ko.app.liveTradePfNoTrades}</p>
      ) : (
        <div className="live-sim-run__table-wrap">
          <table className="live-sim-run__table live-sim-run__table--stacked live-sim-run__table--trades">
            <thead>
              <tr>
                <th>{ko.app.liveTradePfColTime}</th>
                <th>{ko.app.liveTradePfColSide}</th>
                <th>{ko.app.liveTradePfColSymbol}</th>
                <th>{ko.app.liveTradePfColBuyPrice}</th>
                <th>{ko.app.liveTradePfColSellPrice}</th>
                <th>{ko.app.liveTradePfColAmount}</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((t) => {
                const bp = tradeBuySell.get(t.id);
                return (
                <tr
                  key={t.id}
                  className={
                    t.side === "buy"
                      ? "live-sim-run__row--buy"
                      : "live-sim-run__row--sell"
                  }
                >
                  <td className="live-sim-run__ts" data-label={ko.app.liveTradePfColTime}>
                    {formatTs(t.atMs)}
                  </td>
                  <td data-label={ko.app.liveTradePfColSide}>
                    {t.side === "buy"
                      ? ko.app.liveTradeSideBuy
                      : ko.app.liveTradeSideSell}
                  </td>
                  <td data-label={ko.app.liveTradePfColSymbol}>{t.symbol}</td>
                  <td
                    className="live-sim-run__num"
                    data-label={ko.app.liveTradePfColBuyPrice}
                  >
                    {bp?.buyPrice != null
                      ? formatPrice(bp.buyPrice, t.currency)
                      : "—"}
                  </td>
                  <td
                    className="live-sim-run__num"
                    data-label={ko.app.liveTradePfColSellPrice}
                  >
                    {bp?.sellPrice != null
                      ? formatPrice(bp.sellPrice, t.currency)
                      : "—"}
                  </td>
                  <td className="live-sim-run__num" data-label={ko.app.liveTradePfColAmount}>
                    {formatPrice(t.amount, t.currency)}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      ) : null}
    </article>
  );
}

export default function LiveSimRunningPanel({
  programs,
  busy = false,
  onStop,
  refreshKey = 0,
  onProgramUpdated,
  onOpenHoldingChart,
}: {
  programs: LiveTradeProgram[];
  busy?: boolean;
  onStop: (id: string) => void;
  /** 부모 reload 시 포트폴리오 재조회 */
  refreshKey?: number;
  onProgramUpdated?: () => void;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const simPrograms = useMemo(
    () => programs.filter((p) => p.status === "sim"),
    [programs],
  );
  const simIds = useMemo(
    () => new Set(simPrograms.map((p) => p.id)),
    [simPrograms],
  );
  const { rate: usdKrwRate } = useUsdKrwRate(simIds.size > 0);

  const [portfolio, setPortfolio] = useState<LiveTradePortfolioResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const loadPortfolio = useCallback(async () => {
    if (simIds.size === 0) {
      setPortfolio(null);
      setErr(null);
      return;
    }
    setLoading(true);
    try {
      const snap = await fetchLiveTradingPortfolio(null);
      const syms = [
        ...new Set(snap.holdings.map((h) => h.symbol.trim().toUpperCase()).filter(Boolean)),
      ];
      let merged = snap;
      if (syms.length > 0) {
        try {
          const q = await fetchLiveTradingMinuteQuotes(syms);
          merged = mergeLiveQuotesIntoPortfolio(snap, q.quotes ?? {});
        } catch {
          merged = snap;
        }
      }
      setPortfolio((prev) =>
        prev?.holdings.length
          ? mergeLiveQuotesIntoPortfolio(merged, extractQuotesFromPortfolio(prev))
          : merged,
      );
      setUpdatedAt(Date.now());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [simIds.size]);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio, refreshKey]);

  useEffect(() => {
    if (simIds.size === 0) return;
    const id = window.setInterval(() => void loadPortfolio(), 20_000);
    return () => window.clearInterval(id);
  }, [loadPortfolio, simIds.size]);

  useLivePortfolioQuotePoll(portfolio, setPortfolio, simIds.size > 0);

  const byProgram = useMemo(() => {
    const holdings = new Map<string, LiveTradeHolding[]>();
    const trades = new Map<string, LiveTradeRecord[]>();
    for (const id of simIds) {
      holdings.set(id, []);
      trades.set(id, []);
    }
    if (!portfolio) return { holdings, trades };
    for (const h of portfolio.holdings) {
      if (!simIds.has(h.programId)) continue;
      holdings.get(h.programId)?.push(h);
    }
    const sorted = [...portfolio.trades].sort((a, b) => b.atMs - a.atMs);
    for (const t of sorted) {
      if (!simIds.has(t.programId)) continue;
      trades.get(t.programId)?.push(t);
    }
    return { holdings, trades };
  }, [portfolio, simIds]);

  return (
    <section className="live-sim-run card" aria-label={ko.app.liveTradeSimRunTitle}>
      <div className="live-sim-run__head">
        <div>
          <h3 className="live-trading-tab__section-title">
            {ko.app.liveTradeSimRunTitle}
          </h3>
          <p className="live-sim-run__subhead">{ko.app.liveTradeSimRunSub}</p>
        </div>
        <div className="live-sim-run__head-tools">
          {updatedAt != null && simPrograms.length > 0 ? (
            <span className="live-sim-run__updated">
              {ko.app.liveTradePfUpdated}{" "}
              {formatTs(updatedAt)}
            </span>
          ) : null}
          <span
            className={
              simPrograms.length > 0
                ? "live-sim-run__count live-sim-run__count--on"
                : "live-sim-run__count"
            }
          >
            {simPrograms.length}
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={loading || simPrograms.length === 0}
            onClick={() => void loadPortfolio()}
          >
            {ko.app.liveTradePfRefresh}
          </button>
        </div>
      </div>

      {err ? (
        <p className="live-sim-run__err" role="alert">
          {err}
        </p>
      ) : null}

      {simPrograms.length === 0 ? (
        <p className="live-sim-run__empty">{ko.app.liveTradeSimRunEmpty}</p>
      ) : loading && !portfolio ? (
        <p className="live-sim-run__muted">{ko.app.liveTradePfLoading}</p>
      ) : (
        <div className="live-sim-run__cards">
          {simPrograms.map((p) => (
            <SimProgramCard
              key={p.id}
              program={p}
              holdings={byProgram.holdings.get(p.id) ?? []}
              trades={byProgram.trades.get(p.id) ?? []}
              busy={busy}
              onStop={onStop}
              refreshKey={refreshKey}
              onProgramUpdated={onProgramUpdated}
              onOpenHoldingChart={onOpenHoldingChart}
              usdKrwRate={usdKrwRate}
            />
          ))}
        </div>
      )}
    </section>
  );
}
