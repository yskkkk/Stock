import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ko } from "../i18n/ko";
import {
  formatInvestorHoldShares,
  formatInvestorNetQty,
  investorNetQtyClass,
} from "../lib/formatInvestorFlow";
import type { KrInvestorFlowHoldingsDetail } from "../types";

type Placement = "left" | "right" | "below" | "above";

export type InvestorFlowHoldBubbleState = {
  symbol: string;
  name: string;
  anchorRect: DOMRectReadOnly;
  left: number;
  top: number;
  placement: Placement;
  transform: string;
};

const VIEWPORT_PAD = 8;
const GAP = 10;
const EST_W = 300;
const EST_H = 280;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function positionInvestorFlowHoldBubble(
  anchor: DOMRectReadOnly,
  bubbleW = EST_W,
  bubbleH = EST_H,
): Pick<
  InvestorFlowHoldBubbleState,
  "left" | "top" | "placement" | "transform"
> {
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
    return { left, top: anchor.bottom + GAP, placement: "below", transform: "translate(-50%, 0)" };
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

function holdLine(
  ratio: number | null | undefined,
  shares: number | null | undefined,
): string {
  const parts: string[] = [];
  if (ratio != null && Number.isFinite(ratio)) {
    parts.push(`${ratio.toFixed(2)}%`);
  }
  if (shares != null && Number.isFinite(shares)) {
    parts.push(formatInvestorHoldShares(shares));
  }
  return parts.length ? parts.join(" · ") : "—";
}

export default function InvestorFlowHoldBubble({
  open,
  loading,
  error,
  detail,
  onClose,
}: {
  open: InvestorFlowHoldBubbleState | null;
  loading: boolean;
  error: string | null;
  detail: KrInvestorFlowHoldingsDetail | null;
  onClose: () => void;
}) {
  const bubbleId = useId();
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const el = bubbleRef.current;
      if (el?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const payload = detail;
  const foreignRatio = payload?.foreignHoldRatio ?? null;
  const foreignShares = payload?.foreignHoldShares ?? null;

  return createPortal(
    <div
      ref={bubbleRef}
      id={bubbleId}
      role="dialog"
      aria-label={ko.investorFlow.holdBubbleAria}
      className={`investor-flow-hold-bubble investor-flow-hold-bubble--${open.placement}`}
      style={{
        left: `${open.left}px`,
        top: `${open.top}px`,
        transform: open.transform,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="investor-flow-hold-bubble__head">
        <div>
          <p className="investor-flow-hold-bubble__name">{open.name}</p>
          <p className="investor-flow-hold-bubble__sym">
            {open.symbol.replace(/\.(KS|KQ)$/i, "")}
          </p>
        </div>
        <button
          type="button"
          className="investor-flow-hold-bubble__close"
          aria-label={ko.investorFlow.holdBubbleClose}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {loading ? (
        <p className="investor-flow-hold-bubble__muted">{ko.investorFlow.holdBubbleLoading}</p>
      ) : null}
      {error ? (
        <p className="investor-flow-hold-bubble__error" role="alert">
          {error}
        </p>
      ) : null}

      {payload && !loading ? (
        <dl className="investor-flow-hold-bubble__list">
          <div>
            <dt>{ko.investorFlow.holdBubbleListed}</dt>
            <dd>{formatInvestorHoldShares(payload.listedShares)}</dd>
          </div>
          <div>
            <dt>{ko.investorFlow.holdBubbleForeignHold}</dt>
            <dd>{holdLine(foreignRatio, foreignShares)}</dd>
          </div>
          <div>
            <dt>{ko.investorFlow.holdBubbleInstitutionNet}</dt>
            <dd className={investorNetQtyClass(payload.institutionNetQty)}>
              {formatInvestorNetQty(payload.institutionNetQty)}
            </dd>
          </div>
          <div>
            <dt>{ko.investorFlow.holdBubbleIndividualNet}</dt>
            <dd className={investorNetQtyClass(payload.individualNetQty)}>
              {formatInvestorNetQty(payload.individualNetQty)}
            </dd>
          </div>
        </dl>
      ) : null}

      {payload && !loading ? (
        <p className="investor-flow-hold-bubble__hint">{ko.investorFlow.holdBubbleNetHint}</p>
      ) : null}
    </div>,
    document.body,
  );
}
