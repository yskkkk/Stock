import { useEffect } from "react";
import { createPortal } from "react-dom";
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
            <p className="news-modal-sub">
              {pick.symbol} · {pick.score}점 · 상승 유망 근거
            </p>
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

          <p className="reason-disclaimer">
            기술적 분석 기준 추정이며, 투자 판단은 본인 책임입니다.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
