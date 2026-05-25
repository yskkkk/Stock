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

export default function LiveTradeTradesHistoryPanel({
  adminViewUserId = null,
  embedded = false,
  programId = null,
  programName = null,
}: {
  adminViewUserId?: string | null;
  /** 도크 «등록 프로그램» 패널 안에 삽입 */
  embedded?: boolean;
  /** 지정 시 해당 프로그램 체결만 */
  programId?: string | null;
  programName?: string | null;
}) {
  const loadAll = embedded || Boolean(programId?.trim());
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
          ? { all: true as const, programId: pid }
          : { endDay: endDay ?? undefined, days: 1, programId: pid };
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
    [adminViewUserId, loadAll, programId],
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

  const tradeFill = useMemo(() => tradeFillDisplayByTradeId(trades), [trades]);

  const nameBySymbol = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of trades) {
      const nm = String(t.name ?? "").trim();
      if (nm) m.set(t.symbol.toUpperCase(), nm);
    }
    return m;
  }, [trades]);

  return (
    <section
      className={
        embedded
          ? "live-trade-history live-trade-history--embedded"
          : "live-trade-history card"
      }
      aria-labelledby="live-trade-history-title"
    >
      <header className="live-trade-history__head">
        <h3 id="live-trade-history-title" className="live-trade-history__title">
          {programName?.trim()
            ? `${programName.trim()} · ${ko.app.liveTradePfTabTrades}`
            : embedded
              ? ko.app.liveTradePfTabTradesDock
              : ko.app.liveTradeAllTradesTitle}
        </h3>
        <p className="live-trade-history__sub">
          {loadAll ? ko.app.liveTradeAllTradesDockSub : ko.app.liveTradeAllTradesSub}
        </p>
      </header>

      {err ? (
        <p className="live-trade-history__err" role="alert">
          {err}
        </p>
      ) : null}

      {loading && trades.length === 0 ? (
        <p className="live-trade-history__muted">{ko.app.liveTradePfLoading}</p>
      ) : trades.length === 0 ? (
        <p className="live-trade-history__muted">{ko.app.liveTradePfNoTrades}</p>
      ) : (
        <div className="live-trade-history__scroll">
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
                  <th>{ko.app.liveTradePfColProgram}</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const fd = tradeFill.get(t.id);
                  const pnlUp =
                    fd?.realizedPnl != null ? fd.realizedPnl >= 0 : null;
                  const programName =
                    String(
                      (t as LiveTradeRecord & { programName?: string })
                        .programName ?? "",
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
                              nameBySymbol.get(t.symbol.toUpperCase()) ??
                              t.name,
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
                      <td
                        className="live-portfolio__prog"
                        data-label={ko.app.liveTradePfColProgram}
                      >
                        {programName}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
