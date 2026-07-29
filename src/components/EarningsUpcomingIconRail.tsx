import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useLeftRailLazyFollow } from "../hooks/useLeftRailLazyFollow";
import { createPortal } from "react-dom";
import { useOptionalValueInvestBubble } from "../contexts/ValueInvestBubbleContext";
import { useOptionalStockShareStructureBubble } from "../contexts/StockShareStructureBubbleContext";
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
import { peekMacroPrefetch, prefetchSectorEarnings } from "../lib/tabPrefetch";
import { ko } from "../i18n/ko";
import type { SectorEarningsSpotlightItem } from "../types";
import {
  clampAnchorBubbleInViewport,
  positionAnchorBubble,
  type AnchorBubblePlacement,
} from "../lib/viewportAnchorBubblePosition";
import {
  dispatchStockHoverBubbleOpen,
  handleStockHoverParentBubbleClick,
  isSameStockBubbleSymbol,
  STOCK_HOVER_BUBBLE_FORCE_CLOSE_EVENT,
  useStockHoverBubbleExclusive,
} from "../lib/stockHoverBubbleSingleton";

const EARNINGS_ICON_RAIL_BUBBLE_OWNER = "earnings-icon-rail";

const TICK_MS = 1000;
const HIDE_DELAY_MS = 420;
const EST_BUBBLE_W = 268;
const EST_BUBBLE_H = 240;

type TipState = {
  row: SectorEarningsSpotlightItem;
  left: number;
  top: number;
  placement: AnchorBubblePlacement;
  transform: string;
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
const MACRO_SESSION_CACHE_KEY = "stock-macro-bar-v3";

function readSessionSectorEarnings(): SectorEarningsSpotlightItem[] {
  try {
    const raw = sessionStorage.getItem(MACRO_SESSION_CACHE_KEY);
    if (!raw) return [];
    const o = JSON.parse(raw) as {
      sectorEarnings?: SectorEarningsSpotlightItem[];
      at?: number;
    };
    if (typeof o.at !== "number" || Date.now() - o.at > 30 * 60_000) return [];
    return Array.isArray(o.sectorEarnings) ? o.sectorEarnings : [];
  } catch {
    return [];
  }
}

export default function EarningsUpcomingIconRail({
  variant = "workspace",
  railRef: railRefProp,
  pageScrollRef,
  railHeader = null,
}: {
  /** workspace=종목 목록 그리드 열, edge=앱 본문 최좌측 얇은 레일 */
  variant?: "workspace" | "edge";
  railRef?: RefObject<HTMLElement | null>;
  pageScrollRef?: RefObject<HTMLElement | null>;
  /** edge 레일 상단(S&P·ETF 등) */
  railHeader?: ReactNode;
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
    const cached = peekMacroPrefetch()?.sectorEarnings;
    if (cached?.length) return cached;
    return readSessionSectorEarnings();
  });
  const [now, setNow] = useState(() => Date.now());
  const [tip, setTip] = useState<TipState | null>(null);
  const tipRef = useRef<TipState | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueInvest = useOptionalValueInvestBubble();
  const shareStructure = useOptionalStockShareStructureBubble();
  tipRef.current = tip;

  useEffect(() => {
    let cancelled = false;
    const apply = (list: SectorEarningsSpotlightItem[]) => {
      if (!cancelled && list.length) setRows(list);
    };
    void prefetchSectorEarnings().then(apply).catch(() => {});
    // cold API가 늦을 때 재시도
    const retryIds = [2500, 8000, 20_000].map((ms) =>
      window.setTimeout(() => {
        void prefetchSectorEarnings().then(apply).catch(() => {});
      }, ms),
    );
    const id = window.setInterval(() => {
      void prefetchSectorEarnings().then(apply).catch(() => {});
    }, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      for (const t of retryIds) window.clearTimeout(t);
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
    enabled:
      variant === "edge" &&
      railMounted &&
      (upcoming.length > 0 || Boolean(railHeader)),
  });

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const openTip = useCallback((el: HTMLElement, row: SectorEarningsSpotlightItem) => {
    clearHideTimer();
    dispatchStockHoverBubbleOpen({
      ownerId: EARNINGS_ICON_RAIL_BUBBLE_OWNER,
      symbol: row.symbol,
    });
    const anchor = el.getBoundingClientRect();
    const positioned = positionAnchorBubble(anchor, EST_BUBBLE_W, EST_BUBBLE_H);
    const clamped = clampAnchorBubbleInViewport(
      positioned.left,
      positioned.top,
      EST_BUBBLE_W,
      EST_BUBBLE_H,
      positioned.transform,
    );
    setTip({
      row,
      ...positioned,
      ...clamped,
    });
  }, [clearHideTimer]);

  const scheduleHideTip = useCallback(() => {
    const sym = tipRef.current?.row.symbol;
    if (isSameStockBubbleSymbol(sym, shareStructure?.openSymbol)) {
      return;
    }
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      shareStructure?.scheduleCloseShareStructureModal();
      const tipSym = tipRef.current?.row.symbol;
      if (tipSym && isSameStockBubbleSymbol(tipSym, valueInvest?.openSymbol)) return;
      setTip(null);
      hideTimerRef.current = null;
    }, HIDE_DELAY_MS);
  }, [clearHideTimer, valueInvest?.openSymbol, shareStructure]);

  const closeTip = useCallback(() => {
    clearHideTimer();
    shareStructure?.closeShareStructureModal();
    setTip(null);
  }, [clearHideTimer, shareStructure]);

  const handleParentBubbleClick = useCallback(
    (e: MouseEvent) => {
      const sym = tipRef.current?.row.symbol;
      if (!sym) return;
      handleStockHoverParentBubbleClick(e, sym, shareStructure, valueInvest);
    },
    [shareStructure, valueInvest],
  );

  useStockHoverBubbleExclusive(EARNINGS_ICON_RAIL_BUBBLE_OWNER, closeTip);

  useEffect(() => {
    const onForceClose = () => closeTip();
    window.addEventListener(STOCK_HOVER_BUBBLE_FORCE_CLOSE_EVENT, onForceClose);
    return () =>
      window.removeEventListener(STOCK_HOVER_BUBBLE_FORCE_CLOSE_EVENT, onForceClose);
  }, [closeTip]);

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
                : tip.placement === "below"
                  ? "earnings-icon-rail__bubble earnings-icon-rail__bubble--below"
                  : tip.placement === "above"
                    ? "earnings-icon-rail__bubble earnings-icon-rail__bubble--above"
                    : "earnings-icon-rail__bubble"
            }
            style={{
              left: `${tip.left}px`,
              top: `${tip.top}px`,
              transform: tip.transform,
            }}
            onMouseEnter={() => {
              clearHideTimer();
              shareStructure?.keepShareStructureModalOpen();
            }}
            onMouseLeave={scheduleHideTip}
            onClick={handleParentBubbleClick}
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
        {railHeader ? (
          <div className="earnings-icon-rail__header">{railHeader}</div>
        ) : null}
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
