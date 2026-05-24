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
import {
  formatLiveTradeQuantity,
  formatPercent,
  formatPrice,
  formatSignedMoney,
  formatTimeMsKst,
} from "../lib/format";
import {
  LivePortfolioMoney,
  LivePortfolioSignedMoney,
} from "../lib/livePortfolioMoneyDisplay";
import {
  buildPortfolioMetricLines,
  portfolioReturnPct,
  summarizeHoldingsPnl,
  type PortfolioMetricLine,
} from "../lib/livePortfolioPnl";
import { tradeFillDisplayByTradeId } from "../lib/liveTradeBuySellPrices";
import { useUsdKrwRate } from "../hooks/useUsdKrwRate";
import { ko } from "../i18n/ko";
import {
  LiveHoldingChartSymbol,
  LiveTradeExitPriceCell,
  LiveTradeHoldingRationaleRow,
} from "./LiveTradeHoldingDisplay";

type PanelTab = "summary" | "holdings" | "trades";

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

function sideLabel(side: LiveTradeRecord["side"]): string {
  return side === "buy" ? ko.app.liveTradeSideBuy : ko.app.liveTradeSideSell;
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
  const ret =
    portfolioReturnPct(
      agg.investedByCurrency,
      agg.marketByCurrency,
      usdKrwRate,
    ) ?? summary.totalReturnPct;
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
  usdKrwRate,
  onSold,
  onOpenHoldingChart,
}: {
  row: LiveTradeHolding;
  busy: boolean;
  usdKrwRate: number | null;
  onSold: () => void;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const [sellOpen, setSellOpen] = useState(false);
  const [sellQty, setSellQty] = useState(() => String(row.quantity));
  const [sellErr, setSellErr] = useState<string | null>(null);
  const [sellOk, setSellOk] = useState<string | null>(null);

  const up = (row.changePct ?? 0) >= 0;

  const submitSell = () => {
    const quantity = Number(sellQty);
    setSellErr(null);
    setSellOk(null);
    void simulateLiveTradeSell({
      programId: row.programId,
      symbol: row.symbol,
      market: row.market,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
    })
      .then((res) => {
        setSellOpen(false);
        setSellOk(
          ko.app.liveTradeSimFilled
            .replace("{price}", formatPrice(res.quote.price, row.currency))
            .replace("{time}", formatTs(res.quote.atMs)),
        );
        onSold();
      })
      .catch((e) => setSellErr(e instanceof Error ? e.message : String(e)));
  };

  return (
    <Fragment>
    <tr className="live-portfolio__row">
      <td data-label={ko.app.liveTradePfColSymbol}>
        <LiveHoldingChartSymbol
          holding={row}
          variant="portfolio"
          onOpen={onOpenHoldingChart}
        />
      </td>
      <td className="live-portfolio__num live-table__col live-table__col--num-end" data-label={ko.app.liveTradePfColQty}>
        {formatLiveTradeQuantity(row.quantity, row.market)}
      </td>
      <td className="live-portfolio__num live-table__col live-table__col--num-end" data-label={ko.app.liveTradePfColBuyPrice}>
        <LivePortfolioMoney
          amount={row.avgEntryPrice}
          currency={row.currency}
          usdKrwRate={usdKrwRate}
        />
      </td>
      <td
        className="live-portfolio__num live-portfolio__num--price live-table__col live-table__col--num-end"
        data-label={ko.app.liveTradePfColCurrent}
      >
        <span className="live-portfolio__price-cell">
          <LivePortfolioMoney
            amount={row.currentPrice}
            currency={row.currency}
            usdKrwRate={usdKrwRate}
          />
          {row.quoteQuotedAtMs ? (
            <span className="live-portfolio__quote-ts">
              {row.priceSource === "over"
                ? "시간외"
                : row.priceSource === "regular"
                  ? "정규"
                  : "분봉"}{" "}
              {formatTimeMsKst(row.quoteQuotedAtMs)}
            </span>
          ) : null}
          {row.changePct != null ? (
            <span
              className={
                up
                  ? "live-portfolio__inline-pct live-portfolio__inline-pct--up"
                  : "live-portfolio__inline-pct live-portfolio__inline-pct--down"
              }
            >
              {formatPercent(row.changePct)}
            </span>
          ) : null}
        </span>
      </td>
      <td
        className="live-portfolio__num live-portfolio__num--exit live-table__col live-table__col--exit"
        data-label={ko.app.liveTradePfColTargetSell}
      >
        <LiveTradeExitPriceCell
          entry={row.avgEntryPrice}
          exitPrice={row.targetSellPrice}
          currency={row.currency}
          market={row.market}
          variant="success"
          usdKrwRate={usdKrwRate}
        />
      </td>
      <td
        className="live-portfolio__num live-portfolio__num--exit live-table__col live-table__col--exit"
        data-label={ko.app.liveTradePfColStopLoss}
      >
        <LiveTradeExitPriceCell
          entry={row.avgEntryPrice}
          exitPrice={row.stopLossPrice}
          currency={row.currency}
          market={row.market}
          variant="failure"
          usdKrwRate={usdKrwRate}
        />
      </td>
      <td
        className={
          row.unrealizedPnl == null
            ? "live-portfolio__num live-table__col live-table__col--num-end"
            : row.unrealizedPnl >= 0
              ? "live-portfolio__num live-portfolio__num--up live-table__col live-table__col--num-end"
              : "live-portfolio__num live-portfolio__num--down live-table__col live-table__col--num-end"
        }
        data-label={ko.app.liveTradePfColPnl}
      >
        {row.unrealizedPnl == null ? (
          "—"
        ) : (
          <LivePortfolioSignedMoney
            amount={row.unrealizedPnl}
            currency={row.currency}
            usdKrwRate={usdKrwRate}
          />
        )}
      </td>
      <td className="live-portfolio__actions-cell">
        {!sellOpen ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
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
    <LiveTradeHoldingRationaleRow holding={row} colSpan={7} />
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
  const [tab, setTab] = useState<PanelTab>("summary");
  const [programId, setProgramId] = useState<string>("");
  const [data, setData] = useState<LiveTradePortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { feeRates } = useLiveTradeFeeRates();
  const feeByMarket = useMemo(
    () => feeByMarketFromStatus(feeRates),
    [feeRates],
  );

  const load = useCallback(async () => {
    try {
      const snap = await fetchLiveTradingPortfolio(programId || null);
      const syms = [
        ...new Set(snap.holdings.map((h) => h.symbol.trim().toUpperCase()).filter(Boolean)),
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
      setData((prev) =>
        prev?.holdings.length
          ? mergeLiveQuotesIntoPortfolio(
              merged,
              extractQuotesFromPortfolio(prev),
              feeByMarket,
            )
          : merged,
      );
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [programId, feeByMarket]);

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

  return (
    <>
      <LiveTradeSimPanel
        programs={programs}
        defaultProgramId={programId || undefined}
        onTraded={() => {
          setBusy(true);
          void load().finally(() => setBusy(false));
        }}
      />
      <section className="live-portfolio card" aria-label={ko.app.liveTradePfTitle}>
      <header className="live-portfolio__head">
        <h3 className="live-trading-tab__section-title live-portfolio__title">
          {ko.app.liveTradePfTitle}
        </h3>
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

      <div className="live-portfolio__panel">
        <div className="live-portfolio__tabs" role="tablist">
          {(
            [
              ["summary", ko.app.liveTradePfTabSummary],
              ["holdings", ko.app.liveTradePfTabHoldings],
              ["trades", ko.app.liveTradePfTabTrades],
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
          {tab === "summary" ? (
            <SummaryTiles
              holdings={data.holdings}
              summary={data.summary}
              usdKrwRate={usdKrwRate}
            />
          ) : null}

          {tab === "holdings" ? (
            data.holdings.length === 0 ? (
              <p className="live-portfolio__muted">{ko.app.liveTradePfNoHoldings}</p>
            ) : (
              <div className="live-portfolio__table-wrap">
                <table className="live-portfolio__table live-portfolio__table--stacked live-portfolio__table--holdings">
                  <thead>
                    <tr>
                      <th>{ko.app.liveTradePfColSymbol}</th>
                      <th className="live-table__col live-table__col--num-end">
                        {ko.app.liveTradePfColQty}
                      </th>
                      <th className="live-table__col live-table__col--num-end">
                        {ko.app.liveTradePfColBuyPrice}
                      </th>
                      <th className="live-table__col live-table__col--num-end">
                        {ko.app.liveTradePfColCurrent}
                      </th>
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
                        usdKrwRate={usdKrwRate}
                        onOpenHoldingChart={onOpenHoldingChart}
                        onSold={() => {
                          setBusy(true);
                          void load().finally(() => setBusy(false));
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {tab === "trades" ? (
            data.trades.length === 0 ? (
              <p className="live-portfolio__muted">{ko.app.liveTradePfNoTrades}</p>
            ) : (
              <div className="live-portfolio__table-wrap">
                <table className="live-portfolio__table live-portfolio__table--stacked live-portfolio__table--trades">
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
                            ? "live-portfolio__row live-portfolio__row--buy"
                            : "live-portfolio__row live-portfolio__row--sell"
                        }
                      >
                        <td className="live-portfolio__ts" data-label={ko.app.liveTradePfColTime}>
                          {formatTs(t.atMs)}
                        </td>
                        <td data-label={ko.app.liveTradePfColSide}>
                          <span
                            className={
                              t.side === "buy"
                                ? "live-portfolio__side live-portfolio__side--buy"
                                : "live-portfolio__side live-portfolio__side--sell"
                            }
                          >
                            {sideLabel(t.side)}
                            {t.simulated ? (
                              <span className="live-portfolio__sim">{ko.app.liveTradeSimTag}</span>
                            ) : null}
                          </span>
                        </td>
                        <td data-label={ko.app.liveTradePfColSymbol}>
                          <span className="live-portfolio__sym">{t.symbol}</span>
                          <span className="live-portfolio__nm">{t.name}</span>
                        </td>
                        <td className="live-portfolio__num" data-label={ko.app.liveTradePfColQty}>
                          {formatLiveTradeQuantity(t.quantity, t.market)}
                        </td>
                        <td
                          className="live-portfolio__num"
                          data-label={ko.app.liveTradePfColBuyPrice}
                        >
                          {fd?.buyPrice != null
                            ? formatPrice(fd.buyPrice, t.currency)
                            : "—"}
                        </td>
                        <td
                          className="live-portfolio__num"
                          data-label={ko.app.liveTradePfColSellPrice}
                        >
                          {fd?.sellPrice != null
                            ? formatPrice(fd.sellPrice, t.currency)
                            : "—"}
                        </td>
                        <td
                          className={
                            pnlUp == null
                              ? "live-portfolio__num"
                              : pnlUp
                                ? "live-portfolio__num live-portfolio__num--up"
                                : "live-portfolio__num live-portfolio__num--down"
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
                              ? "live-portfolio__num"
                              : pnlUp
                                ? "live-portfolio__num live-portfolio__num--up"
                                : "live-portfolio__num live-portfolio__num--down"
                          }
                          data-label={ko.app.liveTradePfColRealizedPnl}
                        >
                          {fd?.realizedPnl != null
                            ? formatSignedMoney(fd.realizedPnl, t.currency)
                            : "—"}
                        </td>
                        <td className="live-portfolio__num" data-label={ko.app.liveTradePfColAmount}>
                          {formatPrice(t.amount, t.currency)}
                        </td>
                        <td
                          className="live-portfolio__prog live-portfolio__actions-cell"
                          data-label={ko.app.liveTradePfColProgram}
                        >
                          {t.programName ?? t.programId}
                          {t.note ? (
                            <span className="live-portfolio__note" title={t.note}>
                              · {t.note}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
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
    </section>
    </>
  );
}
