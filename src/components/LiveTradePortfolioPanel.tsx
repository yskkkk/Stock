import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveTradeFeeRates } from "../contexts/LiveTradeFeeRatesContext";
import {
  buildPortfolioFeeNote,
  feeByMarketFromStatus,
} from "../lib/liveTradeFeeByMarket";
import {
  fetchAccessAdminLiveTradingPortfolio,
  fetchLiveTradingMinuteQuotes,
  fetchLiveTradingPortfolio,
  getStoredAccessAdminToken,
  type LiveTradeHolding,
  type LiveTradePortfolioResponse,
  type LiveTradeProgram,
  type LiveTradeRecord,
} from "../api";
import {
  consumePendingLiveTradePortfolioFocus,
  LIVE_TRADE_PORTFOLIO_FOCUS_EVENT,
  dispatchLiveTradePortfolioPanelTab,
  LIVE_TRADE_PORTFOLIO_PANEL_TAB_EVENT,
  type LiveTradePortfolioFocus,
  type LiveTradePortfolioPanelTab,
} from "../lib/liveTradePortfolioFocus";
import {
  LIVE_TRADE_ARMED_POLL_MS,
  useLivePortfolioQuotePoll,
} from "../hooks/useLivePortfolioQuotePoll";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";
import {
  extractQuotesFromPortfolio,
  mergeLiveQuotesIntoPortfolio,
} from "../lib/livePortfolioLiveQuotes";
import LiveTradePortfolioTradeTab from "./LiveTradePortfolioTradeTab";
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
import { RefreshIconButton } from "./RefreshIconButton";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import { openAccountTrades } from "../lib/liveTradeDockAccount";
import {
  LiveHoldingChartSymbol,
  LiveTradeExitPriceCell,
  LiveTradeHoldingRationaleRow,
} from "./LiveTradeHoldingDisplay";
import { LiveTradeSymbolCellFromRecord as TradeSymbolCell } from "./LiveTradeSymbolCell";
import { LiveTradeTradesHistoryTable } from "./LiveTradeTradesHistoryPanel";
import LiveTradeHistorySimSection from "./LiveTradeHistorySimSection";
import { filterSimPrograms } from "../lib/liveTradeSimPrograms";

