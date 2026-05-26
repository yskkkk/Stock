import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAccessAdminLiveTradingTradeHistory,
  fetchLiveTradingTradeHistory,
  getStoredAccessAdminToken,
  type LiveTradeRecord,
} from "../api";
import {
  formatLiveTradeQuantity,
  formatPercent,
  formatPrice,
  formatSignedMoney,
} from "../lib/format";
import { tradeFillDisplayByTradeId } from "../lib/liveTradeBuySellPrices";
import { formatTradeSideLabel } from "../lib/liveTradeSideDisplay";
import { liveTradeRecordMatchesExchange } from "../lib/liveTradeTradesExchangeFilter";
import { programTradesPnlSummary } from "../lib/programTradesPnlSummary";
import {
  liveTradeHistoryScenarioSub,
} from "./LiveTradeHistoryScenarioTabs";
import type { LiveTradeHistoryScenario } from "../lib/liveTradeHistoryScenario";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";
import { ko } from "../i18n/ko";
import { LiveTradeSymbolCellFromRecord } from "./LiveTradeSymbolCell";

function formatTs(ms: number, withYear = false): string {
  if (!Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      year: withYear ? "numeric" : undefined,
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

function mergeTrades(
  prev: LiveTradeRecord[],
  incoming: LiveTradeRecord[],
  append: boolean,
): LiveTradeRecord[] {
  if (!append) return incoming;
  const seen = new Set(prev.map((t) => t.id));
  const add = incoming.filter((t) => !seen.has(t.id));
  return [...prev, ...add];
}

export function LiveTradeTradesHistoryTable({
  trades,
  loadAll,
  hideProgramColumn,
}: {
  trades: LiveTradeRecord[];
  loadAll: boolean;
  hideProgramColumn?: boolean;
}) {
  const tradeFill = useMemo(
    () => tradeFillDisplayByTradeId(trades),
    [trades],
  );
  const nameBySymbol = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of trades) {
      const nm = String(t.name ?? "").trim();
      if (nm) m.set(t.symbol.toUpperCase(), nm);
    }
    return m;
  }, [trades]);

  return (
    <div className="live-sim-run__table-wrap">
      <table className="live-sim-run__table live-sim-run__table--stacked live-sim-run__table--trades live-trade-history__table">
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
            {hideProgramColumn ? null : (
              <th>{ko.app.liveTradePfColProgram}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const fd = tradeFill.get(t.id);
            const pnlUp =
              fd?.realizedPnl != null ? fd.realizedPnl >= 0 : null;
            const rowProgramName =
              String(
                (t as LiveTradeRecord & { programName?: string }).programName ??
                  "",
              ).trim() || t.programId;
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
                  {formatTs(t.atMs, loadAll)}
                </td>
                <td
                  className="live-sim-run__side"
                  data-label={ko.app.liveTradePfColSide}
                >
                  {formatTradeSideLabel(t)}
                </td>
                <td data-label={ko.app.liveTradePfColSymbol}>
                  <LiveTradeSymbolCellFromRecord
                    t={{
                      ...t,
                      name:
                        nameBySymbol.get(t.symbol.toUpperCase()) ?? t.name,
                    }}
                  />
                </td>
                <td
                  className="live-sim-run__num"
                  data-label={ko.app.liveTradePfColQty}
                >
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
                <td
                  className="live-sim-run__num"
                  data-label={ko.app.liveTradePfColAmount}
                >
                  {formatPrice(t.amount, t.currency)}
                </td>
                {hideProgramColumn ? null : (
                  <td
                    className="live-portfolio__prog"
                    data-label={ko.app.liveTradePfColProgram}
                  >
                    {rowProgramName}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function LiveTradeTradesHistoryPanel({
  adminViewUserId = null,
  embedded = false,
  workspaceMode = false,
  programId = null,
  programName = null,
  programReturnPct = null,
  exchange = null,
  scenario = null,
  loadAll: loadAllProp,
}: {
  adminViewUserId?: string | null;
  /** 도크 «등록 프로그램» 패널 안에 삽입 */
  embedded?: boolean;
  /** 본문 워크스페이스(차트 영역) 전체 높이 */
  workspaceMode?: boolean;
  /** 지정 시 해당 프로그램 체결만 */
  programId?: string | null;
  programName?: string | null;
  /** 상태 API programReturns.totalReturnPct (시뮬·프로그램별) */
  programReturnPct?: number | null;
  /** 토스(kr·us) / 빗썸(crypto) — scenario 없을 때만 */
  exchange?: LiveTradeTradesExchange | null;
  /** 시뮬 / 빗썸 실매매 / 토스 실매매 (우선) */
  scenario?: LiveTradeHistoryScenario | null;
  /** true면 전체 일자·최신순(거래소 필터와 함께 사용) */
  loadAll?: boolean;
}) {
  const loadAll =
    loadAllProp ??
    (embedded ||
      Boolean(programId?.trim()) ||
      Boolean(exchange) ||
      Boolean(scenario));
  const [trades, setTrades] = useState<LiveTradeRecord[]>([]);
  const [nextOlderEndDay, setNextOlderEndDay] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(
    async (endDay: string | null, append: boolean) => {
      const adminId = adminViewUserId?.trim() || null;
      if (append) {
        setLoadingMore(true);
        loadingMoreRef.current = true;
      } else {
        setLoading(true);
      }
      try {
        const pid = programId?.trim() || undefined;
        const fetchOpts = loadAll
          ? {
              all: true as const,
              programId: pid,
              scenario: scenario ?? undefined,
              exchange: scenario ? undefined : (exchange ?? undefined),
            }
          : {
              endDay: endDay ?? undefined,
              days: 1,
              programId: pid,
              scenario: scenario ?? undefined,
              exchange: scenario ? undefined : (exchange ?? undefined),
            };
        const data = adminId
          ? await fetchAccessAdminLiveTradingTradeHistory(
              getStoredAccessAdminToken(),
              adminId,
              fetchOpts,
            )
          : await fetchLiveTradingTradeHistory(fetchOpts);
        setTrades((prev) =>
          loadAll ? data.trades : mergeTrades(prev, data.trades, append),
        );
        setHasOlder(data.hasOlder);
        setNextOlderEndDay(data.nextOlderEndDay);
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [adminViewUserId, loadAll, programId, exchange, scenario],
  );

  useEffect(() => {
    setTrades([]);
    setNextOlderEndDay(null);
    setHasOlder(false);
    void fetchPage(null, false);
  }, [fetchPage]);

  useEffect(() => {
    if (loadAll) return;
    const el = sentinelRef.current;
    if (!el || !hasOlder || !nextOlderEndDay) return;
    const root = el.closest(".live-trade-history__scroll");
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        void fetchPage(nextOlderEndDay, true);
      },
      { root: root ?? null, rootMargin: "120px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasOlder, nextOlderEndDay, fetchPage, loadAll]);

  const filteredTrades = useMemo(() => {
    if (scenario || loadAll) return trades;
    if (!exchange) return trades;
    return trades.filter((t) => liveTradeRecordMatchesExchange(t, exchange));
  }, [trades, exchange, loadAll, scenario]);

  const pnlSummary = useMemo(
    () =>
      String(programId ?? "").trim()
        ? programTradesPnlSummary(filteredTrades)
        : null,
    [programId, filteredTrades],
  );

  const displayReturnPct =
    programReturnPct != null && Number.isFinite(programReturnPct)
      ? programReturnPct
      : pnlSummary?.totalReturnPct ?? null;
  const returnUp = displayReturnPct != null && displayReturnPct >= 0;

  const scenarioTitle = scenario
    ? scenario === "sim"
      ? ko.app.liveTradeHistoryScenarioSim
      : scenario === "live-bithumb"
        ? ko.app.liveTradeHistoryScenarioBithumb
        : ko.app.liveTradeHistoryScenarioToss
    : null;

  const exchangeTitle =
    exchange === "toss"
      ? ko.app.liveTradeTossShort
      : exchange === "bithumb"
        ? ko.app.liveTradeBithumbShort
        : null;

  const subNote = scenario ? liveTradeHistoryScenarioSub(scenario) : null;

  return (
    <section
      className={[
        "live-trade-history",
        embedded ? "live-trade-history--embedded" : "",
        workspaceMode ? "live-trade-history--workspace" : "",
        !embedded && !workspaceMode ? "card" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby={
        workspaceMode ? undefined : "live-trade-history-title"
      }
    >
      {workspaceMode && programName?.trim() ? (
        <header className="live-trade-history__head live-trade-history__head--workspace-program">
          <h3 className="live-trade-history__title">
            {programName.trim()} · {ko.app.liveTradePfTabTrades}
          </h3>
          {subNote ? (
            <p className="live-trade-history__sub">{subNote}</p>
          ) : null}
        </header>
      ) : null}

      {!workspaceMode ? (
      <header className="live-trade-history__head">
        <h3 id="live-trade-history-title" className="live-trade-history__title">
          {programName?.trim()
            ? `${programName.trim()} · ${ko.app.liveTradePfTabTrades}`
            : scenarioTitle
              ? `${scenarioTitle} · ${ko.app.liveTradePfTabTrades}`
              : exchangeTitle
                ? `${exchangeTitle} · ${ko.app.liveTradePfTabTrades}`
                : embedded
                  ? ko.app.liveTradePfTabTradesDock
                  : ko.app.liveTradeAllTradesTitle}
        </h3>
        <p className="live-trade-history__sub">
          {subNote ??
            (loadAll
              ? ko.app.liveTradeAllTradesDockSub
              : ko.app.liveTradeAllTradesSub)}
        </p>
      </header>
      ) : null}

      {err ? (
        <p className="live-trade-history__err" role="alert">
          {err}
        </p>
      ) : null}

      {loading && filteredTrades.length === 0 ? (
        <p className="live-trade-history__muted">
          {scenario === "live-bithumb"
            ? ko.app.liveTradeTradesFetching
            : ko.app.liveTradePfLoading}
        </p>
      ) : filteredTrades.length === 0 ? (
        <p className="live-trade-history__muted">
          {scenario
            ? ko.app.liveTradePfNoTrades
            : exchange
              ? ko.app.liveTradeTradesEmptyExchange
              : ko.app.liveTradePfNoTrades}
        </p>
      ) : (
        <div className="live-trade-history__scroll">
          {pnlSummary && filteredTrades.length > 0 ? (
            <div className="live-trade-history__pnl-summary" role="status">
              <div className="live-trade-history__pnl-row">
                <span className="live-trade-history__pnl-label">
                  {ko.app.liveTradeHistoryTotalReturn}
                </span>
                <span
                  className={
                    displayReturnPct == null
                      ? "live-trade-history__pnl-val"
                      : returnUp
                        ? "live-trade-history__pnl-val live-trade-history__pnl-val--up"
                        : "live-trade-history__pnl-val live-trade-history__pnl-val--down"
                  }
                >
                  {displayReturnPct == null
                    ? "—"
                    : formatPercent(displayReturnPct)}
                </span>
              </div>
              <div className="live-trade-history__pnl-row">
                <span className="live-trade-history__pnl-label">
                  {ko.app.liveTradePfColRealizedPnl}
                </span>
                <span
                  className={
                    pnlSummary.realizedPnl >= 0
                      ? "live-trade-history__pnl-val live-trade-history__pnl-val--up"
                      : "live-trade-history__pnl-val live-trade-history__pnl-val--down"
                  }
                >
                  {pnlSummary.realizedLabel}
                </span>
              </div>
            </div>
          ) : null}
          <LiveTradeTradesHistoryTable
            trades={filteredTrades}
            loadAll={loadAll}
            hideProgramColumn={Boolean(programId?.trim())}
          />
          {!loadAll && hasOlder && nextOlderEndDay ? (
            <div
              ref={sentinelRef}
              className="live-trade-history__sentinel"
              aria-hidden
            />
          ) : null}
          {!loadAll && loadingMore ? (
            <p className="live-trade-history__foot" aria-live="polite">
              {ko.app.liveTradeAllTradesLoadingMore}
            </p>
          ) : null}
          {loadAll && trades.length > 0 ? (
            <p className="live-trade-history__foot live-trade-history__foot--end">
              {ko.app.liveTradeAllTradesDockCount.replace(
                "{count}",
                String(trades.length),
              )}
            </p>
          ) : !loadAll && !hasOlder && trades.length > 0 ? (
            <p className="live-trade-history__foot live-trade-history__foot--end">
              {ko.app.liveTradeAllTradesEnd}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
