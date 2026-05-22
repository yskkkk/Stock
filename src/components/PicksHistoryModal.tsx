import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchPicksDailyHistory,
  fetchPicksDailyHistoryQuotes,
  type PicksDailyHistoryQuotesMap,
} from "../api";
import { peekPicksDailyHistoryPrefetch } from "../lib/tabPrefetch";
import {
  displayStockSymbol,
  formatPercent,
  formatPrice,
  formatTimeMsKst,
} from "../lib/format";
import { netReturnPctFromPrices } from "../lib/netReturn";
import { ko } from "../i18n/ko";
import type { PicksDailyHistoryDay, PicksDailyHistorySlimPick } from "../types";

const PICKS_HISTORY_LS = "stock_picks_daily_history_v1";

function pickSortTimeMs(
  p: PicksDailyHistorySlimPick,
  rowScannedAtMs: number,
): number {
  if (
    p.recordedAtMs != null &&
    p.recordedAtMs > 0 &&
    Number.isFinite(p.recordedAtMs)
  ) {
    return p.recordedAtMs;
  }
  return rowScannedAtMs > 0 && Number.isFinite(rowScannedAtMs)
    ? rowScannedAtMs
    : 0;
}

function historyPickSortLabel(p: PicksDailyHistorySlimPick): string {
  const sym = displayStockSymbol(p.symbol);
  const name = (p.name ?? "").trim();
  return name && name !== sym ? `${name} (${sym})` : sym;
}

/** 최신(늦은 시각)이 위로; 시각 같으면 표시 제목(이름) 오름차순 */
function compareHistoryPicksDesc(
  a: PicksDailyHistorySlimPick,
  b: PicksDailyHistorySlimPick,
  rowScannedAtMs: number,
): number {
  const tb = pickSortTimeMs(b, rowScannedAtMs);
  const ta = pickSortTimeMs(a, rowScannedAtMs);
  if (tb !== ta) return tb - ta;
  return historyPickSortLabel(a).localeCompare(
    historyPickSortLabel(b),
    "ko",
    { sensitivity: "base" },
  );
}

/** 당일 최초 스냅샷 가격만(고저 범위 표시 안 함) */
function formatInitialPrice(
  p: PicksDailyHistorySlimPick,
  defaultCurrency: string,
): string {
  const cur = (p.currency ?? defaultCurrency).trim() || defaultCurrency;
  return formatPrice(p.price ?? undefined, cur);
}

