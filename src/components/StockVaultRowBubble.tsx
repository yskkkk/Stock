import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import { useOptionalValueInvestBubble } from "../contexts/ValueInvestBubbleContext";
import { useOptionalStockShareStructureBubble } from "../contexts/StockShareStructureBubbleContext";
import StockEarningsHoverBubbleBody from "./StockEarningsHoverBubbleBody";
import { loadEarningsBubbleFinancials } from "../lib/earningsBubbleFinancials";
import { tradingViewChartUrl } from "../lib/tradingviewSymbols";
import { useIsMobilePhone } from "../hooks/useIsMobilePhone";
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

const STOCK_VAULT_ROW_BUBBLE_OWNER = "stock-vault-row";

const HIDE_DELAY_MS = 420;
const SHOW_DELAY_MS = 450;
const VIEWPORT_PAD = 8;
const GAP = 2;
const EST_BUBBLE_W = 300;
const EST_BUBBLE_H = 280;

export type StockVaultRowBubbleTarget = {
  symbol: string;
  name: string;
  market: "kr" | "us";
  industry: string | null;
  tvSymbol: string;
  price?: number | null;
  currency?: string | null;
};

export type StockVaultRowBubbleActions = {
  tipId: string;
  showTip: (el: HTMLElement, target: StockVaultRowBubbleTarget, opts?: { immediate?: boolean }) => void;
  toggleTip: (el: HTMLElement, target: StockVaultRowBubbleTarget) => void;
  scheduleHideTip: () => void;
};

type Placement = AnchorBubblePlacement;

type TipState = StockVaultRowBubbleTarget & {
  anchorRect: DOMRectReadOnly;
  left: number;
  top: number;
  placement: Placement;
  transform: string;
};

function positionTip(
  anchor: DOMRectReadOnly,
  bubbleW = EST_BUBBLE_W,
  bubbleH = EST_BUBBLE_H,
) {
  return positionAnchorBubble(anchor, bubbleW, bubbleH, { gap: GAP });
}

function bubblePlacementClass(placement: Placement) {
  const base = "earnings-icon-rail__bubble";
  if (placement === "left") return `${base} earnings-icon-rail__bubble--left`;
  if (placement === "below") return `${base} earnings-icon-rail__bubble--below`;
  if (placement === "above") return `${base} earnings-icon-rail__bubble--above`;
  return base;
}

