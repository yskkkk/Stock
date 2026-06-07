import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ko } from "../i18n/ko";
import { dispatchOpenFinancialsTab } from "../lib/openFinancialsTab";
import {
  formatVaultIndustryFinancialLines,
  vaultIndustryFinVerdictClassName,
} from "../lib/stockVaultIndustryFinancials";
import type { StockVaultIndustryFinancials } from "../types";

const HIDE_DELAY_MS = 120;

export type StockVaultRowBubbleTarget = {
  symbol: string;
  name: string;
  market: "kr" | "us";
  industry: string | null;
  tvChartUrl: string;
  fin: StockVaultIndustryFinancials | null | undefined;
  sectorLeader: boolean;
};

type TipState = StockVaultRowBubbleTarget & {
  left: number;
  top: number;
  placement: "left" | "right";
};

function positionTip(el: HTMLElement): Pick<TipState, "left" | "top" | "placement"> {
  const rect = el.getBoundingClientRect();
  const gap = 10;
  const bubbleW = 280;
  const rightSpace = window.innerWidth - rect.right;
  const placement = rightSpace >= bubbleW + gap ? "right" : "left";
  return {
    left: placement === "right" ? rect.right + gap : rect.left - gap,
    top: rect.top + rect.height / 2,
    placement,
  };
}

export function useStockVaultRowBubble() {
  const tipId = useId();
  const hideTimerRef = useRef<number | null>(null);
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
      setTip({ ...target, ...positionTip(el) });
    },
    [clearHideTimer],
  );

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const bubble =
    tip && typeof document !== "undefined"
      ? createPortal(
          <div
            id={tipId}
            role="tooltip"
            className={
              tip.placement === "left"
                ? "stock-vault-tab__bubble stock-vault-tab__bubble--left"
                : "stock-vault-tab__bubble"
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
                href={tip.tvChartUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setTip(null)}
              >
                TradingView
              </a>
              <button
                type="button"
                className="stock-vault-tab__bubble-btn stock-vault-tab__bubble-btn--fin"
                onClick={() => {
                  dispatchOpenFinancialsTab({
                    symbol: tip.symbol,
                    name: tip.name,
                    market: tip.market,
                  });
                  setTip(null);
                }}
              >
                {ko.stockVault.openFinancialsTab}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return { tipId, tip, showTip, scheduleHideTip, bubble };
}
