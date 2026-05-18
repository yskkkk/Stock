import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fetchPicksDailyHistory } from "../api";
import { displayStockSymbol, formatPrice, formatTimeMsKst } from "../lib/format";
import { ko } from "../i18n/ko";
import type { PicksDailyHistoryDay, PicksDailyHistorySlimPick } from "../types";

const PICKS_HISTORY_LS = "stock_picks_daily_history_v1";

function formatPriceLine(
  p: PicksDailyHistorySlimPick,
  defaultCurrency: string,
): string {
  const cur = (p.currency ?? defaultCurrency).trim() || defaultCurrency;
  const lo = p.dayLow;
  const hi = p.dayHigh;
  if (
    lo != null &&
    hi != null &&
    typeof lo === "number" &&
    typeof hi === "number" &&
    lo > 0 &&
    hi >= lo
  ) {
    return `${formatPrice(lo, cur)} ~ ${formatPrice(hi, cur)}`;
  }
  return formatPrice(p.price ?? undefined, cur);
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
}: {
  picks: PicksDailyHistorySlimPick[];
  rowScannedAtMs: number;
  defaultCurrency: string;
}) {
  const anchorMs = useMemo(
    () => rowDisplayTimeAnchor(picks, rowScannedAtMs),
    [picks, rowScannedAtMs],
  );
  if (!picks.length) {
    return <span className="picks-history-table__empty">—</span>;
  }
  return (
    <ul className="picks-history-pick-list">
      {picks.map((p) => {
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
              <span>{formatPriceLine(p, defaultCurrency)}</span>
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
    setLoading(true);
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

  const selectedRow =
    (selectedDate && days.find((d) => d.date === selectedDate)) ?? days[0] ?? null;

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
                      />
                    </td>
                    <td className="picks-history-table__cell picks-history-table__cell--list">
                      <HistoryPickColumn
                        picks={selectedRow.us}
                        rowScannedAtMs={selectedRow.scannedAtMs}
                        defaultCurrency="USD"
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
