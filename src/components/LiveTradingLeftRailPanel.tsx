import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNestedVerticalScroll } from "../hooks/useNestedVerticalScroll";
import {
  fetchLiveTradingMinuteQuotes,
  fetchLiveTradingPortfolio,
  type LiveTradeHolding,
  type LiveTradePortfolioResponse,
  type LiveTradeProgram,
} from "../api";
import { useLivePortfolioQuotePoll } from "../hooks/useLivePortfolioQuotePoll";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { ko } from "../i18n/ko";
import { programDisplayStatus } from "../lib/liveProgramDisplay";
import { formatPercent, formatPrice } from "../lib/format";
import { openHoldingsNetReturnPct, summarizeHoldingsPnl, summarizeNetMarketByCurrency, holdingNetMarketValue, formatInvestedOrMarketLabel } from "../lib/livePortfolioPnl";
import { mergeLiveQuotesIntoPortfolio } from "../lib/livePortfolioLiveQuotes";
import { feeByMarketFromStatus } from "../lib/liveTradeFeeByMarket";
import { DEFAULT_ROUND_TRIP_FEE_RATE } from "../lib/netReturn";
import type { LiveTradeMarket } from "../types";
import { peekLiveTradingPrefetch } from "../lib/tabPrefetch";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";

/** 좌측 실매매 카드 — 보유·수익률 갱신 */
const POLL_MS = 500;
const MAX_DOTS = 8;

function statusLabel(status: LiveTradeProgram["status"]): string {
  switch (status) {
    case "armed":
      return ko.app.liveTradeStatusArmed;
    case "sim":
      return ko.app.liveTradeStatusSim;
    case "error":
      return ko.app.liveTradeStatusError;
    default:
      return status;
  }
}

function armedLaneLabel(p: LiveTradeProgram): string {
  const c = Boolean(p.armedMarkets?.crypto);
  const k = Boolean(p.armedMarkets?.kr);
  if (c && k) return ko.app.liveTradeLeftRailLaneBoth;
  if (c) return ko.app.liveTradeLeftRailLaneBithumb;
  if (k) return ko.app.liveTradeLeftRailLaneToss;
  if (p.markets.crypto && !p.markets.kr) return ko.app.liveTradeLeftRailLaneBithumb;
  if (p.markets.kr && !p.markets.crypto) return ko.app.liveTradeLeftRailLaneToss;
  return ko.app.liveTradeLeftRailLaneLive;
}

function formatShortTs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function shortSymbol(symbol: string): string {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/-USDT$/i, "")
    .slice(0, 8);
}

function formatRailValuation(
  mv: number | null | undefined,
  currency: string,
): string {
  if (mv == null || !Number.isFinite(mv) || mv <= 0) return "—";
  return formatPrice(mv, currency === "KRW" ? "KRW" : currency);
}

function formatRailNetValuation(
  h: LiveTradeHolding,
  roundTripForMarket: (market: LiveTradeMarket) => number,
): string {
  const net = holdingNetMarketValue(h, roundTripForMarket(h.market));
  return formatRailValuation(net, h.currency);
}

