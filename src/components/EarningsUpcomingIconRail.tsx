import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useLeftRailLazyFollow } from "../hooks/useLeftRailLazyFollow";
import { createPortal } from "react-dom";
import { fetchSectorEarnings } from "../api";
import StockEarningsHoverBubbleBody from "./StockEarningsHoverBubbleBody";
import {
  formatMacroCountdown,
  formatMacroWhen,
  formatSectorEarningsDday,
} from "../lib/formatMacro";
import { stockLogoUrl } from "../lib/stockLogoUrl";
import {
  tradingViewChartUrl,
  yahooStockSymbolToTradingView,
} from "../lib/tradingviewSymbols";
import StockLogoWithPlate from "./StockLogoWithPlate";
import { peekMacroPrefetch } from "../lib/tabPrefetch";
import { ko } from "../i18n/ko";
import type { SectorEarningsSpotlightItem } from "../types";

const TICK_MS = 1000;
const HIDE_DELAY_MS = 120;

type TipState = {
  row: SectorEarningsSpotlightItem;
  left: number;
  top: number;
  placement: "left" | "right";
};

function EarningsIconButton({
  row,
  now,
  active,
  onEnter,
  onLeave,
  stripWhiteBackground = false,
}: {
  row: SectorEarningsSpotlightItem;
  now: number;
  active: boolean;
  onEnter: (el: HTMLElement, row: SectorEarningsSpotlightItem) => void;
  onLeave: () => void;
  stripWhiteBackground?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const logo = stockLogoUrl(row.symbol, row.market);
  const codeShort = row.symbol.replace(/^KR_/i, "").replace(/\.(KS|KQ)$/i, "");
  const href = `https://finance.yahoo.com/quote/${encodeURIComponent(row.symbol)}`;
  const showImg = Boolean(logo) && !imgFailed;
  const dday = formatSectorEarningsDday(row.at, now, row.timezone);

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
        aria-label={`${row.name} · ${dday} · ${formatMacroWhen(row.at, row.timezone)}`}
        onMouseEnter={(e) => onEnter(e.currentTarget, row)}
        onMouseLeave={onLeave}
        onFocus={(e) => onEnter(e.currentTarget, row)}
        onBlur={onLeave}
      >
        {showImg ? (
          <StockLogoWithPlate
            symbol={row.symbol}
            market={row.market}
            src={logo!}
            imgClassName="earnings-icon-rail__img"
            wrapClassName="earnings-icon-rail__logo-wrap"
            transparentWrap
            stripWhiteBackground={stripWhiteBackground}
            width={48}
            height={48}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="earnings-icon-rail__fallback" aria-hidden>
            {(row.name.trim() || codeShort).slice(0, 1)}
          </span>
        )}
        <span
          className={
            dday === "D-day"
              ? "earnings-icon-rail__dday earnings-icon-rail__dday--today"
              : "earnings-icon-rail__dday"
          }
          aria-hidden
        >
          {dday}
        </span>
      </a>
    </li>
  );
}

const EARNINGS_GRACE_MS = 12 * 60 * 60 * 1000;

export default function EarningsUpcomingIconRail({
  variant = "workspace",
  railRef: railRefProp,
  pageScrollRef,
}: {
  /** workspace=종목 목록 그리드 열, edge=앱 본문 최좌측 얇은 레일 */
  variant?: "workspace" | "edge";
  railRef?: RefObject<HTMLElement | null>;
  pageScrollRef?: RefObject<HTMLElement | null>;
}) {
  const innerRailRef = useRef<HTMLElement>(null);
  const railRef = railRefProp ?? innerRailRef;
  const [railMounted, setRailMounted] = useState(false);
  const bindRailRef = useCallback(
    (node: HTMLElement | null) => {
      (railRef as { current: HTMLElement | null }).current = node;
      setRailMounted(Boolean(node));
    },
    [railRef],
  );
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
      .filter((r) => r.at > now - EARNINGS_GRACE_MS)
      .sort((a, b) => a.at - b.at);
  }, [rows, now]);

  useLeftRailLazyFollow(railRef, pageScrollRef ?? { current: null }, {
    columnSelector: ".app__viewport-earnings-rail",
    enabled: variant === "edge" && upcoming.length > 0 && railMounted,
  });

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const openTip = useCallback((el: HTMLElement, row: SectorEarningsSpotlightItem) => {
    clearHideTimer();
    const r = el.getBoundingClientRect();
    const gap = 10;
    const estW = 268;
    const pad = 8;
    // edge 레일은 화면/본문 왼쪽 — 말풍선은 아이콘 오른쪽(본문 방향)으로
    let placement: TipState["placement"] = "right";
    let left = r.right + gap;
    if (left + estW > window.innerWidth - pad) {
      placement = "left";
      left = Math.max(pad, r.left - gap);
    }
    setTip({
      row,
      left,
      top: r.top + r.height / 2,
      placement,
    });
  }, [clearHideTimer]);

  const scheduleHideTip = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setTip(null), HIDE_DELAY_MS);
  }, [clearHideTimer]);

  if (upcoming.length === 0) return null;

  const activeRow = tip?.row ?? null;
  const msLeft = activeRow ? activeRow.at - now : 0;
  const tvChartUrl = tip
    ? tradingViewChartUrl(
        yahooStockSymbolToTradingView(tip.row.symbol, tip.row.market),
      )
    : null;

  const bubble =
    tip && typeof document !== "undefined"
      ? createPortal(
          <div
            id={tipId}
            role="tooltip"
            className={
              tip.placement === "left"
                ? "earnings-icon-rail__bubble earnings-icon-rail__bubble--left"
                : "earnings-icon-rail__bubble"
            }
            style={{
              left: `${tip.left}px`,
              top: `${tip.top}px`,
              transform:
                tip.placement === "left"
                  ? "translate(-100%, -50%)"
                  : "translate(0, -50%)",
            }}
            onMouseEnter={clearHideTimer}
            onMouseLeave={scheduleHideTip}
          >
            <StockEarningsHoverBubbleBody
              symbol={tip.row.symbol}
              name={tip.row.name}
              market={tip.row.market === "kr" ? "kr" : "us"}
              sectorLabel={tip.row.sectorLabel}
              earningsWhen={formatMacroWhen(tip.row.at, tip.row.timezone)}
              earningsCountdown={`${formatSectorEarningsDday(tip.row.at, now, tip.row.timezone)} · ${formatMacroCountdown(msLeft)}`}
              tvChartUrl={tvChartUrl}
              onAfterAction={() => setTip(null)}
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <aside
        ref={bindRailRef}
        className={
          variant === "edge"
            ? "earnings-icon-rail earnings-icon-rail--edge"
            : "earnings-icon-rail"
        }
        aria-label={ko.macro.earningsIconRailAria}
      >
        <ul className="earnings-icon-rail__list">
          {upcoming.map((row) => (
            <EarningsIconButton
              key={row.id}
              row={row}
              now={now}
              active={activeRow?.id === row.id}
              onEnter={openTip}
              onLeave={scheduleHideTip}
              stripWhiteBackground={variant === "edge"}
            />
          ))}
        </ul>
      </aside>
      {bubble}
    </>
  );
}