export function useStockVaultRowBubble(tipIdOverride?: string) {
  const generatedTipId = useId();
  const tipId = tipIdOverride ?? generatedTipId;
  const hideTimerRef = useRef<number | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<TipState | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const valueInvest = useOptionalValueInvestBubble();
  const shareStructure = useOptionalStockShareStructureBubble();
  const mobile = useIsMobilePhone();
  tipRef.current = tip;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const keepTipOpen = useCallback(() => {
    clearHideTimer();
  }, [clearHideTimer]);

  const scheduleHideTip = useCallback(() => {
    if (mobile) return;
    const tipSym = tipRef.current?.symbol;
    if (isSameStockBubbleSymbol(tipSym, shareStructure?.openSymbol)) {
      return;
    }
    clearShowTimer();
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      shareStructure?.scheduleCloseShareStructureModal();
      const sym = tipRef.current?.symbol;
      if (sym && isSameStockBubbleSymbol(sym, valueInvest?.openSymbol)) return;
      setTip(null);
      hideTimerRef.current = null;
    }, HIDE_DELAY_MS);
  }, [mobile, clearHideTimer, clearShowTimer, valueInvest?.openSymbol, shareStructure]);

  const closeTip = useCallback(() => {
    clearShowTimer();
    clearHideTimer();
    shareStructure?.closeShareStructureModal();
    setTip(null);
  }, [clearHideTimer, clearShowTimer, shareStructure]);

  const handleParentBubbleClick = useCallback(
    (e: MouseEvent) => {
      const sym = tipRef.current?.symbol;
      if (!sym) return;
      handleStockHoverParentBubbleClick(e, sym, shareStructure, valueInvest);
    },
    [shareStructure, valueInvest],
  );

  useStockHoverBubbleExclusive(STOCK_VAULT_ROW_BUBBLE_OWNER, closeTip);

  useEffect(() => {
    const onForceClose = () => closeTip();
    window.addEventListener(STOCK_HOVER_BUBBLE_FORCE_CLOSE_EVENT, onForceClose);
    return () =>
      window.removeEventListener(STOCK_HOVER_BUBBLE_FORCE_CLOSE_EVENT, onForceClose);
  }, [closeTip]);

  const openTipAt = useCallback(
    (el: HTMLElement, target: StockVaultRowBubbleTarget) => {
      clearHideTimer();
      dispatchStockHoverBubbleOpen({
        ownerId: STOCK_VAULT_ROW_BUBBLE_OWNER,
        symbol: target.symbol,
      });
      void loadEarningsBubbleFinancials(target.symbol.trim().toUpperCase()).catch(
        () => {},
      );
      const anchorRect = el.getBoundingClientRect();
      setTip({
        ...target,
        anchorRect,
        ...positionTip(anchorRect),
      });
    },
    [clearHideTimer],
  );

  const showTip = useCallback(
    (el: HTMLElement, target: StockVaultRowBubbleTarget, opts?: { immediate?: boolean }) => {
      clearHideTimer();
      const sym = target.symbol.trim().toUpperCase();
      if (tipRef.current?.symbol.trim().toUpperCase() === sym) {
        clearHideTimer();
        return;
      }
      clearShowTimer();
      if (opts?.immediate) {
        openTipAt(el, target);
        return;
      }
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        openTipAt(el, target);
      }, SHOW_DELAY_MS);
    },
    [clearHideTimer, clearShowTimer, openTipAt],
  );

  const toggleTip = useCallback(
    (el: HTMLElement, target: StockVaultRowBubbleTarget) => {
      clearShowTimer();
      const sym = target.symbol.trim().toUpperCase();
      if (tipRef.current?.symbol.trim().toUpperCase() === sym) {
        closeTip();
        return;
      }
      openTipAt(el, target);
    },
    [clearShowTimer, closeTip, openTipAt],
  );

  useLayoutEffect(() => {
    if (!tip || !bubbleRef.current) return;
    const bubble = bubbleRef.current;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    if (!bw || !bh) return;
    const next = positionTip(tip.anchorRect, bw, bh);
    const clamped = clampAnchorBubbleInViewport(
      next.left,
      next.top,
      bw,
      bh,
      next.transform,
    );
    const positioned = { ...next, ...clamped };
    if (
      positioned.left === tip.left &&
      positioned.top === tip.top &&
      positioned.placement === tip.placement &&
      positioned.transform === tip.transform
    ) {
      return;
    }
    setTip((current) =>
      current ? { ...current, ...positioned } : current,
    );
  }, [tip?.symbol, tip?.name, tip?.anchorRect]);

  useEffect(
    () => () => {
      clearHideTimer();
      clearShowTimer();
    },
    [clearHideTimer, clearShowTimer],
  );

  useEffect(() => {
    if (!mobile || !tip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTip();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (bubbleRef.current?.contains(target)) return;
      if ((target as Element).closest?.(".stock-vault-tab__row-hover-zone")) return;
      if ((target as Element).closest?.(".sp500-wheel-mini__row-hover-zone")) return;
      if ((target as Element).closest?.(".value-invest-bubble__hover-pop--portal")) return;
      if ((target as Element).closest?.(".stock-share-structure-modal")) return;
      closeTip();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [mobile, tip, closeTip]);

  const bubble =
    tip && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={bubbleRef}
            id={tipId}
            role="tooltip"
            className={bubblePlacementClass(tip.placement)}
            style={{
              left: `${tip.left}px`,
              top: `${tip.top}px`,
              transform: tip.transform,
            }}
            onMouseEnter={
              mobile
                ? undefined
                : () => {
                    keepTipOpen();
                    shareStructure?.keepShareStructureModalOpen();
                  }
            }
            onMouseLeave={mobile ? undefined : scheduleHideTip}
            onClick={handleParentBubbleClick}
          >
            <StockEarningsHoverBubbleBody
              symbol={tip.symbol}
              name={tip.name}
              market={tip.market}
              variant="vault"
              sectorLabel={tip.industry}
              tvChartUrl={tradingViewChartUrl(tip.tvSymbol)}
              price={tip.price}
              currency={tip.currency}
              onAfterAction={() => setTip(null)}
            />
          </div>,
          document.body,
        )
      : null;

  return { tipId, tip, showTip, toggleTip, scheduleHideTip, bubble };
}

/** 말풍선 state를 분리 — 호버 시 StockVaultTab 전체 리렌더 방지 */
export function StockVaultRowBubblePortal({
  actionsRef,
  tipId,
}: {
  actionsRef: MutableRefObject<StockVaultRowBubbleActions | null>;
  tipId: string;
}) {
  const api = useStockVaultRowBubble(tipId);
  actionsRef.current = {
    tipId: api.tipId,
    showTip: api.showTip,
    toggleTip: api.toggleTip,
    scheduleHideTip: api.scheduleHideTip,
  };
  return api.bubble;
}