function formatWeightPct(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function holdingChangeTone(
  pct: number | null | undefined,
): "up" | "down" | "flat" {
  if (pct == null || !Number.isFinite(pct)) return "flat";
  if (pct > 0) return "up";
  if (pct < 0) return "down";
  return "flat";
}

function sortHoldingsByValue(holdings: LiveTradeHolding[]): LiveTradeHolding[] {
  return [...holdings].sort(
    (a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0),
  );
}

function isRunningLiveProgram(p: LiveTradeProgram): boolean {
  return p.status === "armed" || p.status === "sim";
}

function RailProgramCard({
  program: p,
  displayStatus,
  returnPct,
  holdings,
  orderMode,
  onOpenLiveTrading,
  roundTripForMarket,
  dataUpdatedAtMs,
}: {
  program: LiveTradeProgram;
  displayStatus: ReturnType<typeof programDisplayStatus>;
  returnPct: number | null;
  holdings: LiveTradeHolding[];
  orderMode: string | null;
  onOpenLiveTrading?: () => void;
  roundTripForMarket: (market: LiveTradeMarket) => number;
  /** 보유·시세가 마지막으로 반영된 시각 */
  dataUpdatedAtMs: number | null;
}) {
  const [open, setOpen] = useState(false);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => sortHoldingsByValue(holdings), [holdings]);
  useNestedVerticalScroll(
    tableWrapRef,
    open && sorted.length > 0,
    "live-trade-rail__table-wrap--dragging",
  );
  const up = returnPct != null && returnPct >= 0;
  const dotHoldings = sorted.slice(0, MAX_DOTS);
  const dotMore = sorted.length > MAX_DOTS ? sorted.length - MAX_DOTS : 0;
  const totalNetMarketValue = useMemo(
    () =>
      sorted.reduce((s, h) => {
        const net = holdingNetMarketValue(h, roundTripForMarket(h.market));
        return s + (net != null && net > 0 ? net : 0);
      }, 0),
    [sorted, roundTripForMarket],
  );
  const pnlAgg = useMemo(() => summarizeHoldingsPnl(sorted), [sorted]);
  const netMarketByCurrency = useMemo(
    () => summarizeNetMarketByCurrency(sorted, roundTripForMarket),
    [sorted, roundTripForMarket],
  );
  const investedLabel = formatInvestedOrMarketLabel(
    pnlAgg.investedByCurrency,
    null,
  );
  const evalLabel = formatInvestedOrMarketLabel(netMarketByCurrency, null);

  return (
    <article
      className={`live-trade-rail__card live-trade-rail__card--${displayStatus}${open ? " live-trade-rail__card--open" : ""}`}
    >
      <button
        type="button"
        className="live-trade-rail__summary"
        aria-expanded={open}
        aria-label={
          open
            ? `${p.name} ${ko.app.liveTradeLeftRailCollapse}`
            : `${p.name} ${ko.app.liveTradeLeftRailExpand}`
        }
        onClick={() => setOpen((v) => !v)}
      >
        <span className="live-trade-rail__summary-top">
          <span className="live-trade-rail__name" title={p.name}>
            {p.name}
          </span>
          <span className="live-trade-rail__summary-top-end">
            <span
              className={`live-trade-rail__badge live-trade-rail__badge--${displayStatus}`}
            >
              {statusLabel(displayStatus)}
            </span>
            <span className="live-trade-rail__chevron" aria-hidden>
              {open ? "▾" : "▴"}
            </span>
          </span>
        </span>
        <span className="live-trade-rail__summary-hero">
          <span className="live-trade-rail__summary-hero-k">
            {ko.app.liveTradeLeftRailTotalReturn}
          </span>
          <span
            className={
              returnPct == null
                ? "live-trade-rail__ret live-trade-rail__ret--hero live-trade-rail__ret--muted"
                : up
                  ? "live-trade-rail__ret live-trade-rail__ret--hero live-trade-rail__ret--up"
                  : "live-trade-rail__ret live-trade-rail__ret--hero live-trade-rail__ret--down"
            }
          >
            {returnPct == null ? "—" : formatPercent(returnPct)}
          </span>
        </span>
        <span className="live-trade-rail__summary-metrics">
          <span className="live-trade-rail__summary-metric">
            <span className="live-trade-rail__summary-metric-k">
              {ko.app.liveTradeLeftRailTotalInvested}
            </span>
            <span className="live-trade-rail__summary-metric-v">{investedLabel}</span>
          </span>
          <span className="live-trade-rail__summary-metric">
            <span className="live-trade-rail__summary-metric-k">
              {ko.app.liveTradeLeftRailTotalEval}
            </span>
            <span className="live-trade-rail__summary-metric-v">{evalLabel}</span>
          </span>
        </span>
        <span
          className="live-trade-rail__dots"
          aria-label={`${ko.app.liveTradeLeftRailHoldings} ${sorted.length}`}
        >
          {sorted.length === 0 ? (
            <span className="live-trade-rail__dot live-trade-rail__dot--empty" />
          ) : (
            dotHoldings.map((h) => {
              const sym = shortSymbol(h.symbol);
              const tone = holdingChangeTone(h.changePct);
              return (
                <span
                  key={`${h.market}:${h.symbol}`}
                  className={`live-trade-rail__dot live-trade-rail__dot--${tone}`}
                  title={`${sym} ${h.changePct == null ? "—" : formatPercent(h.changePct)}`}
                >
                  {sym.slice(0, 1)}
                </span>
              );
            })
          )}
          {dotMore > 0 ? (
            <span className="live-trade-rail__dot-more">+{dotMore}</span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="live-trade-rail__expand">
          {sorted.length === 0 ? (
            <p className="live-trade-rail__empty-hold">
              {ko.app.liveTradeLeftRailNoHolding}
            </p>
          ) : (
            <div ref={tableWrapRef} className="live-trade-rail__table-wrap">
              <table className="live-trade-rail__table">
                <thead>
                  <tr>
                    <th scope="col">{ko.app.liveTradeLeftRailColCoin}</th>
                    <th scope="col">{ko.app.liveTradeLeftRailColReturn}</th>
                    <th scope="col">{ko.app.liveTradeLeftRailColValue}</th>
                    <th scope="col">{ko.app.liveTradeLeftRailColWeight}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((h) => {
                    const sym = shortSymbol(h.symbol);
                    const tone = holdingChangeTone(h.changePct);
                    const mv =
                      holdingNetMarketValue(h, roundTripForMarket(h.market)) ?? 0;
                    return (
                      <tr key={`${h.market}:${h.symbol}`}>
                        <td className="live-trade-rail__table-sym">{sym}</td>
                        <td
                          className={`live-trade-rail__table-chg live-trade-rail__table-chg--${tone}`}
                        >
                          {h.changePct == null ? "—" : formatPercent(h.changePct)}
                        </td>
                        <td className="live-trade-rail__table-val">
                          {formatRailNetValuation(h, roundTripForMarket)}
                        </td>
                        <td className="live-trade-rail__table-wt">
                          {formatWeightPct(mv, totalNetMarketValue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="live-trade-rail__table-total">
                    <th scope="row">{ko.app.liveTradeLeftRailTotal}</th>
                    <td
                      className={
                        returnPct == null
                          ? ""
                          : up
                            ? "live-trade-rail__table-chg--up"
                            : "live-trade-rail__table-chg--down"
                      }
                    >
                      {returnPct == null ? "—" : formatPercent(returnPct)}
                    </td>
                    <td className="live-trade-rail__table-val">
                      {formatRailValuation(
                        totalNetMarketValue,
                        sorted[0]?.currency ?? "KRW",
                      )}
                    </td>
                    <td className="live-trade-rail__table-wt">
                      {totalNetMarketValue > 0 ? "100%" : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <div className="live-trade-rail__expand-foot">
            <span className="live-trade-rail__meta">
              {armedLaneLabel(p)}
              {orderMode ? ` · ${orderMode}` : ""}
              <span className="live-trade-rail__detail-sep"> · </span>
              {ko.app.liveTradeMinScoreShort}{" "}
              {Math.round(p.minScoreRatio * 100)}%
              {dataUpdatedAtMs != null ? (
                <>
                  <span className="live-trade-rail__detail-sep"> · </span>
                  <span
                    className="live-trade-rail__meta--ts"
                    title={ko.app.liveTradePfUpdated}
                  >
                    {formatShortTs(dataUpdatedAtMs)}
                  </span>
                </>
              ) : null}
            </span>
            {onOpenLiveTrading ? (
              <button
                type="button"
                className="live-trade-rail__open-tab"
                onClick={() => onOpenLiveTrading()}
              >
                {ko.app.liveTradeLeftRailOpen}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function LiveTradingRailCore({
  onOpenLiveTrading,
  layout = "rail-aside",
  showWhenEmpty = false,
}: {
  onOpenLiveTrading?: () => void;
  layout?: "rail-aside" | "dock";
  /** 우측 도크 — 프로그램 없을 때도 안내 문구 표시 */
  showWhenEmpty?: boolean;
}) {
  const prefetched = peekLiveTradingPrefetch();
  const { user, authChecked } = useLiveTradeAuth();
  const status = useLiveTradingStatusPoll();
  const statusPending = Boolean(user && authChecked && status == null);
  const [portfolio, setPortfolio] = useState<LiveTradePortfolioResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(!prefetched?.status);

  const feeByMarket = useMemo(
    () => feeByMarketFromStatus(status?.feeRates),
    [status?.feeRates],
  );

  const reloadPortfolio = useCallback(async () => {
    if (!user) {
      setPortfolio(null);
      setLoading(false);
      return;
    }
    try {
      let snap = await fetchLiveTradingPortfolio(null).catch(() => null);
      if (snap) {
        const syms = [
          ...new Set(
            snap.holdings
              .map((h) => h.symbol.trim().toUpperCase())
              .filter(Boolean),
          ),
        ];
        if (syms.length > 0) {
          try {
            const q = await fetchLiveTradingMinuteQuotes(syms);
            snap = mergeLiveQuotesIntoPortfolio(snap, q.quotes ?? {}, feeByMarket);
          } catch {
            /* 서버 스냅샷만 사용 */
          }
        }
        setPortfolio(snap);
      } else {
        setPortfolio(null);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [user, feeByMarket]);

  useEffect(() => {
    if (statusPending) {
      setLoading(true);
      return;
    }
    void reloadPortfolio();
    const id = window.setInterval(() => void reloadPortfolio(), POLL_MS);
    return () => window.clearInterval(id);
  }, [reloadPortfolio, statusPending]);

  useEffect(() => {
    if (!status) return;
    void reloadPortfolio();
  }, [status?.armedCount, status?.simCount, reloadPortfolio, status]);

  const holdingsByProgram = useMemo(() => {
    const map: Record<string, LiveTradeHolding[]> = {};
    for (const h of portfolio?.holdings ?? []) {
      const pid = String(h.programId ?? "").trim();
      if (!pid) continue;
      if (!map[pid]) map[pid] = [];
      map[pid].push(h);
    }
    return map;
  }, [portfolio?.holdings]);

  const dataUpdatedAtMs = portfolio?.updatedAtMs ?? null;

  useLivePortfolioQuotePoll(
    portfolio,
    setPortfolio,
    Boolean(user) && (status?.armedCount ?? 0) + (status?.simCount ?? 0) > 0,
    feeByMarket,
    POLL_MS,
  );

  const roundTripForMarket = useCallback(
    (market: LiveTradeMarket) =>
      feeByMarket[market] ?? feeByMarket.default ?? DEFAULT_ROUND_TRIP_FEE_RATE,
    [feeByMarket],
  );

  const rows = useMemo(() => {
    const programs = status?.programs ?? [];
    const visible =
      layout === "dock" ? programs : programs.filter(isRunningLiveProgram);
    return visible
      .sort((a, b) => {
        const rank = (s: LiveTradeProgram["status"]) =>
          s === "armed" ? 0 : s === "sim" ? 1 : 2;
        const d = rank(a.status) - rank(b.status);
        return d !== 0 ? d : a.name.localeCompare(b.name, "ko");
      })
      .map((p) => {
        const ret = status?.programReturns?.[p.id];
        const holdingCount = ret?.holdingCount ?? 0;
        const displayStatus = programDisplayStatus(p, holdingCount);
        const holdings = holdingsByProgram[p.id] ?? [];
        const fromHoldings = openHoldingsNetReturnPct(
          holdings,
          roundTripForMarket,
        );
        return {
          program: p,
          displayStatus,
          returnPct: fromHoldings ?? ret?.totalReturnPct ?? null,
          holdingCount,
          holdings,
        };
      });
  }, [status, holdingsByProgram, roundTripForMarket, layout]);

  if (!authChecked) {
    return layout === "dock" ? (
      <div className="app-dock-rail-panel app-dock-rail-panel--live app-dock-rail-panel--pending">
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
      </div>
    ) : null;
  }

  if (!user) return null;

  if (!loading && rows.length === 0 && !showWhenEmpty) return null;

  const panelBusy = statusPending || loading;

  const head = (
    <div className="live-trade-rail__head">
      <button
        type="button"
        className="live-trade-rail__title-btn"
        onClick={() => onOpenLiveTrading?.()}
        title={layout === "rail-aside" ? ko.app.liveTradeLeftRailOpen : undefined}
      >
        <span className="live-trade-rail__title">{ko.app.liveTradeLeftRailTitle}</span>
        {rows.length > 0 ? (
          <span className="live-trade-rail__count">{rows.length}</span>
        ) : null}
      </button>
    </div>
  );

  const list =
    panelBusy ? (
      <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
    ) : rows.length > 0 ? (
      <ul className="live-trade-rail__list">
        {rows.map(({ program: p, displayStatus, returnPct, holdings }) => {
          const orderMode =
            displayStatus === "armed" && p.armedMarkets?.crypto
              ? ko.app.liveTradeLeftRailLiveOrders
              : displayStatus === "sim"
                ? ko.app.liveTradeLeftRailSimOrders
                : null;
          return (
            <li key={p.id}>
              <RailProgramCard
                program={p}
                displayStatus={displayStatus}
                returnPct={returnPct}
                holdings={holdings}
                orderMode={orderMode}
                onOpenLiveTrading={onOpenLiveTrading}
                roundTripForMarket={roundTripForMarket}
                dataUpdatedAtMs={dataUpdatedAtMs}
              />
            </li>
          );
        })}
      </ul>
    ) : showWhenEmpty ? (
      <p className="live-trade-rail__empty-hint">{ko.app.liveTradeLeftRailEmpty}</p>
    ) : null;

  if (layout === "dock") {
    return (
      <div
        className={`app-dock-rail-panel app-dock-rail-panel--live${
          panelBusy ? " app-dock-rail-panel--pending" : ""
        }`}
      >
        {head}
        {list}
      </div>
    );
  }

  return (
    <aside
      className="live-trade-rail live-trade-rail--side"
      role="complementary"
      aria-label={ko.app.liveTradeLeftRailAria}
    >
      {head}
      {list}
    </aside>
  );
}

function LiveTradingLeftRailPanelInner({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading?: () => void;
}) {
  return (
    <LiveTradingRailCore onOpenLiveTrading={onOpenLiveTrading} layout="rail-aside" />
  );
}

export default memo(LiveTradingLeftRailPanelInner);
