import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLiveTradingPortfolio,
  fetchLiveTradingStatus,
  type LiveTradeHolding,
  type LiveTradeProgram,
  type LiveTradingStatusResponse,
} from "../api";
import { ko } from "../i18n/ko";
import { programDisplayStatus } from "../lib/liveProgramDisplay";
import { formatPercent } from "../lib/format";
import { peekLiveTradingPrefetch } from "../lib/tabPrefetch";

const POLL_MS = 22_000;

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

/** 좁은 패널용 가격 축약 */
function formatRailPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Number(n);
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000) return `${Math.round(v / 10_000)}만`;
  if (v >= 1) return String(Math.round(v));
  return v.toFixed(4);
}

function pickPrimaryHolding(holdings: LiveTradeHolding[]): LiveTradeHolding | null {
  if (!holdings.length) return null;
  return holdings.reduce((best, h) => {
    const mv = h.marketValue ?? 0;
    const bestMv = best.marketValue ?? 0;
    return mv > bestMv ? h : best;
  }, holdings[0]);
}

function buildHoldingDetail(holdings: LiveTradeHolding[]) {
  if (!holdings.length) {
    return {
      symbols: ko.app.liveTradeLeftRailNoHolding,
      changeLabel: "—",
      pricesLabel: "—/—/—",
      changeUp: null as boolean | null,
    };
  }
  const symbols = holdings
    .map((h) => shortSymbol(h.symbol))
    .filter(Boolean)
    .slice(0, 3)
    .join(",");
  const more = holdings.length > 3 ? `+${holdings.length - 3}` : "";
  const primary = pickPrimaryHolding(holdings);
  const pct = primary?.changePct ?? null;
  const changeUp = pct != null && pct >= 0;
  const pricesLabel = primary
    ? `${formatRailPrice(primary.avgEntryPrice)}/${formatRailPrice(primary.targetSellPrice)}/${formatRailPrice(primary.stopLossPrice)}`
    : "—/—/—";
  return {
    symbols: more ? `${symbols}${more}` : symbols,
    changeLabel: pct == null ? "—" : formatPercent(pct),
    pricesLabel,
    changeUp: pct == null ? null : changeUp,
  };
}

function isArmedLiveProgram(p: LiveTradeProgram): boolean {
  return p.status === "armed";
}

function LiveTradingLeftRailPanelInner({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading?: () => void;
}) {
  const prefetched = peekLiveTradingPrefetch();
  const [status, setStatus] = useState<LiveTradingStatusResponse | null>(
    prefetched?.status ?? null,
  );
  const [holdingsByProgram, setHoldingsByProgram] = useState<
    Record<string, LiveTradeHolding[]>
  >({});
  const [loading, setLoading] = useState(!prefetched?.status);

  const reload = useCallback(async () => {
    try {
      const [next, portfolio] = await Promise.all([
        fetchLiveTradingStatus(),
        fetchLiveTradingPortfolio(null).catch(() => null),
      ]);
      setStatus(next);
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
    void reload();
    const id = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  const rows = useMemo(() => {
    const programs = status?.programs ?? [];
    return programs
      .filter(isArmedLiveProgram)
      .sort((a, b) => a.name.localeCompare(b.name, "ko"))
      .map((p) => {
        const ret = status?.programReturns?.[p.id];
        const holdingCount = ret?.holdingCount ?? 0;
        const displayStatus = programDisplayStatus(p, holdingCount);
        const holdings = holdingsByProgram[p.id] ?? [];
        return {
          program: p,
          displayStatus,
          returnPct: ret?.totalReturnPct ?? null,
          holdingCount,
          detail: buildHoldingDetail(holdings),
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
          {rows.map(({ program: p, displayStatus, returnPct, detail }) => {
            const up = returnPct != null && returnPct >= 0;
            const orderMode =
              displayStatus === "armed" && p.armedMarkets?.crypto && bithumbSim
                ? ko.app.liveTradeLeftRailSimOrders
                : displayStatus === "armed" && p.armedMarkets?.crypto
                  ? ko.app.liveTradeLeftRailLiveOrders
                  : null;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`live-trade-rail__item live-trade-rail__item--${displayStatus}`}
                  onClick={() => onOpenLiveTrading?.()}
                >
                  <span className="live-trade-rail__row live-trade-rail__row--head">
                    <span className="live-trade-rail__name" title={p.name}>
                      {p.name}
                    </span>
                    <span
                      className={`live-trade-rail__badge live-trade-rail__badge--${displayStatus}`}
                    >
                      {statusLabel(displayStatus)}
                    </span>
                  </span>
                  <span className="live-trade-rail__row">
                    <span className="live-trade-rail__meta">
                      {armedLaneLabel(p)}
                      {orderMode ? ` · ${orderMode}` : ""}
                    </span>
                    <span
                      className={
                        returnPct == null
                          ? "live-trade-rail__ret live-trade-rail__ret--muted"
                          : up
                            ? "live-trade-rail__ret live-trade-rail__ret--up"
                            : "live-trade-rail__ret live-trade-rail__ret--down"
                      }
                    >
                      {returnPct == null ? "—" : formatPercent(returnPct)}
                    </span>
                  </span>
                  <p className="live-trade-rail__detail" title={detail.symbols}>
                    <span>{ko.app.liveTradeLeftRailHoldingsShort}</span> {detail.symbols}
                    <span className="live-trade-rail__detail-sep">·</span>
                    <span>{ko.app.liveTradeLeftRailChgShort}</span>{" "}
                    <span
                      className={
                        detail.changeUp == null
                          ? ""
                          : detail.changeUp
                            ? "live-trade-rail__detail-pct--up"
                            : "live-trade-rail__detail-pct--down"
                      }
                    >
                      {detail.changeLabel}
                    </span>
                    <span className="live-trade-rail__detail-sep">·</span>
                    <span>{ko.app.liveTradeLeftRailBuySellShort}</span>{" "}
                    {detail.pricesLabel}
                  </p>
                  <span className="live-trade-rail__row live-trade-rail__row--foot">
                    <span className="live-trade-rail__meta">
                      {ko.app.liveTradeMinScoreShort}{" "}
                      {Math.round(p.minScoreRatio * 100)}%
                    </span>
                    {p.lastRunAtMs ? (
                      <span className="live-trade-rail__meta live-trade-rail__meta--ts">
                        {formatShortTs(p.lastRunAtMs)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : loading ? (
        <ul className="live-trade-rail__list live-trade-rail__list--sk">
          <li className="live-trade-rail__item live-trade-rail__item--sk" />
          <li className="live-trade-rail__item live-trade-rail__item--sk" />
        </ul>
      ) : null}
    </aside>
  );
}

export default memo(LiveTradingLeftRailPanelInner);
