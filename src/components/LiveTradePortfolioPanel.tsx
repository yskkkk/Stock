import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLiveTradeFeeRates } from "../contexts/LiveTradeFeeRatesContext";
import {
  buildPortfolioFeeNote,
  feeByMarketFromStatus,
} from "../lib/liveTradeFeeByMarket";
import {
  fetchLiveTradingMinuteQuotes,
  fetchLiveTradingPortfolio,
  simulateLiveTradeSell,
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
import LiveTradeSimPanel from "./LiveTradeSimPanel";
import LiveTradeOpenOrdersPanel from "./LiveTradeOpenOrdersPanel";
import { LiveTradeCollapsibleCard } from "./LiveTradeAuthAndCredentials";
import {
  formatLiveTradeQuantity,
  formatPercent,
  formatPrice,
  formatSignedMoney,
  formatTimeMsKst,
} from "../lib/format";
import {
  buildPortfolioMetricLines,
  formatUnrealizedPnlLabel,
  openHoldingsNetReturnPct,
  portfolioReturnPct,
  summarizeHoldingsPnl,
  summarizeNetMarketByCurrency,
  unrealizedPnlTone,
  type PortfolioMetricLine,
} from "../lib/livePortfolioPnl";
import { tradeFillDisplayByTradeId } from "../lib/liveTradeBuySellPrices";
import { formatTradeSideLabel } from "../lib/liveTradeSideDisplay";
import { notifyLiveTradeAuthChange } from "../lib/liveTradeAuthEvents";
import { refreshLiveTradingStatusNow } from "../hooks/useLiveTradingStatusPoll";
import { useUsdKrwRate } from "../hooks/useUsdKrwRate";
import { ko } from "../i18n/ko";
import {
  LiveHoldingChartSymbol,
  LiveTradeExitPriceCell,
  LiveTradeHoldingRationaleRow,
} from "./LiveTradeHoldingDisplay";
import { LiveTradeSymbolCellFromRecord as TradeSymbolCell } from "./LiveTradeSymbolCell";

type PanelTab = "summary" | "holdings" | "trades" | "openOrders";

function formatTs(ms: number): string {
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

function metricLinePrefix(line: PortfolioMetricLine): string {
  if (line.id === "total") return `${ko.app.liveTradePfTotalKrw} `;
  if (line.id === "fx") return `${ko.app.liveTradePfFxKrw} `;
  return "";
}

function metricLineClass(up: boolean | null, muted?: boolean): string {
  if (muted) return "live-portfolio__metric-line live-portfolio__metric-line--muted";
  if (up === true) return "live-portfolio__metric-line live-portfolio__metric-line--up";
  if (up === false) return "live-portfolio__metric-line live-portfolio__metric-line--down";
  return "live-portfolio__metric-line";
}

function SummaryMetricCard({
  label,
  lines,
  heroValue,
  heroUp,
  sub,
}: {
  label: string;
  lines?: PortfolioMetricLine[];
  heroValue?: string;
  heroUp?: boolean | null;
  sub?: string;
}) {
  return (
    <article className="live-portfolio__metric">
      <span className="live-portfolio__metric-k">{label}</span>
      {heroValue != null ? (
        <p
          className={
            heroUp === true
              ? "live-portfolio__metric-hero live-portfolio__metric-hero--up"
              : heroUp === false
                ? "live-portfolio__metric-hero live-portfolio__metric-hero--down"
                : "live-portfolio__metric-hero"
          }
        >
          {heroValue}
        </p>
      ) : null}
      {lines && lines.length > 0 ? (
        <ul className="live-portfolio__metric-lines">
          {lines.map((line) => (
            <li key={line.id} className={metricLineClass(line.up, line.muted)}>
              <span className="live-portfolio__metric-line-text">
                {metricLinePrefix(line)}
                {line.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {sub ? <span className="live-portfolio__metric-sub">{sub}</span> : null}
    </article>
  );
}

function PortfolioHeroTiles({
  holdings,
  summary,
  usdKrwRate,
  roundTripForMarket,
}: {
  holdings: LiveTradeHolding[];
  summary: LiveTradePortfolioResponse["summary"];
  usdKrwRate: number | null;
  roundTripForMarket: (market: LiveTradeHolding["market"]) => number;
}) {
  const agg = summarizeHoldingsPnl(holdings);
  const netMarketByCurrency = summarizeNetMarketByCurrency(
    holdings,
    roundTripForMarket,
  );
  const ret =
    openHoldingsNetReturnPct(holdings, roundTripForMarket, usdKrwRate) ??
    portfolioReturnPct(agg.investedByCurrency, netMarketByCurrency, usdKrwRate) ??
    summary.totalReturnPct;
  const retUp = ret != null && ret >= 0;
  const pnlUp = unrealizedPnlTone(agg.pnlByCurrency, usdKrwRate);
  const pnlDown = pnlUp === false;
  const unrealizedLabel = formatUnrealizedPnlLabel(agg.pnlByCurrency, usdKrwRate);

  return (
    <div className="live-sim-run__tiles live-portfolio__hero-tiles">
      <div className="live-sim-run__tile">
        <span className="live-sim-run__tile-k">{ko.app.liveTradePfHoldings}</span>
        <span className="live-sim-run__tile-v">{summary.holdingCount}</span>
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
          {unrealizedLabel}
        </span>
      </div>
      <div className="live-sim-run__tile">
        <span className="live-sim-run__tile-k">{ko.app.liveTradePfReturn}</span>
        <span
          className={
            ret == null
              ? "live-sim-run__tile-v"
              : retUp
                ? "live-sim-run__tile-v live-sim-run__tile-v--up"
                : "live-sim-run__tile-v live-sim-run__tile-v--down"
          }
        >
          {ret == null ? "—" : formatPercent(ret)}
        </span>
      </div>
    </div>
  );
}

function SummaryTiles({
  holdings,
  summary,
  usdKrwRate,
}: {
  holdings: LiveTradeHolding[];
  summary: LiveTradePortfolioResponse["summary"];
  usdKrwRate: number | null;
}) {
  const { roundTripForMarket } = useLiveTradeFeeRates();
  const feeNote = useMemo(
    () => buildPortfolioFeeNote(holdings, roundTripForMarket),
    [holdings, roundTripForMarket],
  );
  const agg = summarizeHoldingsPnl(holdings);
  const netMarketByCurrency = useMemo(
    () => summarizeNetMarketByCurrency(holdings, roundTripForMarket),
    [holdings, roundTripForMarket],
  );
  const ret =
    openHoldingsNetReturnPct(holdings, roundTripForMarket, usdKrwRate) ??
    portfolioReturnPct(
      agg.investedByCurrency,
      netMarketByCurrency,
      usdKrwRate,
    ) ??
    summary.totalReturnPct;
  const retUp = ret != null ? ret >= 0 : null;
  const investedLines = buildPortfolioMetricLines(
    agg.investedByCurrency,
    usdKrwRate,
    "price",
  );
  const marketLines = buildPortfolioMetricLines(
    agg.marketByCurrency,
    usdKrwRate,
    "price",
  );
  const unrealizedLines = buildPortfolioMetricLines(
    agg.pnlByCurrency,
    usdKrwRate,
    "signed",
  );
  const realizedUp = summary.realizedPnl >= 0;

  return (
    <div className="live-portfolio__summary">
      <div className="live-portfolio__summary-hero">
        <SummaryMetricCard
          label={ko.app.liveTradePfHoldings}
          heroValue={String(summary.holdingCount)}
        />
        <SummaryMetricCard
          label={ko.app.liveTradePfReturn}
          heroValue={ret == null ? "—" : formatPercent(ret)}
          heroUp={retUp}
          sub={feeNote}
        />
      </div>
      <div className="live-portfolio__summary-grid">
        <SummaryMetricCard
          label={ko.app.liveTradePfInvested}
          lines={investedLines}
        />
        <SummaryMetricCard label={ko.app.liveTradePfEval} lines={marketLines} />
        <SummaryMetricCard
          label={ko.app.liveTradePfUnrealized}
          lines={unrealizedLines}
        />
        <SummaryMetricCard
          label={ko.app.liveTradePfRealized}
          heroValue={formatSignedMoney(summary.realizedPnl, "KRW")}
          heroUp={realizedUp}
        />
      </div>
    </div>
  );
}

function HoldingRow({
  row,
  busy,
  portfolioProgramId,
  onSold,
  onOpenHoldingChart,
}: {
  row: LiveTradeHolding;
  busy: boolean;
  portfolioProgramId: string;
  onSold: (portfolio: LiveTradePortfolioResponse) => void;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const [sellOpen, setSellOpen] = useState(false);
  const [sellQty, setSellQty] = useState(() => String(row.quantity));
  const [sellErr, setSellErr] = useState<string | null>(null);
  const [sellOk, setSellOk] = useState<string | null>(null);

  const up = (row.unrealizedPnl ?? 0) >= 0;
  const chgUp = (row.changePct ?? 0) >= 0;

  const submitSell = () => {
    const quantity = Number(sellQty);
    setSellErr(null);
    setSellOk(null);
    void simulateLiveTradeSell({
      programId: row.programId,
      symbol: row.symbol,
      market: row.market,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
      portfolioProgramId: portfolioProgramId || null,
    })
      .then((res) => {
        setSellOpen(false);
        setSellOk(
          ko.app.liveTradeSimFilled
            .replace("{price}", formatPrice(res.quote.price, row.currency))
            .replace("{time}", formatTs(res.quote.atMs)),
        );
        onSold(res.portfolio);
      })
      .catch((e) => setSellErr(e instanceof Error ? e.message : String(e)));
  };

  return (
    <Fragment>
    <tr>
      <td data-label={ko.app.liveTradePfColSymbol}>
        <LiveHoldingChartSymbol holding={row} onOpen={onOpenHoldingChart} />
        {!portfolioProgramId && (row.programName ?? row.programId) ? (
          <span className="live-sim-run__name live-portfolio__row-prog">
            {row.programName ?? row.programId}
          </span>
        ) : null}
      </td>
      <td className="live-sim-run__num" data-label={ko.app.liveTradePfColQty}>
        {formatLiveTradeQuantity(row.quantity, row.market)}
      </td>
      <td className="live-sim-run__num" data-label={ko.app.liveTradePfColBuyPrice}>
        {row.avgEntryPrice > 0 ? formatPrice(row.avgEntryPrice, row.currency) : "—"}
      </td>
      <td className="live-sim-run__num" data-label={ko.app.liveTradePfColCurrent}>
        {row.currentPrice != null ? (
          <>
            {formatPrice(row.currentPrice, row.currency)}
            {row.changePct != null ? (
              <span
                className={
                  chgUp
                    ? "live-sim-run__quote-1m live-sim-run__num--up"
                    : "live-sim-run__quote-1m live-sim-run__num--down"
                }
              >
                {formatPercent(row.changePct)}
                {row.sinceNotifyReturnPct != null
                  ? ` · ${ko.app.liveTradePfSinceNotifyShort} ${formatPercent(row.sinceNotifyReturnPct)}`
                  : ""}
              </span>
            ) : null}
            {row.quoteQuotedAtMs ? (
              <span className="live-sim-run__quote-1m">
                {row.priceSource === "over"
                  ? "시간외"
                  : row.priceSource === "regular"
                    ? "정규"
                    : "분봉"}{" "}
                {formatTimeMsKst(row.quoteQuotedAtMs)}
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
          entry={row.avgEntryPrice}
          exitPrice={row.targetSellPrice}
          currency={row.currency}
          market={row.market}
          variant="success"
        />
      </td>
      <td
        className="live-sim-run__num live-sim-run__num--exit live-table__col live-table__col--exit"
        data-label={ko.app.liveTradePfColStopLoss}
      >
        <LiveTradeExitPriceCell
          entry={row.avgEntryPrice}
          exitPrice={row.stopLossPrice}
          currency={row.currency}
          market={row.market}
          variant="failure"
        />
      </td>
      <td
        className={
          row.unrealizedPnl == null
            ? "live-sim-run__num live-table__col live-table__col--num-end"
            : up
              ? "live-sim-run__num live-sim-run__num--up live-table__col live-table__col--num-end"
              : "live-sim-run__num live-sim-run__num--down live-table__col live-table__col--num-end"
        }
        data-label={ko.app.liveTradePfColPnl}
      >
        {row.unrealizedPnl != null
          ? formatSignedMoney(row.unrealizedPnl, row.currency)
          : "—"}
      </td>
      <td className="live-portfolio__actions-cell" data-label={ko.app.liveTradeSimSell}>
        {!sellOpen ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm live-portfolio__sell-btn"
            disabled={busy}
            onClick={() => {
              setSellOpen(true);
              setSellQty(String(row.quantity));
              setSellErr(null);
              setSellOk(null);
            }}
          >
            {ko.app.liveTradeSimSell}
          </button>
        ) : (
          <div className="live-portfolio__sell-form">
            <p className="live-portfolio__sell-hint">{ko.app.liveTradeSimSellHint}</p>
            <input
              type="number"
              className="input"
              min={1}
              max={row.quantity}
              placeholder={ko.app.liveTradePfSellQty}
              value={sellQty}
              onChange={(e) => setSellQty(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={submitSell}
            >
              {ko.app.liveTradePfSellConfirm}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setSellOpen(false)}
            >
              {ko.app.liveTradeCancelEdit}
            </button>
            {sellErr ? (
              <span className="live-portfolio__sell-err" role="alert">
                {sellErr}
              </span>
            ) : null}
          </div>
        )}
        {sellOk && !sellOpen ? (
          <span className="live-portfolio__sell-ok" role="status">
            {sellOk}
          </span>
        ) : null}
      </td>
    </tr>
    <LiveTradeHoldingRationaleRow holding={row} colSpan={8} />
    </Fragment>
  );
}

export default function LiveTradePortfolioPanel({
  programs,
  onOpenHoldingChart,
}: {
  programs: LiveTradeProgram[];
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const [tab, setTab] = useState<PanelTab>("holdings");
  const [programId, setProgramId] = useState<string>("");
  const [data, setData] = useState<LiveTradePortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { feeRates, roundTripForMarket } = useLiveTradeFeeRates();
  const feeByMarket = useMemo(
    () => feeByMarketFromStatus(feeRates),
    [feeRates],
  );

  const applyPortfolioSnapshot = useCallback(
    async (snap: LiveTradePortfolioResponse) => {
      const syms = [
        ...new Set(
          snap.holdings.map((h) => h.symbol.trim().toUpperCase()).filter(Boolean),
        ),
      ];
      let merged = snap;
      if (syms.length > 0) {
        try {
          const q = await fetchLiveTradingMinuteQuotes(syms);
          merged = mergeLiveQuotesIntoPortfolio(snap, q.quotes ?? {}, feeByMarket);
        } catch {
          merged = snap;
        }
      }
      setData(merged);
      setErr(null);
    },
    [feeByMarket],
  );

  const load = useCallback(
    async (opts?: { keepQuoteMerge?: boolean }) => {
      try {
        const snap = await fetchLiveTradingPortfolio(programId || null);
        if (opts?.keepQuoteMerge) {
          setData((prev) =>
            prev?.holdings.length
              ? mergeLiveQuotesIntoPortfolio(
                  snap,
                  extractQuotesFromPortfolio(prev),
                  feeByMarket,
                )
              : snap,
          );
        } else {
          await applyPortfolioSnapshot(snap);
        }
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [programId, feeByMarket, applyPortfolioSnapshot],
  );

  const onPortfolioAfterTrade = useCallback(
    (snap: LiveTradePortfolioResponse) => {
      void applyPortfolioSnapshot(snap);
      refreshLiveTradingStatusNow();
      notifyLiveTradeAuthChange();
    },
    [applyPortfolioSnapshot],
  );

  useEffect(() => {
    setLoading(true);
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  useLivePortfolioQuotePoll(
    data,
    setData,
    Boolean(data?.holdings.length),
    feeByMarket,
  );
  const { rate: usdKrwRate } = useUsdKrwRate(Boolean(data?.holdings.length));

  const programOptions = useMemo(
    () => [{ id: "", name: ko.app.liveTradePfAllPrograms }, ...programs],
    [programs],
  );

  useEffect(() => {
    if (!programId) return;
    if (!programs.some((p) => p.id === programId)) {
      setProgramId("");
    }
  }, [programs, programId]);

  const tradeFill = useMemo(
    () => tradeFillDisplayByTradeId(data?.trades ?? []),
    [data?.trades],
  );

  const collapsedSummary = useMemo(() => {
    if (loading && !data) return ko.app.liveTradePfLoading;
    if (err && !data) {
      const s = String(err);
      return s.length > 72 ? `${s.slice(0, 69)}…` : s;
    }
    if (!data) return "—";
    const agg = summarizeHoldingsPnl(data.holdings);
    const netMarketByCurrency = summarizeNetMarketByCurrency(
      data.holdings,
      roundTripForMarket,
    );
    const ret =
      openHoldingsNetReturnPct(data.holdings, roundTripForMarket, usdKrwRate) ??
      portfolioReturnPct(agg.investedByCurrency, netMarketByCurrency, usdKrwRate) ??
      data.summary.totalReturnPct;
    const retStr = ret == null ? "—" : formatPercent(ret);
    const unrealKrw = agg.pnlByCurrency.KRW;
    const unrealStr =
      unrealKrw != null && Number.isFinite(unrealKrw)
        ? formatSignedMoney(unrealKrw, "KRW")
        : "—";
    return `${ko.app.liveTradePfHoldings} ${data.summary.holdingCount} · ${ko.app.liveTradePfReturn} ${retStr} · ${ko.app.liveTradePfUnrealized} ${unrealStr}`;
  }, [data, loading, err, usdKrwRate, roundTripForMarket]);

  return (
    <>
      <LiveTradeSimPanel
        programs={programs}
        defaultProgramId={programId || undefined}
        onTraded={() => {
          setBusy(true);
          void load({ keepQuoteMerge: false }).finally(() => setBusy(false));
        }}
      />
      <LiveTradeCollapsibleCard
        title={ko.app.liveTradePfTitle}
        summary={collapsedSummary}
        className="live-portfolio live-portfolio--collapsible live-portfolio--sim-like"
        ariaLabel={ko.app.liveTradePfTitle}
      >
      <header className="live-portfolio__head live-portfolio__head--in-card">
        <div className="live-portfolio__head-tools">
          <label className="live-portfolio__filter">
            <span className="live-portfolio__filter-label">
              {ko.app.liveTradePfProgramFilter}
            </span>
            <select
              className="input live-portfolio__select"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
            >
              {programOptions.map((p) => (
                <option key={p.id || "all"} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn--secondary btn--sm live-portfolio__refresh"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            {ko.app.liveTradePfRefresh}
          </button>
        </div>
      </header>

      <div className="live-portfolio__panel live-portfolio__panel--in-card">
        <div className="live-portfolio__tabs" role="tablist">
          {(
            [
              ["summary", ko.app.liveTradePfTabSummary],
              ["holdings", ko.app.liveTradePfTabHoldings],
              ["trades", ko.app.liveTradePfTabTrades],
              ["openOrders", ko.app.liveTradePfTabOpenOrders],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={
                tab === id
                  ? "live-portfolio__tab live-portfolio__tab--active"
                  : "live-portfolio__tab"
              }
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && !data ? (
          <p className="live-portfolio__muted">{ko.app.liveTradePfLoading}</p>
        ) : null}
        {err ? (
          <p className="live-portfolio__banner live-portfolio__banner--err" role="alert">
            {err}
          </p>
        ) : null}

        {data ? (
          <div className="live-portfolio__body">
          <PortfolioHeroTiles
            holdings={data.holdings}
            summary={data.summary}
            usdKrwRate={usdKrwRate}
            roundTripForMarket={roundTripForMarket}
          />

          {tab === "summary" ? (
            <SummaryTiles
              holdings={data.holdings}
              summary={data.summary}
              usdKrwRate={usdKrwRate}
            />
          ) : null}

          {tab === "holdings" ? (
            data.holdings.length === 0 ? (
              <p className="live-sim-run__muted">{ko.app.liveTradePfNoHoldings}</p>
            ) : (
              <>
              <h5 className="live-sim-run__sub">{ko.app.liveTradeSimRunHoldings}</h5>
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
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.holdings.map((h) => (
                      <HoldingRow
                        key={`${h.programId}:${h.market}:${h.symbol}`}
                        row={h}
                        busy={busy}
                        onOpenHoldingChart={onOpenHoldingChart}
                        portfolioProgramId={programId}
                        onSold={(snap) => {
                          setBusy(true);
                          onPortfolioAfterTrade(snap);
                          setBusy(false);
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )
          ) : null}

          {tab === "openOrders" ? (
            <LiveTradeOpenOrdersPanel
              onChanged={() => {
                void load({ keepQuoteMerge: false });
                notifyLiveTradeAuthChange();
              }}
            />
          ) : null}

          {tab === "trades" ? (
            data.trades.length === 0 ? (
              <>
                <p className="live-portfolio__exchange-note">
                  {ko.app.liveTradePfExchangeTradesNote}
                </p>
                <p className="live-portfolio__muted">{ko.app.liveTradePfNoTrades}</p>
              </>
            ) : (
              <>
              <p className="live-portfolio__exchange-note">
                {ko.app.liveTradePfExchangeTradesNote}
              </p>
              <h5 className="live-sim-run__sub">{ko.app.liveTradeSimRunRecentTrades}</h5>
              <div className="live-sim-run__table-wrap">
                <table className="live-sim-run__table live-sim-run__table--stacked live-sim-run__table--trades">
                  <thead>
                    <tr>
                      <th>{ko.app.liveTradePfColTime}</th>
                      <th>{ko.app.liveTradePfColSide}</th>
                      <th>{ko.app.liveTradePfColSymbol}</th>
                      <th>{ko.app.liveTradePfColQty}</th>
                      <th>{ko.app.liveTradePfColBuyPrice}</th>
                      <th>{ko.app.liveTradePfColSellPrice}</th>
                      <th>{ko.app.liveTradePfColRealizedPnlPct}</th>
                      <th>{ko.app.liveTradePfColRealizedPnl}</th>
                      <th>{ko.app.liveTradePfColAmount}</th>
                      <th>{ko.app.liveTradePfColProgram}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trades.map((t) => {
                      const fd = tradeFill.get(t.id);
                      const pnlUp =
                        fd?.realizedPnl != null ? fd.realizedPnl >= 0 : null;
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
                          {formatTradeSideLabel(t)}
                        </td>
                        <td data-label={ko.app.liveTradePfColSymbol}>
                          <TradeSymbolCell t={t} />
                        </td>
                        <td className="live-sim-run__num" data-label={ko.app.liveTradePfColQty}>
                          {formatLiveTradeQuantity(t.quantity, t.market)}
                        </td>
                        <td
                          className="live-sim-run__num"
                          data-label={ko.app.liveTradePfColBuyPrice}
                        >
                          {fd?.buyPrice != null
                            ? formatPrice(fd.buyPrice, t.currency)
                            : "—"}
                        </td>
                        <td
                          className="live-sim-run__num"
                          data-label={ko.app.liveTradePfColSellPrice}
                        >
                          {fd?.sellPrice != null
                            ? formatPrice(fd.sellPrice, t.currency)
                            : "—"}
                        </td>
                        <td
                          className={
                            pnlUp == null
                              ? "live-sim-run__num"
                              : pnlUp
                                ? "live-sim-run__num live-sim-run__num--up"
                                : "live-sim-run__num live-sim-run__num--down"
                          }
                          data-label={ko.app.liveTradePfColRealizedPnlPct}
                        >
                          {fd?.realizedPnlPct != null
                            ? formatPercent(fd.realizedPnlPct)
                            : "—"}
                        </td>
                        <td
                          className={
                            pnlUp == null
                              ? "live-sim-run__num"
                              : pnlUp
                                ? "live-sim-run__num live-sim-run__num--up"
                                : "live-sim-run__num live-sim-run__num--down"
                          }
                          data-label={ko.app.liveTradePfColRealizedPnl}
                        >
                          {fd?.realizedPnl != null
                            ? formatSignedMoney(fd.realizedPnl, t.currency)
                            : "—"}
                        </td>
                        <td className="live-sim-run__num" data-label={ko.app.liveTradePfColAmount}>
                          {formatPrice(t.amount, t.currency)}
                        </td>
                        <td
                          className="live-sim-run__num live-portfolio__prog"
                          data-label={ko.app.liveTradePfColProgram}
                        >
                          <span className="live-sim-run__sym">{t.programName ?? t.programId}</span>
                          {t.note ? (
                            <span className="live-sim-run__name" title={t.note}>
                              {t.note}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )
          ) : null}

          {data.updatedAtMs ? (
            <p className="live-portfolio__updated">
              {formatTs(data.updatedAtMs)} {ko.app.liveTradePfUpdated}
            </p>
          ) : null}
          </div>
        ) : null}
      </div>
      </LiveTradeCollapsibleCard>
    </>
  );
}