function HistoryPickPriceMeta({
  pick,
  defaultCurrency,
  quotes,
  quotesLoading,
}: {
  pick: PicksDailyHistorySlimPick;
  defaultCurrency: string;
  quotes: PicksDailyHistoryQuotesMap;
  quotesLoading: boolean;
}) {
  const sym = pick.symbol.trim().toUpperCase();
  const initial = pick.price;
  const live = quotes[sym];
  const cur = live?.price;
  const curCurrency =
    (live?.currency ?? pick.currency ?? defaultCurrency).trim() || defaultCurrency;
  const vs = netReturnPctFromPrices(initial, cur);
  const up = (vs ?? 0) >= 0;

  return (
    <span className="picks-history-pick-item__prices">
      <span>
        {ko.app.picksHistoryInitialPrice}{" "}
        <b>{formatInitialPrice(pick, defaultCurrency)}</b>
      </span>
      {quotesLoading && !live ? (
        <span className="picks-history-pick-item__quotes-pending">
          {ko.app.picksHistoryQuotesLoading}
        </span>
      ) : null}
      {!quotesLoading && cur != null && Number.isFinite(cur) ? (
        <>
          <span className="picks-history-pick-item__sep" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <span>
            {ko.app.picksHistoryCurrentPrice}{" "}
            <b>{formatPrice(cur, curCurrency)}</b>
          </span>
          {vs != null ? (
            <>
              <span className="picks-history-pick-item__sep" aria-hidden>
                {" "}
                ·{" "}
              </span>
              <span
                className={
                  up
                    ? "picks-history-pick-item__vs picks-history-pick-item__vs--up"
                    : "picks-history-pick-item__vs picks-history-pick-item__vs--down"
                }
              >
                {ko.app.picksHistoryVsInitial}{" "}
                <b>{formatPercent(vs)}</b>
                <span className="picks-history-pick-item__fee-tag">
                  {ko.app.recTrackerFeeRoundTrip}
                </span>
              </span>
            </>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

/** 행·종목에 시각이 섞여 있을 때 표시용으로 가장 이른 시각(당일 첫 스냅샷에 가깝게) */
function rowDisplayTimeAnchor(
  picks: PicksDailyHistorySlimPick[],
  rowScannedAtMs: number,
): number {
  const nums = picks
    .map((p) => p.recordedAtMs)
    .filter((n): n is number => n != null && n > 0 && Number.isFinite(n));
  if (nums.length === 0) {
    return rowScannedAtMs > 0 ? rowScannedAtMs : 0;
  }
  const minPick = Math.min(...nums);
  if (rowScannedAtMs > 0 && Number.isFinite(rowScannedAtMs)) {
    return Math.min(minPick, rowScannedAtMs);
  }
  return minPick;
}

function HistoryPickColumn({
  picks,
  rowScannedAtMs,
  defaultCurrency,
  quotes,
  quotesLoading,
}: {
  picks: PicksDailyHistorySlimPick[];
  rowScannedAtMs: number;
  defaultCurrency: string;
  quotes: PicksDailyHistoryQuotesMap;
  quotesLoading: boolean;
}) {
  const sortedPicks = useMemo(() => {
    return [...picks].sort((a, b) =>
      compareHistoryPicksDesc(a, b, rowScannedAtMs),
    );
  }, [picks, rowScannedAtMs]);

  const anchorMs = useMemo(
    () => rowDisplayTimeAnchor(sortedPicks, rowScannedAtMs),
    [sortedPicks, rowScannedAtMs],
  );
  if (!sortedPicks.length) {
    return <span className="picks-history-table__empty">—</span>;
  }
  return (
    <ul className="picks-history-pick-list">
      {sortedPicks.map((p) => {
        const sym = displayStockSymbol(p.symbol);
        const title =
          p.name && p.name !== sym ? `${p.name} (${sym})` : sym;
        const t =
          p.recordedAtMs != null && p.recordedAtMs > 0 && Number.isFinite(p.recordedAtMs)
            ? p.recordedAtMs
            : anchorMs;
        return (
          <li key={p.symbol} className="picks-history-pick-item">
            <div className="picks-history-pick-item__title">{title}</div>
            <div className="picks-history-pick-item__meta">
              <span>{formatTimeMsKst(t)}</span>
              <span className="picks-history-pick-item__sep" aria-hidden>
                {" "}
                ·{" "}
              </span>
              <HistoryPickPriceMeta
                pick={p}
                defaultCurrency={defaultCurrency}
                quotes={quotes}
                quotesLoading={quotesLoading}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function PicksHistoryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<PicksDailyHistoryDay[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<PicksDailyHistoryQuotesMap>({});
  const [quotesLoading, setQuotesLoading] = useState(false);

  useEffect(() => {
    if (!days.length) {
      setSelectedDate(null);
      return;
    }
    setSelectedDate((prev) =>
      prev && days.some((d) => d.date === prev) ? prev : days[0]!.date,
    );
  }, [days]);

  useEffect(() => {
    if (!open) return;
    const warmed = peekPicksDailyHistoryPrefetch();
    if (warmed?.days?.length) {
      setDays(Array.isArray(warmed.days) ? warmed.days : []);
      setLoading(false);
    } else {
      setLoading(true);
    }
    void fetchPicksDailyHistory()
      .then((d) => {
        const list = Array.isArray(d.days) ? d.days : [];
        setDays(list);
        try {
          localStorage.setItem(PICKS_HISTORY_LS, JSON.stringify(d));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem(PICKS_HISTORY_LS);
          if (!raw) {
            setDays([]);
            return;
          }
          const o = JSON.parse(raw) as { days?: unknown };
          setDays(Array.isArray(o.days) ? (o.days as PicksDailyHistoryDay[]) : []);
        } catch {
          setDays([]);
        }
      })
      .finally(() => setLoading(false));
  }, [open]);

  const selectedRow =
    (selectedDate && days.find((d) => d.date === selectedDate)) ?? days[0] ?? null;

  const symbolsForQuotes = useMemo(() => {
    if (!selectedRow) return [];
    return [...selectedRow.kr, ...selectedRow.us]
      .map((p) => p.symbol.trim().toUpperCase())
      .filter(Boolean);
  }, [selectedRow]);

  useEffect(() => {
    if (!open || !symbolsForQuotes.length) {
      setQuotes({});
      setQuotesLoading(false);
      return;
    }
    let cancelled = false;
    setQuotesLoading(true);
    void fetchPicksDailyHistoryQuotes(symbolsForQuotes)
      .then((data) => {
        if (!cancelled) setQuotes(data.quotes ?? {});
      })
      .catch(() => {
        if (!cancelled) setQuotes({});
      })
      .finally(() => {
        if (!cancelled) setQuotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, symbolsForQuotes.join(",")]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="news-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        id="picks-history-dialog"
        className="news-modal card picks-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="picks-history-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="news-modal-header">
          <div>
            <h2 id="picks-history-modal-title">{ko.app.picksHistoryModalTitle}</h2>
            <p className="news-modal-sub">
              {ko.app.picksHistoryColDate} · {ko.app.picksHistoryColKr} ·{" "}
              {ko.app.picksHistoryColUs}
            </p>
          </div>
          <button
            type="button"
            className="news-modal-close"
            onClick={onClose}
            aria-label={ko.app.picksHistoryClose}
          >
            ×
          </button>
        </header>

        <div className="news-modal-body picks-history-modal__body">
          {loading && (
            <p className="news-modal-status">{ko.app.picksHistoryLoading}</p>
          )}
          {!loading && days.length > 0 && selectedRow && (
            <div className="picks-history-table-wrap">
              <table className="picks-history-table">
                <thead>
                  <tr>
                    <th>{ko.app.picksHistoryColDate}</th>
                    <th>{ko.app.picksHistoryColKr}</th>
                    <th>{ko.app.picksHistoryColUs}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="picks-history-table__date picks-history-table__date-col">
                      <ul className="picks-history-date-list">
                        {days.map((row) => (
                          <li key={row.date}>
                            <button
                              type="button"
                              className={
                                row.date === selectedDate
                                  ? "picks-history-date picks-history-date--selected"
                                  : "picks-history-date"
                              }
                              aria-pressed={row.date === selectedDate}
                              onClick={() => setSelectedDate(row.date)}
                            >
                              {row.date}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="picks-history-table__cell picks-history-table__cell--list">
                      <HistoryPickColumn
                        picks={selectedRow.kr}
                        rowScannedAtMs={selectedRow.scannedAtMs}
                        defaultCurrency="KRW"
                        quotes={quotes}
                        quotesLoading={quotesLoading}
                      />
                    </td>
                    <td className="picks-history-table__cell picks-history-table__cell--list">
                      <HistoryPickColumn
                        picks={selectedRow.us}
                        rowScannedAtMs={selectedRow.scannedAtMs}
                        defaultCurrency="USD"
                        quotes={quotes}
                        quotesLoading={quotesLoading}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
