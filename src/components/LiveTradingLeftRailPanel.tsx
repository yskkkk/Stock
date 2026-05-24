import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLiveTradingPortfolio,
  type LiveTradeHolding,
  type LiveTradeProgram,
} from "../api";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { ko } from "../i18n/ko";
import { programDisplayStatus } from "../lib/liveProgramDisplay";
import { formatPercent, formatPrice } from "../lib/format";
import { openHoldingsReturnPct } from "../lib/livePortfolioPnl";
import { peekLiveTradingPrefetch } from "../lib/tabPrefetch";

const POLL_MS = 22_000;
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
}: {
  program: LiveTradeProgram;
  displayStatus: ReturnType<typeof programDisplayStatus>;
  returnPct: number | null;
  holdings: LiveTradeHolding[];
  orderMode: string | null;
  onOpenLiveTrading?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => sortHoldingsByValue(holdings), [holdings]);
  const up = returnPct != null && returnPct >= 0;
  const dotHoldings = sorted.slice(0, MAX_DOTS);
  const dotMore = sorted.length > MAX_DOTS ? sorted.length - MAX_DOTS : 0;
  const totalMarketValue = useMemo(
    () =>
      sorted.reduce(
        (s, h) => s + (h.marketValue != null && h.marketValue > 0 ? h.marketValue : 0),
        0,
      ),
    [sorted],
  );

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
            <div className="live-trade-rail__table-wrap">
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
                    const mv = h.marketValue ?? 0;
                    return (
                      <tr key={`${h.market}:${h.symbol}`}>
                        <td className="live-trade-rail__table-sym">{sym}</td>
                        <td
                          className={`live-trade-rail__table-chg live-trade-rail__table-chg--${tone}`}
                        >
                          {h.changePct == null ? "—" : formatPercent(h.changePct)}
                        </td>
                        <td className="live-trade-rail__table-val">
                          {formatRailValuation(h.marketValue, h.currency)}
                        </td>
                        <td className="live-trade-rail__table-wt">
                          {formatWeightPct(mv, totalMarketValue)}
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
                      {formatRailValuation(totalMarketValue, sorted[0]?.currency ?? "KRW")}
                    </td>
                    <td className="live-trade-rail__table-wt">
                      {totalMarketValue > 0 ? "100%" : "—"}
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
              {p.lastRunAtMs ? (
                <>
                  <span className="live-trade-rail__detail-sep"> · </span>
                  <span className="live-trade-rail__meta--ts">
                    {formatShortTs(p.lastRunAtMs)}
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

function LiveTradingLeftRailPanelInner({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading?: () => void;
}) {
  const prefetched = peekLiveTradingPrefetch();
  const status = useLiveTradingStatusPoll();
  const [holdingsByProgram, setHoldingsByProgram] = useState<
    Record<string, LiveTradeHolding[]>
  >({});
  const [loading, setLoading] = useState(!prefetched?.status);

  const reloadPortfolio = useCallback(async () => {
    try {
      const portfolio = await fetchLiveTradingPortfolio(null).catch(() => null);
      const map: Record<string, LiveTradeHolding[]> = {};
      for (const h of portfolio?.holdings ?? []) {
        const pid = String(h.programId ?? "").trim();
        if (!pid) continue;
        if (!map[pid]) map[pid] = [];
        map[pid].push(h);
      }
      setHoldingsByProgram(map);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadPortfolio();
    const id = window.setInterval(() => void reloadPortfolio(), POLL_MS);
    return () => window.clearInterval(id);
  }, [reloadPortfolio]);

  useEffect(() => {
    if (!status) return;
    void reloadPortfolio();
  }, [status?.armedCount, status?.simCount, reloadPortfolio]);

  const rows = useMemo(() => {
    const programs = status?.programs ?? [];
    return programs
      .filter(isRunningLiveProgram)
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
        const fromHoldings = openHoldingsReturnPct(holdings);
        return {
          program: p,
          displayStatus,
          returnPct: fromHoldings ?? ret?.totalReturnPct ?? null,
          holdingCount,
          holdings,
        };
      });
  }, [status, holdingsByProgram]);

  if (!loading && rows.length === 0) return null;

  const bithumbSim =
    status?.bithumbSimulatedOrders !== false &&
    status?.bithumb?.liveOrdersEnabled === false;

  return (
    <aside
      className="live-trade-rail live-trade-rail--side"
      role="complementary"
      aria-label={ko.app.liveTradeLeftRailAria}
    >
      <div className="live-trade-rail__head">
        <button
          type="button"
          className="live-trade-rail__title-btn"
          onClick={() => onOpenLiveTrading?.()}
          title={ko.app.liveTradeLeftRailOpen}
        >
          <span className="live-trade-rail__title">{ko.app.liveTradeLeftRailTitle}</span>
          {rows.length > 0 ? (
            <span className="live-trade-rail__count">{rows.length}</span>
          ) : null}
        </button>
        {loading ? (
          <span className="live-trade-rail__status">{ko.app.marketIndicesLoading}</span>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <ul className="live-trade-rail__list">
          {rows.map(({ program: p, displayStatus, returnPct, holdings }) => {
            const orderMode =
              displayStatus === "armed" && p.armedMarkets?.crypto && bithumbSim
                ? ko.app.liveTradeLeftRailSimOrders
                : displayStatus === "armed" && p.armedMarkets?.crypto
                  ? ko.app.liveTradeLeftRailLiveOrders
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
                />
              </li>
            );
          })}
        </ul>
      ) : loading ? (
        <ul className="live-trade-rail__list live-trade-rail__list--sk">
          <li className="live-trade-rail__card live-trade-rail__card--sk" />
          <li className="live-trade-rail__card live-trade-rail__card--sk" />
        </ul>
      ) : null}
    </aside>
  );
}

export default memo(LiveTradingLeftRailPanelInner);
