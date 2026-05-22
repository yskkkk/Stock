import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLiveTradingPortfolio,
  type LiveTradeHolding,
  type LiveTradePortfolioResponse,
  type LiveTradeProgram,
  type LiveTradeRecord,
} from "../api";
import { formatPercent, formatPrice, formatSignedMoney } from "../lib/format";
import { ko } from "../i18n/ko";

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

function programSummary(holdings: LiveTradeHolding[]) {
  let invested = 0;
  let market = 0;
  let unrealized = 0;
  for (const h of holdings) {
    invested += h.costBasis;
    if (h.marketValue != null) market += h.marketValue;
    if (h.unrealizedPnl != null) unrealized += h.unrealizedPnl;
  }
  const ret =
    invested > 0 && market > 0 ? ((market - invested) / invested) * 100 : null;
  return { holdingCount: holdings.length, invested, market, unrealized, ret };
}

function SimProgramCard({
  program,
  holdings,
  trades,
  busy,
  onStop,
}: {
  program: LiveTradeProgram;
  holdings: LiveTradeHolding[];
  trades: LiveTradeRecord[];
  busy: boolean;
  onStop: (id: string) => void;
}) {
  const sum = programSummary(holdings);
  const retUp = sum.ret != null && sum.ret >= 0;
  const recentTrades = trades.slice(0, 12);

  return (
    <article className="live-sim-run__card" data-program-id={program.id}>
      <header className="live-sim-run__card-head">
        <div>
          <h4 className="live-sim-run__card-title">{program.name}</h4>
          <p className="live-sim-run__card-ts">
            {ko.app.liveTradeSimRunSince} {formatTs(program.armedAtMs)}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={busy}
          onClick={() => onStop(program.id)}
        >
          {ko.app.liveTradeSimStop}
        </button>
      </header>

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
        {program.takeProfitPct != null ? (
          <li>
            {ko.app.liveTradeSimRunTakeProfit}: {program.takeProfitPct}%
          </li>
        ) : null}
        {program.stopLossPct != null ? (
          <li>
            {ko.app.liveTradeSimRunStopLoss}: {program.stopLossPct}%
          </li>
        ) : null}
        <li>
          {ko.app.liveTradeMinScoreShort} {(program.minScoreRatio * 100).toFixed(0)}%
        </li>
        <li>
          {ko.app.liveTradeFieldMaxPos} {program.maxOpenPositions}
        </li>
      </ul>

      {program.lastError ? (
        <p className="live-sim-run__err" role="alert">
          {program.lastError}
        </p>
      ) : null}

      <div className="live-sim-run__tiles">
        <div className="live-sim-run__tile">
          <span className="live-sim-run__tile-k">{ko.app.liveTradePfHoldings}</span>
          <span className="live-sim-run__tile-v">{sum.holdingCount}</span>
        </div>
        <div className="live-sim-run__tile">
          <span className="live-sim-run__tile-k">{ko.app.liveTradePfUnrealized}</span>
          <span
            className={
              sum.unrealized >= 0
                ? "live-sim-run__tile-v live-sim-run__tile-v--up"
                : "live-sim-run__tile-v live-sim-run__tile-v--down"
            }
          >
            {formatSignedMoney(sum.unrealized, "KRW")}
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
                <th>{ko.app.liveTradePfColCurrent}</th>
                <th>{ko.app.liveTradePfColTargetSell}</th>
                <th>{ko.app.liveTradePfColStopLoss}</th>
                <th>{ko.app.liveTradePfColPnl}</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const up = (h.changePct ?? 0) >= 0;
                return (
                  <tr key={`${h.market}:${h.symbol}`}>
                    <td data-label={ko.app.liveTradePfColSymbol}>
                      <span className="live-sim-run__sym">{h.symbol}</span>
                      <span className="live-sim-run__name">{h.name}</span>
                    </td>
                    <td className="live-sim-run__num" data-label={ko.app.liveTradePfColQty}>
                      {h.quantity}
                    </td>
                    <td
                      className="live-sim-run__num"
                      data-label={ko.app.liveTradePfColCurrent}
                    >
                      {h.currentPrice != null
                        ? formatPrice(h.currentPrice, h.currency)
                        : "—"}
                    </td>
                    <td
                      className="live-sim-run__num"
                      data-label={ko.app.liveTradePfColTargetSell}
                    >
                      {h.targetSellPrice != null
                        ? formatPrice(h.targetSellPrice, h.currency)
                        : "—"}
                    </td>
                    <td
                      className="live-sim-run__num"
                      data-label={ko.app.liveTradePfColStopLoss}
                    >
                      {h.stopLossPrice != null
                        ? formatPrice(h.stopLossPrice, h.currency)
                        : "—"}
                    </td>
                    <td
                      className={
                        h.unrealizedPnl == null
                          ? "live-sim-run__num"
                          : up
                            ? "live-sim-run__num live-sim-run__num--up"
                            : "live-sim-run__num live-sim-run__num--down"
                      }
                      data-label={ko.app.liveTradePfColPnl}
                    >
                      {h.unrealizedPnl != null
                        ? formatSignedMoney(h.unrealizedPnl, h.currency)
                        : "—"}
                    </td>
                  </tr>
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
                <th>{ko.app.liveTradePfColPrice}</th>
                <th>{ko.app.liveTradePfColAmount}</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((t) => (
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
                  <td className="live-sim-run__num" data-label={ko.app.liveTradePfColPrice}>
                    {formatPrice(t.price, t.currency)}
                  </td>
                  <td className="live-sim-run__num" data-label={ko.app.liveTradePfColAmount}>
                    {formatPrice(t.amount, t.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export default function LiveSimRunningPanel({
  programs,
  busy = false,
  onStop,
  refreshKey = 0,
}: {
  programs: LiveTradeProgram[];
  busy?: boolean;
  onStop: (id: string) => void;
  /** 부모 reload 시 포트폴리오 재조회 */
  refreshKey?: number;
}) {
  const simPrograms = useMemo(
    () => programs.filter((p) => p.status === "sim"),
    [programs],
  );
  const simIds = useMemo(
    () => new Set(simPrograms.map((p) => p.id)),
    [simPrograms],
  );

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
      setPortfolio(snap);
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
            />
          ))}
        </div>
      )}
    </section>
  );
}
