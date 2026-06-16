import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { fetchStockShareStructure } from "../api";
import { ko } from "../i18n/ko";
import { dispatchForceCloseStockHoverBubble } from "../lib/stockHoverBubbleSingleton";
import type { StockShareStructureResponse } from "../types";

const VIEWPORT_PAD = 8;
const GAP = 10;
const EST_W = 300;
const EST_H = 220;

export type StockShareStructureTarget = {
  symbol: string;
  name: string;
  market: "kr" | "us";
};

type Placement = "left" | "right" | "below" | "above";

type OpenState = StockShareStructureTarget & {
  bubbleEl: HTMLElement;
  anchorRect: DOMRectReadOnly;
  left: number;
  top: number;
  placement: Placement;
  transform: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function positionModal(
  anchor: DOMRectReadOnly,
  modalW = EST_W,
  modalH = EST_H,
): Pick<OpenState, "left" | "top" | "placement" | "transform"> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitsRight = anchor.right + GAP + modalW <= vw - VIEWPORT_PAD;
  const fitsLeft = anchor.left - GAP - modalW >= VIEWPORT_PAD;
  const fitsBelow = anchor.bottom + GAP + modalH <= vh - VIEWPORT_PAD;
  const fitsAbove = anchor.top - GAP - modalH >= VIEWPORT_PAD;

  if (fitsRight) {
    return {
      left: anchor.right + GAP,
      top: clamp(
        anchor.top + anchor.height / 2,
        VIEWPORT_PAD + modalH / 2,
        vh - VIEWPORT_PAD - modalH / 2,
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
        VIEWPORT_PAD + modalH / 2,
        vh - VIEWPORT_PAD - modalH / 2,
      ),
      placement: "left",
      transform: "translate(-100%, -50%)",
    };
  }
  if (fitsBelow || (!fitsAbove && anchor.top < vh / 2)) {
    const left = clamp(
      anchor.left + anchor.width / 2,
      VIEWPORT_PAD + modalW / 2,
      vw - VIEWPORT_PAD - modalW / 2,
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
    VIEWPORT_PAD + modalW / 2,
    vw - VIEWPORT_PAD - modalW / 2,
  );
  return {
    left,
    top: anchor.top - GAP,
    placement: "above",
    transform: "translate(-50%, -100%)",
  };
}

function fmtShares(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

type Ctx = {
  showShareStructureModal: (
    anchor: HTMLElement,
    target: StockShareStructureTarget,
  ) => void;
  closeShareStructureModal: () => void;
  openSymbol: string | null;
};

const StockShareStructureBubbleContext = createContext<Ctx | null>(null);

export function useOptionalStockShareStructureBubble(): Ctx | null {
  return useContext(StockShareStructureBubbleContext);
}

export function StockShareStructureBubbleProvider({
  children,
}: {
  children: ReactNode;
}) {
  const modalId = useId();
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<OpenState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<StockShareStructureResponse | null>(
    null,
  );
  const fetchSeq = useRef(0);

  const closeShareStructureModal = useCallback(() => {
    setOpen(null);
    setLoading(false);
    setError(null);
    setPayload(null);
  }, []);

  const showShareStructureModal = useCallback(
    (anchor: HTMLElement, target: StockShareStructureTarget) => {
      const anchorRect = anchor.getBoundingClientRect();
      setOpen({
        ...target,
        bubbleEl: anchor,
        anchorRect,
        ...positionModal(anchorRect),
      });
      setLoading(true);
      setError(null);
      setPayload(null);

      const seq = ++fetchSeq.current;
      void (async () => {
        try {
          const data = await fetchStockShareStructure(target.symbol, {
            market: target.market,
          });
          if (seq !== fetchSeq.current) return;
          setPayload(data);
        } catch (err: unknown) {
          if (seq !== fetchSeq.current) return;
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (seq === fetchSeq.current) setLoading(false);
        }
      })();
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open || !modalRef.current) return;
    const modal = modalRef.current;
    const mw = modal.offsetWidth;
    const mh = modal.offsetHeight;
    if (!mw || !mh) return;
    const next = positionModal(open.anchorRect, mw, mh);
    if (
      next.left === open.left &&
      next.top === open.top &&
      next.placement === open.placement &&
      next.transform === open.transform
    ) {
      return;
    }
    setOpen((current) => (current ? { ...current, ...next } : current));
  }, [open?.symbol, open?.name, open?.anchorRect, payload, loading, error]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeShareStructureModal();
        dispatchForceCloseStockHoverBubble();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeShareStructureModal]);

  useEffect(() => {
    if (!open) return;
    const bubbleEl = open.bubbleEl;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (modalRef.current?.contains(target)) return;
      if (bubbleEl.contains(target)) return;
      closeShareStructureModal();
      dispatchForceCloseStockHoverBubble();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, closeShareStructureModal]);

  const code = open?.symbol.replace(/^KR_/i, "") ?? "";
  const rows = payload
    ? [
        {
          key: "total",
          label: ko.stockVault.shareStructureTotal,
          value: fmtShares(payload.totalShares),
        },
        {
          key: "major",
          label: ko.stockVault.shareStructureMajor,
          value: fmtShares(payload.majorShareholderShares),
        },
        {
          key: "float",
          label: ko.stockVault.shareStructureFloat,
          value: fmtShares(payload.floatShares),
        },
        {
          key: "floatPct",
          label: ko.stockVault.shareStructureFloatPct,
          value:
            payload.floatPct != null && Number.isFinite(payload.floatPct)
              ? `${payload.floatPct.toFixed(2)}%`
              : null,
        },
      ].filter((row) => row.value != null)
    : [];

  const modal =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={modalRef}
            id={modalId}
            role="dialog"
            aria-labelledby={`${modalId}-title`}
            className="stock-share-structure-modal"
            style={{
              left: `${open.left}px`,
              top: `${open.top}px`,
              transform: open.transform,
            }}
          >
            <div className="stock-share-structure-modal__head">
              <div>
                <p id={`${modalId}-title`} className="stock-share-structure-modal__name">
                  {open.name}
                </p>
                <p className="stock-share-structure-modal__sym">{code}</p>
              </div>
              <button
                type="button"
                className="stock-share-structure-modal__close"
                aria-label={ko.stockVault.shareStructureClose}
                onClick={closeShareStructureModal}
              >
                ×
              </button>
            </div>
            {loading ? (
              <p className="stock-share-structure-modal__loading">
                {ko.stockVault.shareStructureLoading}
              </p>
            ) : error ? (
              <p className="stock-share-structure-modal__error">
                {error || ko.stockVault.shareStructureError}
              </p>
            ) : rows.length ? (
              <dl className="stock-share-structure-modal__rows">
                {rows.map((row) => (
                  <div key={row.key} className="stock-share-structure-modal__row">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="stock-share-structure-modal__muted">
                {ko.stockVault.shareStructureError}
              </p>
            )}
          </div>,
          document.body,
        )
      : null;

  const ctx = useMemo(
    () => ({
      showShareStructureModal,
      closeShareStructureModal,
      openSymbol: open?.symbol ?? null,
    }),
    [showShareStructureModal, closeShareStructureModal, open?.symbol],
  );

  return (
    <StockShareStructureBubbleContext.Provider value={ctx}>
      {children}
      {modal}
    </StockShareStructureBubbleContext.Provider>
  );
}
