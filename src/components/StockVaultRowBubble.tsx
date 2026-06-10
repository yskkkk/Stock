import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ko } from "../i18n/ko";
import { dispatchOpenFinancialsTab } from "../lib/openFinancialsTab";
import { tradingViewChartUrl } from "../lib/tradingviewSymbols";
import {
  formatVaultIndustryFinancialLines,
  vaultIndustryFinVerdictClassName,
} from "../lib/stockVaultIndustryFinancials";
import type { StockVaultIndustryFinancials } from "../types";

const HIDE_DELAY_MS = 120;
const VIEWPORT_PAD = 8;
const GAP = 10;
const EST_BUBBLE_W = 260;
const EST_BUBBLE_H = 220;

export type StockVaultRowBubbleTarget = {
  symbol: string;
  name: string;
  market: "kr" | "us";
  industry: string | null;
  tvSymbol: string;
  fin: StockVaultIndustryFinancials | null | undefined;
  sectorLeader: boolean;
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
  if (placement === "left") return "stock-vault-tab__bubble stock-vault-tab__bubble--left";
  if (placement === "below") return "stock-vault-tab__bubble stock-vault-tab__bubble--below";
  if (placement === "above") return "stock-vault-tab__bubble stock-vault-tab__bubble--above";
  return "stock-vault-tab__bubble";
}

export function useStockVaultRowBubble() {
  const tipId = useId();
  const hideTimerRef = useRef<number | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHideTip = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      setTip(null);
      hideTimerRef.current = null;
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const showTip = useCallback(
    (el: HTMLElement, target: StockVaultRowBubbleTarget) => {
      clearHideTimer();
      const anchorRect = el.getBoundingClientRect();
      setTip({
        ...target,
        anchorRect,
        ...positionTip(anchorRect),
      });
    },
    [clearHideTimer],
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

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

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
            onMouseEnter={clearHideTimer}
            onMouseLeave={scheduleHideTip}
          >
            <p className="stock-vault-tab__bubble-name">{tip.name}</p>
            <p className="stock-vault-tab__bubble-code">
              {tip.symbol.replace(/^KR_/i, "")}
              {tip.industry ? ` · ${tip.industry}` : ""}
              {tip.sectorLeader ? (
                <span className="stock-vault-tab__bubble-leader">
                  {" "}
                  · {ko.stockVault.sectorLeader}
                </span>
              ) : null}
            </p>
            {tip.fin?.verdictLabel ? (
              <div className="stock-vault-tab__bubble-fin">
                <p className="stock-vault-tab__bubble-fin-title">
                  {ko.stockVault.industryFinTitle}
                  {tip.fin.peerGroup ? ` · ${tip.fin.peerGroup}` : ""}
                </p>
                <div className="stock-vault-tab__bubble-peer">
                  <span
                    className={`stock-vault-tab__fin-badge ${vaultIndustryFinVerdictClassName(tip.fin.verdict)}`}
                  >
                    {tip.fin.verdictLabel}
                  </span>
                  {tip.fin.verdictDetail ? (
                    <p className="stock-vault-tab__bubble-fin-detail">
                      {tip.fin.verdictDetail}
                    </p>
                  ) : null}
                </div>
                {(() => {
                  const lines = formatVaultIndustryFinancialLines(tip.fin, {
                    per: ko.financials.per.replace(/\s*\(.+\)\s*$/, ""),
                    roe: ko.financials.roe,
                    profitMargin: ko.financials.profitMargin,
                    peerCount: ko.stockVault.industryFinPeerCount,
                  });
                  return (
                    <>
                      <p className="stock-vault-tab__bubble-fin-line">{lines.metricLine}</p>
                      {lines.peerLine ? (
                        <p className="stock-vault-tab__bubble-fin-muted">{lines.peerLine}</p>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : (
              <p className="stock-vault-tab__bubble-fin-muted">
                {ko.stockVault.industryFinLoading}
              </p>
            )}
            <div className="stock-vault-tab__bubble-actions">
              <a
                className="stock-vault-tab__bubble-btn stock-vault-tab__bubble-btn--tv"
                href={tradingViewChartUrl(tip.tvSymbol)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${tip.name} ${ko.stockVault.openTradingViewChart}`}
                onClick={() => setTip(null)}
              >
                {ko.stockVault.bubbleBtnChart}
              </a>
              <button
                type="button"
                className="stock-vault-tab__bubble-btn stock-vault-tab__bubble-btn--fin"
                aria-label={`${tip.name} ${ko.stockVault.openFinancialsTab}`}
                onClick={() => {
                  dispatchOpenFinancialsTab({
                    symbol: tip.symbol,
                    name: tip.name,
                    market: tip.market,
                  });
                  setTip(null);
                }}
              >
                {ko.stockVault.bubbleBtnFinancials}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return { tipId, tip, showTip, scheduleHideTip, bubble };
}
