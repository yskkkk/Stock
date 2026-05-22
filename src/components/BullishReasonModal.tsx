import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { resolvePickSignalIds } from "../constants/signalChips";
import {
  meetsConditionThreshold,
  minConditionsRequired,
  SIGNAL_CONDITION_TOTAL,
} from "../constants/signals";
import { displayStockSymbol } from "../lib/format";
import { weightedScoreFromSignalIds } from "../lib/techScore";
import PickQuoteStrip from "./PickQuoteStrip";
import type { StockPick } from "../types";

interface BullishReasonModalProps {
  pick: StockPick;
  onClose: () => void;
}

export default function BullishReasonModal({
  pick,
  onClose,
}: BullishReasonModalProps) {
  const reasons = pick.bullishReasons ?? [];
  const subtitle = useMemo(() => {
    const met = resolvePickSignalIds(pick).length;
    const ids = resolvePickSignalIds(pick);
    const wScore = ids.length > 0 ? weightedScoreFromSignalIds(ids) : pick.score;
    const minMet = minConditionsRequired();
    const pass = meetsConditionThreshold(met);
    const status = pass
      ? "스크리너 충족"
      : `미달 ${met}/${minMet}`;
    return `${displayStockSymbol(pick.symbol)} · ${wScore}점 · ${met}/${SIGNAL_CONDITION_TOTAL} 신호 · ${status}`;
  }, [pick]);

  useEffect(() => {
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
  }, [onClose]);

  return createPortal(
    <div
      className="news-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="news-modal card reason-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="news-modal-header">
          <div>
            <h2 id="reason-modal-title">{pick.name}</h2>
            <p className="news-modal-sub">{subtitle} · 기술 근거</p>
          </div>
          <button
            type="button"
            className="news-modal-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>

        <div className="news-modal-body">
          <PickQuoteStrip
            className="reason-summary"
            symbol={pick.symbol}
            price={pick.price}
            currency={pick.currency}
            changePercent={pick.changePercent}
            size="md"
          />

          {reasons.length === 0 ? (
            <p className="news-modal-status">상승 근거를 준비하지 못했습니다.</p>
          ) : (
            <ol className="reason-list">
              {reasons.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ol>
          )}

        </div>
      </div>
    </div>,
    document.body,
  );
}
