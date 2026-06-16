import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import { useOptionalValueInvestBubble } from "../contexts/ValueInvestBubbleContext";
import { useOptionalStockShareStructureBubble } from "../contexts/StockShareStructureBubbleContext";
import StockEarningsHoverBubbleBody from "./StockEarningsHoverBubbleBody";
import { loadEarningsBubbleFinancials } from "../lib/earningsBubbleFinancials";
import { tradingViewChartUrl } from "../lib/tradingviewSymbols";
import {
  dispatchStockHoverBubbleOpen,
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
  scheduleHideTip: () => void;
};

type Placement = "left" | "right" | "below" | "above";

type TipState = StockVaultRowBubbleTarget & {
  anchorRect: DOMRectReadOnly;
  left: number;
  top: number;
  placement: Placement;
  transform: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function positionTip(
  anchor: DOMRectReadOnly,
  bubbleW = EST_BUBBLE_W,
  bubbleH = EST_BUBBLE_H,
): Pick<TipState, "left" | "top" | "placement" | "transform"> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const fitsRight = anchor.right + GAP + bubbleW <= vw - VIEWPORT_PAD;
  const fitsLeft = anchor.left - GAP - bubbleW >= VIEWPORT_PAD;
  const fitsBelow = anchor.bottom + GAP + bubbleH <= vh - VIEWPORT_PAD;
  const fitsAbove = anchor.top - GAP - bubbleH >= VIEWPORT_PAD;

  if (fitsRight) {
    return {
      left: anchor.right + GAP,
      top: clamp(
        anchor.top + anchor.height / 2,
        VIEWPORT_PAD + bubbleH / 2,
        vh - VIEWPORT_PAD - bubbleH / 2,
      ),
      placement: "right",
      transform: "translate(0, -50%)",
    };
  }
  if (fitsLeft) {
    return {
      left: anchor.left - GAP,
      top: clamp(
        anchor.top + anchor.height / 2,
        VIEWPORT_PAD + bubbleH / 2,
        vh - VIEWPORT_PAD - bubbleH / 2,
      ),
      placement: "left",
      transform: "translate(-100%, -50%)",
    };
  }
  if (fitsBelow || (!fitsAbove && anchor.top < vh / 2)) {
    const left = clamp(
      anchor.left + anchor.width / 2,
      VIEWPORT_PAD + bubbleW / 2,
      vw - VIEWPORT_PAD - bubbleW / 2,
    );
    return {
      left,
      top: anchor.bottom + GAP,
      placement: "below",
      transform: "translate(-50%, 0)",
    };
  }
  const left = clamp(
    anchor.left + anchor.width / 2,
    VIEWPORT_PAD + bubbleW / 2,
    vw - VIEWPORT_PAD - bubbleW / 2,
  );
  return {
    left,
    top: anchor.top - GAP,
    placement: "above",
    transform: "translate(-50%, -100%)",
  };
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
    clearShowTimer();
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      shareStructure?.scheduleCloseShareStructureModal();
      const sym = tipRef.current?.symbol;
      if (sym && valueInvest?.openSymbol === sym) return;
      setTip(null);
      hideTimerRef.current = null;
    }, HIDE_DELAY_MS);
  }, [clearHideTimer, clearShowTimer, valueInvest?.openSymbol, shareStructure]);

  const closeTip = useCallback(() => {
    clearShowTimer();
    clearHideTimer();
    shareStructure?.closeShareStructureModal();
    setTip(null);
  }, [clearHideTimer, clearShowTimer, shareStructure]);

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

  useLayoutEffect(() => {
    if (!tip || !bubbleRef.current) return;
    const bubble = bubbleRef.current;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    if (!bw || !bh) return;
    const next = positionTip(tip.anchorRect, bw, bh);
    if (
      next.left === tip.left &&
      next.top === tip.top &&
      next.placement === tip.placement &&
      next.transform === tip.transform
    ) {
      return;
    }
    setTip((current) =>
      current ? { ...current, ...next } : current,
    );
  }, [tip?.symbol, tip?.name, tip?.anchorRect]);

  useEffect(
    () => () => {
      clearHideTimer();
      clearShowTimer();
    },
    [clearHideTimer, clearShowTimer],
  );

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
            onMouseEnter={keepTipOpen}
            onMouseLeave={scheduleHideTip}
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

  return { tipId, tip, showTip, scheduleHideTip, bubble };
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
    scheduleHideTip: api.scheduleHideTip,
  };
  return api.bubble;
}
