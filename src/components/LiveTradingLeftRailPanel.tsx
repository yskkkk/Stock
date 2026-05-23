import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLiveTradingStatus,
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

function isActiveProgram(p: LiveTradeProgram): boolean {
  return p.status === "armed" || p.status === "sim";
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
  const [loading, setLoading] = useState(!prefetched?.status);

  const reload = useCallback(async () => {
    try {
      const next = await fetchLiveTradingStatus();
      setStatus(next);
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
      .filter(isActiveProgram)
      .sort((a, b) => {
        const rank = (p: LiveTradeProgram) =>
          p.status === "armed" ? 0 : p.status === "sim" ? 1 : 2;
        const d = rank(a) - rank(b);
        if (d !== 0) return d;
        return a.name.localeCompare(b.name, "ko");
      })
      .map((p) => {
        const ret = status?.programReturns?.[p.id];
        const holdingCount = ret?.holdingCount ?? 0;
        const displayStatus = programDisplayStatus(p, holdingCount);
        return {
          program: p,
          displayStatus,
          returnPct: ret?.totalReturnPct ?? null,
          holdingCount,
        };
      });
  }, [status]);

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
          {rows.map(({ program: p, displayStatus, returnPct, holdingCount }) => {
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
                      {displayStatus === "armed" ? armedLaneLabel(p) : ko.app.liveTradeSimTag}
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
                  <span className="live-trade-rail__row live-trade-rail__row--foot">
                    <span className="live-trade-rail__meta">
                      {ko.app.liveTradeLeftRailHoldings} {holdingCount}
                      {" · "}
                      {ko.app.liveTradeMinScoreShort}{" "}
                      {Math.round(p.minScoreRatio * 100)}%
                    </span>
                    {p.lastRunAtMs ? (
                      <span className="live-trade-rail__meta live-trade-rail__meta--ts">
                        {formatShortTs(p.lastRunAtMs)}
                      </span>
                    ) : null}
                  </span>
                  {p.lastError?.trim() && displayStatus === "error" ? (
                    <span className="live-trade-rail__err" title={p.lastError}>
                      {p.lastError.trim().slice(0, 48)}
                    </span>
                  ) : null}
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
