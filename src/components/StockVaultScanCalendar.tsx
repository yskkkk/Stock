import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ko } from "../i18n/ko";
import { fetchStockVaultScanCoverage } from "../api";
import type {
  ScanCoverageDay,
  ScanCoverageResponse,
  ScanCoverageStatus,
} from "../types";

type DayStatus = "ok" | "partial" | "missing" | "pending" | "na";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dayLevelStatus(day: ScanCoverageDay): DayStatus {
  const statuses = Object.values(day.sources)
    .filter((s) => s.expected.length > 0)
    .map((s) => s.status);
  if (statuses.length === 0) return "na";
  if (statuses.some((s) => s === "missing")) return "missing";
  if (statuses.some((s) => s === "partial")) return "partial";
  if (statuses.every((s) => s === "ok")) return "ok";
  return "pending";
}

function missingCount(day: ScanCoverageDay): number {
  return Object.values(day.sources).filter(
    (s) => s.status === "missing" || s.status === "partial",
  ).length;
}

function statusLabel(status: ScanCoverageStatus): string {
  switch (status) {
    case "ok":
      return ko.stockVault.scanCalendarLegendOk;
    case "partial":
      return ko.stockVault.scanCalendarLegendPartial;
    case "missing":
      return ko.stockVault.scanCalendarLegendMissing;
    case "pending":
      return ko.stockVault.scanCalendarLegendPending;
    default:
      return ko.stockVault.scanCalendarLegendNa;
  }
}