type PanelTab = "summary" | "holdings" | "trade" | "trades" | "openOrders";

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
  trail,
}: {
  label: string;
  lines?: PortfolioMetricLine[];
  heroValue?: string;
  heroUp?: boolean | null;
  sub?: string;
  /** 금액 오른쪽 작은 보조 텍스트(갱신 시각 등) */
  trail?: string;
}) {
  const heroClass =
    heroUp === true
      ? "live-portfolio__metric-hero live-portfolio__metric-hero--up"
      : heroUp === false
        ? "live-portfolio__metric-hero live-portfolio__metric-hero--down"
        : "live-portfolio__metric-hero";

  return (
    <article className="live-portfolio__metric">
      <span className="live-portfolio__metric-k">{label}</span>
      {heroValue != null ? (
        <div className="live-portfolio__metric-hero-row">
          <p className={heroClass}>{heroValue}</p>
          {trail ? (
            <span className="live-portfolio__metric-trail">{trail}</span>
          ) : null}
        </div>
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
  updatedAtMs,
}: {
  holdings: LiveTradeHolding[];
  summary: LiveTradePortfolioResponse["summary"];
  usdKrwRate: number | null;
  updatedAtMs?: number | null;
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
  const updatedTrail =
    updatedAtMs != null && Number.isFinite(updatedAtMs)
      ? `${formatTs(updatedAtMs)} ${ko.app.liveTradePfUpdated}`
      : undefined;

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
          trail={updatedTrail}
        />
      </div>
    </div>
  );
}

function HoldingRow({
  row,
  portfolioProgramId,
  onOpenHoldingChart,
}: {
  row: LiveTradeHolding;
  portfolioProgramId: string;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const up = (row.unrealizedPnl ?? 0) >= 0;
  const chgUp = (row.changePct ?? 0) >= 0;

  return (
    <>
    <tr>
      <td data-label={ko.app.liveTradePfColSymbol}>
        <LiveHoldingChartSymbol
          holding={row}
          onOpen={onOpenHoldingChart}
          footer={
            !portfolioProgramId && (row.programName ?? row.programId) ? (
              <span className="live-sim-run__name live-portfolio__row-prog">
                {row.programName ?? row.programId}
              </span>
            ) : null
          }
        />
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
    </tr>
    <LiveTradeHoldingRationaleRow holding={row} colSpan={7} />
    </>
  );
}

export default function LiveTradePortfolioPanel({
  programs,
  onOpenHoldingChart,
  initialAdminView = null,
  /** 우측 도크 — 관리자 조회와 무관하게 로그인 본인만 */
  selfOnly = false,
}: {
  programs: LiveTradeProgram[];
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
  initialAdminView?: {
    userId: string;
    programId?: string;
    programName?: string;
  } | null;
  selfOnly?: boolean;
}) {
  const [pinnedTab, setPinnedTab] = useState<PanelTab>(
    selfOnly ? "trade" : "holdings",
  );
  const [hoverTab, setHoverTab] = useState<PanelTab | null>(null);
  const viewTab = hoverTab ?? pinnedTab;
  const { user } = useLiveTradeAuth();
  const [programId, setProgramId] = useState<string>("");
  const [adminViewUserId, setAdminViewUserId] = useState<string | null>(null);
  const [adminViewProgramName, setAdminViewProgramName] = useState<string | null>(
    null,
  );
  const [data, setData] = useState<LiveTradePortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSeqRef = useRef(0);
  const { feeRates, roundTripForMarket } = useLiveTradeFeeRates();
  const feeByMarket = useMemo(
    () => feeByMarketFromStatus(feeRates),
    [feeRates],
  );

  const applyPortfolioSnapshot = useCallback(
    async (snap: LiveTradePortfolioResponse, loadSeq?: number) => {
      const syms = [
        ...new Set(
          snap.holdings
            .map((h) => String(h.symbol ?? "").trim().toUpperCase())
            .filter(Boolean),
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
      if (loadSeq != null && loadSeq !== loadSeqRef.current) return;
      setData(merged);
      setErr(null);
    },
    [feeByMarket],
  );

  const applyPortfolioFocus = useCallback(
    (focus: LiveTradePortfolioFocus) => {
      if (
        selfOnly &&
        focus.userId &&
        user?.id &&
        focus.userId !== user.id
      ) {
        return;
      }
      setProgramId(focus.programId);
      if (
        !selfOnly &&
        focus.userId &&
        user?.id &&
        focus.userId !== user.id
      ) {
        setAdminViewUserId(focus.userId);
        setAdminViewProgramName(focus.programName ?? null);
      } else {
        setAdminViewUserId(null);
        setAdminViewProgramName(null);
      }
    },
    [selfOnly, user?.id],
  );

  useEffect(() => {
    if (selfOnly) {
      setAdminViewUserId(null);
      setAdminViewProgramName(null);
    }
    if (
      initialAdminView?.userId &&
      (!selfOnly ||
        !user?.id ||
        initialAdminView.userId === user.id)
    ) {
      applyPortfolioFocus({
        programId: initialAdminView.programId ?? "",
        userId: selfOnly ? undefined : initialAdminView.userId,
        programName: initialAdminView.programName,
      });
      return;
    }
    const pending = consumePendingLiveTradePortfolioFocus();
    if (pending) applyPortfolioFocus(pending);
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<LiveTradePortfolioFocus>).detail;
      if (detail?.programId) applyPortfolioFocus(detail);
    };
    window.addEventListener(LIVE_TRADE_PORTFOLIO_FOCUS_EVENT, onFocus);
    return () =>
      window.removeEventListener(LIVE_TRADE_PORTFOLIO_FOCUS_EVENT, onFocus);
  }, [applyPortfolioFocus, initialAdminView, selfOnly, user?.id]);

  const adminReadOnly = Boolean(
    !selfOnly && adminViewUserId && user?.id && user.id !== adminViewUserId,
  );

  const resolvedProgramId = useMemo(() => {
    if (adminReadOnly && programId) return programId;
    if (programId && programs.some((p) => p.id === programId)) return programId;
    return programs[0]?.id ?? "";
  }, [programId, programs, adminReadOnly]);

  const isArmedPortfolio = useMemo(
    () =>
      programs.find((p) => p.id === resolvedProgramId)?.status === "armed",
    [programs, resolvedProgramId],
  );

  const programOptions = useMemo(() => {
    if (adminReadOnly && programId) {
      const name =
        adminViewProgramName ??
        programs.find((p) => p.id === programId)?.name ??
        programId;
      return [{ id: programId, name }];
    }
    return programs.map((p) => ({ id: p.id, name: p.name }));
  }, [programs, adminReadOnly, programId, adminViewProgramName]);

  useEffect(() => {
    if (adminReadOnly) return;
    const firstId = programs[0]?.id ?? "";
    if (!programId || !programs.some((p) => p.id === programId)) {
      if (firstId !== programId) setProgramId(firstId);
    }
  }, [programs, programId, adminReadOnly]);

  const load = useCallback(
    async (opts?: { keepQuoteMerge?: boolean }) => {
      const seq = ++loadSeqRef.current;
      try {
        let snap: LiveTradePortfolioResponse;
        const useAdminPortfolio = Boolean(
          !selfOnly &&
            adminViewUserId &&
            user?.id &&
            user.id !== adminViewUserId,
        );
        if (useAdminPortfolio) {
          const token = getStoredAccessAdminToken();
          if (!token) throw new Error(ko.access.adminPasswordLabel);
          snap = await fetchAccessAdminLiveTradingPortfolio(
            token,
            adminViewUserId!,
            resolvedProgramId,
          );
        } else {
          snap = await fetchLiveTradingPortfolio(resolvedProgramId || null, {
            exchangeSync: isArmedPortfolio,
          });
        }
        if (opts?.keepQuoteMerge) {
          if (seq !== loadSeqRef.current) return;
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
          await applyPortfolioSnapshot(snap, seq);
        }
        if (seq !== loadSeqRef.current) return;
        setErr(null);
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    },
    [
      resolvedProgramId,
      adminViewUserId,
      user?.id,
      selfOnly,
      feeByMarket,
      applyPortfolioSnapshot,
      isArmedPortfolio,
    ],
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
    let cancelled = false;
    setLoading(true);
    void load();
    const pollMs = isArmedPortfolio ? LIVE_TRADE_ARMED_POLL_MS : 30_000;
    const id = window.setInterval(() => {
      if (!cancelled) void load();
    }, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load, isArmedPortfolio]);

  useLivePortfolioQuotePoll(
    data,
    setData,
    Boolean(data?.holdings.length),
    feeByMarket,
    isArmedPortfolio ? LIVE_TRADE_ARMED_POLL_MS : undefined,
  );
  const { rate: usdKrwRate } = useUsdKrwRate(Boolean(data?.holdings.length));

  useEffect(() => {
    if (
      adminReadOnly &&
      (pinnedTab === "trade" || pinnedTab === "openOrders")
    ) {
      setPinnedTab("holdings");
      setHoverTab(null);
    }
  }, [adminReadOnly, pinnedTab]);

  useEffect(() => {
    if (!selfOnly) return;
    const onPanelTab = (e: Event) => {
      const tab = (e as CustomEvent<LiveTradePortfolioPanelTab>).detail;
      if (tab !== "trade" && tab !== "trades") return;
      setPinnedTab(tab);
      setHoverTab(null);
    };
    window.addEventListener(LIVE_TRADE_PORTFOLIO_PANEL_TAB_EVENT, onPanelTab);
    return () =>
      window.removeEventListener(LIVE_TRADE_PORTFOLIO_PANEL_TAB_EVENT, onPanelTab);
  }, [selfOnly]);

  const simPrograms = useMemo(() => filterSimPrograms(programs), [programs]);

  const tradesByScenario = useMemo(() => {
    const all = data?.trades ?? [];
    return {
      sim: all.filter((t) => t.simulated),
      liveBithumb: all.filter((t) => !t.simulated && t.market === "crypto"),
      liveToss: all.filter(
        (t) => !t.simulated && (t.market === "kr" || t.market === "us"),
      ),
    };
  }, [data?.trades]);

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
      <LiveTradeCollapsibleCard
        title={ko.app.liveTradePfTitle}
        summary={collapsedSummary}
        className="live-portfolio live-portfolio--collapsible live-portfolio--sim-like"
        ariaLabel={ko.app.liveTradePfTitle}
        sidePanelId={selfOnly ? undefined : "portfolio"}
      >
      <header className="live-portfolio__head live-portfolio__head--in-card">
        {adminReadOnly ? (
          <p className="live-portfolio__admin-view-note" role="status">
            {ko.access.liveTradePfAdminView.replace(
              "{name}",
              adminViewProgramName ?? programId,
            )}
          </p>
        ) : null}
        <div className="live-portfolio__head-tools">
          <label className="live-portfolio__filter">
            <span className="live-portfolio__filter-label">
              {ko.app.liveTradePfProgramFilter}
            </span>
            <select
              className="input live-portfolio__select"
              value={resolvedProgramId}
              disabled={adminReadOnly || programOptions.length === 0}
              onChange={(e) => {
                const next = e.target.value;
                if (next === resolvedProgramId) return;
                setProgramId(next);
                setLoading(true);
              }}
            >
              {programOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <RefreshIconButton
            label={ko.app.liveTradePfRefresh}
            className="btn btn--secondary btn--sm live-portfolio__refresh"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void load();
            }}
          />
        </div>
      </header>

      <div
        className={[
          "live-portfolio__panel",
          "live-portfolio__panel--in-card",
          loading ? "live-portfolio__panel--pending" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          className="live-portfolio__tabs"
          role="tablist"
          onMouseLeave={() => setHoverTab(null)}
        >
          {(
            selfOnly
              ? ([
                  ["trade", ko.app.tabLiveTrading],
                  ["trades", ko.app.liveTradePfTabTradesDock],
                ] as const)
              : ([
                  ["summary", ko.app.liveTradePfTabSummary],
                  ["holdings", ko.app.liveTradePfTabHoldings],
                  ...(adminReadOnly
                    ? ([] as const)
                    : ([["trade", ko.app.liveTradePfTabTrade]] as const)),
                  ["trades", ko.app.liveTradePfTabTrades],
                  ...(adminReadOnly
                    ? ([] as const)
                    : ([["openOrders", ko.app.liveTradePfTabOpenOrders]] as const)),
                ] as const)
          ).map(([id, label]) => {
            const isView = viewTab === id;
            const isPinned = pinnedTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isPinned}
                className={[
                  "live-portfolio__tab",
                  isView && isPinned ? "live-portfolio__tab--active" : "",
                  isView && !isPinned ? "live-portfolio__tab--preview" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setHoverTab(id)}
                onFocus={() => setHoverTab(id)}
                onBlur={(e) => {
                  if (
                    !e.currentTarget.parentElement?.contains(
                      e.relatedTarget as Node | null,
                    )
                  ) {
                    setHoverTab(null);
                  }
                }}
                onClick={() => {
                  setPinnedTab(id);
                  setHoverTab(null);
                  if (selfOnly && (id === "trade" || id === "trades")) {
                    dispatchLiveTradePortfolioPanelTab(id);
                    if (id === "trades") {
                      openAccountTrades();
                    }
                  }
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {err ? (
          <p className="live-portfolio__banner live-portfolio__banner--err" role="alert">
            {err}
          </p>
        ) : null}

        {loading ? (
          <DockPanelCenterLoading label={ko.app.liveTradePfLoading} />
        ) : data ? (
          <div className="live-portfolio__body">
          <PortfolioHeroTiles
            holdings={data.holdings}
            summary={data.summary}
            usdKrwRate={usdKrwRate}
            roundTripForMarket={roundTripForMarket}
          />

          {viewTab === "summary" ? (
            <SummaryTiles
              holdings={data.holdings}
              summary={data.summary}
              usdKrwRate={usdKrwRate}
              updatedAtMs={data.updatedAtMs}
            />
          ) : null}

          {viewTab === "holdings" ? (
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
                    </tr>
                  </thead>
                  <tbody>
                    {data.holdings.map((h) => (
                      <HoldingRow
                        key={`${h.programId}:${h.market}:${h.symbol}`}
                        row={h}
                        onOpenHoldingChart={onOpenHoldingChart}
                        portfolioProgramId={resolvedProgramId}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )
          ) : null}

          {viewTab === "trade" ? (
            <LiveTradePortfolioTradeTab
              programs={programs}
              holdings={data.holdings}
              portfolioProgramId={resolvedProgramId}
              busy={busy}
              onTraded={(snap) => {
                setBusy(true);
                if (snap) onPortfolioAfterTrade(snap);
                else void load({ keepQuoteMerge: false }).finally(() => setBusy(false));
              }}
            />
          ) : null}

          {viewTab === "openOrders" ? (
            <LiveTradeOpenOrdersPanel
              onChanged={() => {
                void load({ keepQuoteMerge: false });
                notifyLiveTradeAuthChange();
              }}
            />
          ) : null}

          {viewTab === "trades" && !selfOnly ? (
            (() => {
              const sections = [
                {
                  id: "sim",
                  title: ko.app.liveTradeHistoryScenarioSim,
                  note: ko.app.liveTradeHistorySimSub,
                  rows: tradesByScenario.sim,
                },
                {
                  id: "live-bithumb",
                  title: ko.app.liveTradeHistoryScenarioBithumb,
                  note: ko.app.liveTradeHistoryBithumbSub,
                  rows: tradesByScenario.liveBithumb,
                },
                {
                  id: "live-toss",
                  title: ko.app.liveTradeHistoryScenarioToss,
                  note: ko.app.liveTradeHistoryTossSub,
                  rows: tradesByScenario.liveToss,
                },
              ];
              const anyRows =
                sections.some((s) => s.rows.length > 0) || simPrograms.length > 0;
              if (!anyRows) {
                return (
                  <p className="live-portfolio__muted">{ko.app.liveTradePfNoTrades}</p>
                );
              }
              return sections.map((section) =>
                section.id === "sim" ? (
                  simPrograms.length === 0 && section.rows.length === 0 ? null : (
                  <div
                    key={section.id}
                    className="live-portfolio__trades-scenario"
                  >
                    <h5 className="live-sim-run__sub">{section.title}</h5>
                    <p className="live-portfolio__exchange-note">{section.note}</p>
                    <LiveTradeHistorySimSection embedded loadAll programs={programs} />
                  </div>
                  )
                ) : section.rows.length === 0 ? null : (
                  <div
                    key={section.id}
                    className="live-portfolio__trades-scenario"
                  >
                    <h5 className="live-sim-run__sub">{section.title}</h5>
                    <p className="live-portfolio__exchange-note">{section.note}</p>
                    <div className="live-portfolio__trades-scroll live-sim-run__table-wrap">
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
                          {section.rows.map((t: LiveTradeRecord) => {
                            const fd = tradeFill.get(t.id);
                            const pnlUp =
                              fd?.realizedPnl != null
                                ? fd.realizedPnl >= 0
                                : null;
                            return (
                              <tr
                                key={t.id}
                                className={
                                  t.side === "buy"
                                    ? "live-sim-run__row--buy"
                                    : "live-sim-run__row--sell"
                                }
                              >
                                <td
                                  className="live-sim-run__ts"
                                  data-label={ko.app.liveTradePfColTime}
                                >
                                  {formatTs(t.atMs)}
                                </td>
                                <td
                                  className="live-sim-run__side"
                                  data-label={ko.app.liveTradePfColSide}
                                >
                                  {formatTradeSideLabel(t)}
                                </td>
                                <td data-label={ko.app.liveTradePfColSymbol}>
                                  <TradeSymbolCell t={t} />
                                </td>
                                <td
                                  className="live-sim-run__num"
                                  data-label={ko.app.liveTradePfColQty}
                                >
                                  {formatLiveTradeQuantity(
                                    t.quantity,
                                    t.market,
                                  )}
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
                                    ? formatSignedMoney(
                                        fd.realizedPnl,
                                        t.currency,
                                      )
                                    : "—"}
                                </td>
                                <td
                                  className="live-sim-run__num"
                                  data-label={ko.app.liveTradePfColAmount}
                                >
                                  {formatPrice(t.amount, t.currency)}
                                </td>
                                <td
                                  className="live-sim-run__num live-portfolio__prog"
                                  data-label={ko.app.liveTradePfColProgram}
                                >
                                  <span className="live-sim-run__sym">
                                    {t.programName ?? t.programId}
                                  </span>
                                  {t.note ? (
                                    <span
                                      className="live-sim-run__name"
                                      title={t.note}
                                    >
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
                  </div>
                ),
              );
            })()
          ) : null}

          {viewTab === "trades" && selfOnly ? (
            <p className="live-portfolio__dock-trades-hint" role="status">
              {ko.app.liveTradePfTradesDockHint}
            </p>
          ) : null}

          {data.updatedAtMs && viewTab !== "summary" ? (
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
