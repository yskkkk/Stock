import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { fetchSectorEarnings } from "../api";
import {
  formatMacroCountdown,
  formatMacroWhen,
  formatSectorEarningsDday,
} from "../lib/formatMacro";
import { stockLogoUrl } from "../lib/stockLogoUrl";
import { peekMacroPrefetch } from "../lib/tabPrefetch";
import { ko } from "../i18n/ko";
import type { SectorEarningsSpotlightItem } from "../types";

const TICK_MS = 1000;
const HIDE_DELAY_MS = 120;

type TipState = {
  row: SectorEarningsSpotlightItem;
  left: number;
  top: number;
};

function EarningsIconButton({
  row,
  active,
  onEnter,
  onLeave,
}: {
  row: SectorEarningsSpotlightItem;
  active: boolean;
  onEnter: (el: HTMLElement, row: SectorEarningsSpotlightItem) => void;
  onLeave: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const logo = stockLogoUrl(row.symbol, row.market);
  const codeShort = row.symbol.replace(/^KR_/i, "").replace(/\.(KS|KQ)$/i, "");
  const href = `https://finance.yahoo.com/quote/${encodeURIComponent(row.symbol)}`;
  const showImg = Boolean(logo) && !imgFailed;

  return (
    <li className="earnings-icon-rail__item">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={
          active
            ? "earnings-icon-rail__btn earnings-icon-rail__btn--on"
            : "earnings-icon-rail__btn"
        }
        aria-label={`${row.name} · ${formatMacroWhen(row.at, row.timezone)}`}
        onMouseEnter={(e) => onEnter(e.currentTarget, row)}
        onMouseLeave={onLeave}
        onFocus={(e) => onEnter(e.currentTarget, row)}
        onBlur={onLeave}
      >
        {showImg ? (
          <img
            className="earnings-icon-rail__img"
            src={logo!}
            alt=""
            width={28}
            height={28}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="earnings-icon-rail__fallback" aria-hidden>
            {(row.name.trim() || codeShort).slice(0, 1)}
          </span>
        )}
        <span
          className={`earnings-icon-rail__market earnings-icon-rail__market--${row.market}`}
          aria-hidden
        >
          {row.market === "kr" ? "K" : "U"}
        </span>
      </a>
    </li>
  );
}

export default function EarningsUpcomingIconRail() {
  const tipId = useId();
  const [rows, setRows] = useState<SectorEarningsSpotlightItem[]>(() => {
    const cached = peekMacroPrefetch();
    return cached?.sectorEarnings ?? [];
  });
  const [now, setNow] = useState(() => Date.now());
  const [tip, setTip] = useState<TipState | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSectorEarnings()
      .then((data) => {
        if (cancelled) return;
        setRows(Array.isArray(data.sectorEarnings) ? data.sectorEarnings : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const upcoming = useMemo(() => {
    return rows
      .filter((r) => r.at > now)
      .sort((a, b) => b.at - a.at);
  }, [rows, now]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const openTip = useCallback((el: HTMLElement, row: SectorEarningsSpotlightItem) => {
    clearHideTimer();
    const r = el.getBoundingClientRect();
    setTip({
      row,
      left: r.right + 10,
      top: r.top + r.height / 2,
    });
  }, [clearHideTimer]);

  const scheduleHideTip = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setTip(null), HIDE_DELAY_MS);
  }, [clearHideTimer]);

  if (upcoming.length === 0) return null;

  const activeRow = tip?.row ?? null;
  const msLeft = activeRow ? activeRow.at - now : 0;

  const bubble =
    tip && typeof document !== "undefined"
      ? createPortal(
          <div
            id={tipId}
            role="tooltip"
            className="earnings-icon-rail__bubble"
            style={{
              left: `${tip.left}px`,
              top: `${tip.top}px`,
              transform: "translate(0, -50%)",
            }}
            onMouseEnter={clearHideTimer}
            onMouseLeave={scheduleHideTip}
          >
            <p className="earnings-icon-rail__bubble-name">{tip.row.name}</p>
            <p className="earnings-icon-rail__bubble-code">
              {tip.row.symbol.replace(/^KR_/i, "")}
              {tip.row.sectorLabel ? ` · ${tip.row.sectorLabel}` : ""}
            </p>
            <p className="earnings-icon-rail__bubble-when">
              {formatMacroWhen(tip.row.at, tip.row.timezone)}
            </p>
            <p className="earnings-icon-rail__bubble-countdown" aria-live="polite">
              {formatSectorEarningsDday(tip.row.at, now, tip.row.timezone)}{" "}
              <span className="earnings-icon-rail__bubble-sep" aria-hidden>
                ·
              </span>{" "}
              {formatMacroCountdown(msLeft)}
            </p>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <aside
        className="earnings-icon-rail"
        aria-label={ko.macro.earningsIconRailAria}
      >
        <ul className="earnings-icon-rail__list">
          {upcoming.map((row) => (
            <EarningsIconButton
              key={row.id}
              row={row}
              active={activeRow?.id === row.id}
              onEnter={openTip}
              onLeave={scheduleHideTip}
            />
          ))}
        </ul>
      </aside>
      {bubble}
    </>
  );
}