export default function StockVaultScanCalendar({
  onClose,
  onSelectDate,
}: {
  onClose: () => void;
  onSelectDate: (date: string) => void;
}) {
  const [data, setData] = useState<ScanCoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeYm, setActiveYm] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    fetchStockVaultScanCoverage(120, ctrl.signal)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onClose]);

  const dayByDate = useMemo(() => {
    const map = new Map<string, ScanCoverageDay>();
    for (const d of data?.days ?? []) map.set(d.date, d);
    return map;
  }, [data]);

  const months = useMemo(() => {
    const days = [...(data?.days ?? [])].sort((a, b) =>
      a.date < b.date ? -1 : 1,
    );
    /** @type {Map<string, ScanCoverageDay[]>} */
    const byMonth = new Map<string, ScanCoverageDay[]>();
    for (const d of days) {
      const ym = d.date.slice(0, 7);
      const arr = byMonth.get(ym) ?? [];
      arr.push(d);
      byMonth.set(ym, arr);
    }
    return [...byMonth.entries()].map(([ym, list]) => {
      const first = list[0];
      const [yy, mm] = ym.split("-");
      const [fy, fmo, fd] = first.date.split("-").map(Number);
      const leadBlanks = new Date(fy, fmo - 1, fd).getDay();
      const miss = list.filter(
        (d) => dayLevelStatus(d) === "missing" || dayLevelStatus(d) === "partial",
      ).length;
      return {
        ym,
        label: `${yy}년 ${Number(mm)}월`,
        monthLabel: `${Number(mm)}월`,
        list,
        leadBlanks,
        miss,
      };
    });
  }, [data]);

  const activeIdx = useMemo(() => {
    if (!months.length) return -1;
    const target = activeYm ?? data?.today?.slice(0, 7) ?? months[months.length - 1].ym;
    const i = months.findIndex((m) => m.ym === target);
    return i >= 0 ? i : months.length - 1;
  }, [months, activeYm, data]);

  const activeMonth = activeIdx >= 0 ? months[activeIdx] : null;

  const goMonth = useCallback(
    (delta: number) => {
      const next = activeIdx + delta;
      if (next < 0 || next >= months.length) return;
      setActiveYm(months[next].ym);
    },
    [activeIdx, months],
  );

  const selectedDay = selected ? dayByDate.get(selected) : null;

  const handleGoToDate = useCallback(
    (date: string) => {
      onSelectDate(date);
      onClose();
    },
    [onSelectDate, onClose],
  );

  return (
    <div className="scan-cal__overlay">
      <div
        ref={panelRef}
        className="scan-cal__panel"
        role="dialog"
        aria-label={ko.stockVault.scanCalendarTitle}
      >
        <div className="scan-cal__head">
          <div>
            <h3 className="scan-cal__title">{ko.stockVault.scanCalendarTitle}</h3>
            <p className="scan-cal__subtitle">
              {ko.stockVault.scanCalendarSubtitle}
            </p>
          </div>
          <button
            type="button"
            className="scan-cal__close"
            onClick={onClose}
            aria-label={ko.stockVault.scanCalendarClose}
          >
            ×
          </button>
        </div>

        <div className="scan-cal__legend">
          {(["ok", "partial", "missing", "pending", "na"] as const).map((s) => (
            <span key={s} className="scan-cal__legend-item">
              <span className={`scan-cal__dot scan-cal__dot--${s}`} />
              {statusLabel(s)}
            </span>
          ))}
        </div>

        {loading ? (
          <p className="scan-cal__msg">{ko.stockVault.scanCalendarLoading}</p>
        ) : error ? (
          <p className="scan-cal__msg scan-cal__msg--error">
            {ko.stockVault.scanCalendarError}
          </p>
        ) : (
          <>
            <div className="scan-cal__nav">
              <button
                type="button"
                className="scan-cal__nav-btn"
                onClick={() => goMonth(-1)}
                disabled={activeIdx <= 0}
                aria-label="이전 달"
              >
                ‹
              </button>
              <select
                className="scan-cal__nav-select"
                value={activeMonth?.ym ?? ""}
                onChange={(e) => setActiveYm(e.target.value)}
                aria-label={ko.stockVault.scanCalendarTitle}
              >
                {months.map((mo) => (
                  <option key={mo.ym} value={mo.ym}>
                    {mo.label}
                    {mo.miss > 0 ? ` (${mo.miss})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="scan-cal__nav-btn"
                onClick={() => goMonth(1)}
                disabled={activeIdx >= months.length - 1}
                aria-label="다음 달"
              >
                ›
              </button>
            </div>

            {activeMonth ? (
              <div className="scan-cal__month">
                <div className="scan-cal__grid">
                  {WEEKDAYS.map((w, wi) => (
                    <div
                      key={w}
                      className={[
                        "scan-cal__wd",
                        wi === 0 ? "scan-cal__wd--sun" : "",
                        wi === 6 ? "scan-cal__wd--sat" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {w}
                    </div>
                  ))}
                  {Array.from({ length: activeMonth.leadBlanks }).map((_, i) => (
                    <div
                      key={`b${i}`}
                      className="scan-cal__cell scan-cal__cell--blank"
                    />
                  ))}
                  {activeMonth.list.map((d) => {
                    const st = dayLevelStatus(d);
                    const miss = missingCount(d);
                    const dnum = Number(d.date.slice(8, 10));
                    const isToday = d.date === data?.today;
                    return (
                      <button
                        key={d.date}
                        type="button"
                        className={[
                          "scan-cal__cell",
                          `scan-cal__cell--${st}`,
                          selected === d.date ? "scan-cal__cell--selected" : "",
                          isToday ? "scan-cal__cell--today" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => setSelected(d.date)}
                        title={`${d.date} · ${statusLabel(st as ScanCoverageStatus)}`}
                      >
                        <span className="scan-cal__cell-num">{dnum}</span>
                        {miss > 0 ? (
                          <span className="scan-cal__cell-miss">{miss}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="scan-cal__detail">
              {selectedDay ? (
                <>
                  <div className="scan-cal__detail-head">
                    <span className="scan-cal__detail-title">
                      {ko.stockVault.scanCalendarDayDetail(selectedDay.date)}
                    </span>
                    <button
                      type="button"
                      className="scan-cal__goto"
                      onClick={() => handleGoToDate(selectedDay.date)}
                    >
                      {selectedDay.date} 보기
                    </button>
                  </div>
                  <ul className="scan-cal__detail-list">
                    {(data?.sources ?? []).map((src) => {
                      const cov = selectedDay.sources[src.id];
                      if (!cov) return null;
                      const ran = cov.ran
                        .map((m) =>
                          m === "kr"
                            ? ko.stockVault.scanCalendarMarketKr
                            : ko.stockVault.scanCalendarMarketUs,
                        )
                        .join("·");
                      return (
                        <li key={src.id} className="scan-cal__detail-row">
                          <span
                            className={`scan-cal__dot scan-cal__dot--${cov.status}`}
                          />
                          <span className="scan-cal__detail-src">{src.label}</span>
                          <span className="scan-cal__detail-status">
                            {statusLabel(cov.status)}
                            {ran ? ` (${ran})` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="scan-cal__msg scan-cal__msg--hint">
                  {ko.stockVault.scanCalendarPickHint}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
