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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { fetchStockShareStructure } from "../api";
import { ko } from "../i18n/ko";
import "../stock-share-structure-modal.css";
import {
  dispatchForceCloseStockHoverBubble,
  isInsideStockHoverParentBubble,
  isSameStockBubbleSymbol,
  isStockHoverParentBubbleInteractive,
} from "../lib/stockHoverBubbleSingleton";
import {
  clampAnchorBubbleInViewport,
  positionAnchorBubble,
  type AnchorBubblePlacement,
} from "../lib/viewportAnchorBubblePosition";

const VIEWPORT_PAD = 8;
const GAP = 10;
const EST_W = 300;
const EST_H = 320;

export type StockShareStructureTarget = {
  symbol: string;
  name: string;
  market: "kr" | "us";
};

type Placement = AnchorBubblePlacement;

type OpenState = StockShareStructureTarget & {
  bubbleEl: HTMLElement;
  anchorRect: DOMRectReadOnly;
  left: number;
  top: number;
  placement: Placement;
  transform: string;
  manualPos?: { left: number; top: number } | null;
};

function positionModal(
  anchor: DOMRectReadOnly,
  modalW = EST_W,
  modalH = EST_H,
) {
  return positionAnchorBubble(anchor, modalW, modalH);
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
  keepShareStructureModalOpen: () => void;
  scheduleCloseShareStructureModal: () => void;
  openSymbol: string | null;
};

const SHARE_MODAL_HIDE_DELAY_MS = 420;

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
  const hideTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const openRef = useRef<OpenState | null>(null);
  openRef.current = open;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const closeShareStructureModal = useCallback(() => {
    clearHideTimer();
    setOpen(null);
    setLoading(false);
    setError(null);
    setPayload(null);
  }, [clearHideTimer]);

  const keepShareStructureModalOpen = useCallback(() => {
    clearHideTimer();
  }, [clearHideTimer]);

  const scheduleCloseShareStructureModal = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      if (modalRef.current?.matches(":hover")) {
        hideTimerRef.current = null;
        return;
      }
      const trigger = openRef.current?.bubbleEl;
      if (trigger?.matches(":hover")) {
        hideTimerRef.current = null;
        return;
      }
      closeShareStructureModal();
      hideTimerRef.current = null;
    }, SHARE_MODAL_HIDE_DELAY_MS);
  }, [clearHideTimer, closeShareStructureModal]);

  const showShareStructureModal = useCallback(
    (anchor: HTMLElement, target: StockShareStructureTarget) => {
      if (
        openRef.current &&
        isSameStockBubbleSymbol(openRef.current.symbol, target.symbol)
      ) {
        closeShareStructureModal();
        return;
      }
      clearHideTimer();
      const anchorRect = anchor.getBoundingClientRect();
      setOpen({
        ...target,
        bubbleEl: anchor,
        anchorRect,
        manualPos: null,
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
    [clearHideTimer, closeShareStructureModal],
  );

  useEffect(
    () => () => {
      clearHideTimer();
    },
    [clearHideTimer],
  );

  useLayoutEffect(() => {
    if (!open || !modalRef.current || open.manualPos) return;
    const modal = modalRef.current;
    const mw = modal.offsetWidth;
    const mh = modal.offsetHeight;
    if (!mw || !mh) return;
    const next = positionModal(open.anchorRect, mw, mh);
    const clamped = clampAnchorBubbleInViewport(
      next.left,
      next.top,
      mw,
      mh,
      next.transform,
    );
    const positioned = { ...next, ...clamped };
    if (
      positioned.left === open.left &&
      positioned.top === open.top &&
      positioned.placement === open.placement &&
      positioned.transform === open.transform
    ) {
      return;
    }
    setOpen((current) => (current ? { ...current, ...positioned } : current));
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
      if ((target as Element).closest?.(".value-invest-bubble")) return;

      const onParentBubble =
        bubbleEl.contains(target) || isInsideStockHoverParentBubble(target);

      if (onParentBubble) {
        if (isStockHoverParentBubbleInteractive(target)) return;
        closeShareStructureModal();
        return;
      }

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

  const onHeadPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      const modal = modalRef.current;
      if (!modal) return;
      e.preventDefault();
      keepShareStructureModalOpen();
      const rect = modal.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const originLeft = rect.left;
      const originTop = rect.top;
      draggingRef.current = true;
      setOpen((current) =>
        current
          ? {
              ...current,
              manualPos: { left: originLeft, top: originTop },
              left: originLeft,
              top: originTop,
              transform: "none",
            }
          : current,
      );

      const onMove = (ev: PointerEvent) => {
        const w = modal.offsetWidth;
        const h = modal.offsetHeight;
        const left = clamp(
          originLeft + (ev.clientX - startX),
          VIEWPORT_PAD,
          window.innerWidth - VIEWPORT_PAD - w,
        );
        const top = clamp(
          originTop + (ev.clientY - startY),
          VIEWPORT_PAD,
          window.innerHeight - VIEWPORT_PAD - h,
        );
        setOpen((current) =>
          current
            ? {
                ...current,
                manualPos: { left, top },
                left,
                top,
                transform: "none",
              }
            : current,
        );
      };
      const onUp = () => {
        draggingRef.current = false;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [keepShareStructureModalOpen],
  );

  const code = open?.symbol.replace(/^KR_/i, "").replace(/\.(KS|KQ)$/i, "") ?? "";
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
          key: "treasury",
          label: ko.stockVault.shareStructureTreasury,
          value: fmtShares(payload.treasuryShares),
        },
        {
          key: "lockup",
          label: ko.stockVault.shareStructureLockup,
          value: fmtShares(payload.lockupShares),
        },
        {
          key: "employee",
          label: ko.stockVault.shareStructureEmployee,
          value: fmtShares(payload.employeeStockShares),
        },
        {
          key: "strategic",
          label: ko.stockVault.shareStructureStrategic,
          value: fmtShares(payload.strategicInvestorShares),
        },
        {
          key: "government",
          label: ko.stockVault.shareStructureGovernment,
          value: fmtShares(payload.governmentShares),
        },
        {
          key: "overseasDr",
          label: ko.stockVault.shareStructureOverseasDr,
          value: fmtShares(payload.overseasDrShares),
        },
        {
          key: "otherNonFloat",
          label: ko.stockVault.shareStructureOtherNonFloat,
          value: fmtShares(payload.otherNonFloatShares),
        },
        {
          key: "institutional",
          label: ko.stockVault.shareStructureInstitutional,
          value: fmtShares(payload.institutionalShares),
        },
        {
          key: "institutionalTotalPct",
          label: ko.stockVault.shareStructureInstitutionalTotalPct,
          value:
            payload.institutionalTotalPct != null &&
            Number.isFinite(payload.institutionalTotalPct)
              ? `${payload.institutionalTotalPct.toFixed(2)}%`
              : null,
        },
        {
          key: "institutionalFloatPct",
          label: ko.stockVault.shareStructureInstitutionalFloatPct,
          value:
            payload.institutionalFloatPct != null &&
            Number.isFinite(payload.institutionalFloatPct)
              ? `${payload.institutionalFloatPct.toFixed(2)}%`
              : null,
        },
        {
          key: "institutionCount",
          label: ko.stockVault.shareStructureInstitutionCount,
          value: fmtShares(payload.institutionCount),
        },
        {
          key: "sharesShort",
          label: ko.stockVault.shareStructureShort,
          value: fmtShares(payload.sharesShort),
        },
        {
          key: "shortPct",
          label: ko.stockVault.shareStructureShortPct,
          value:
            payload.shortPctOfFloat != null && Number.isFinite(payload.shortPctOfFloat)
              ? `${payload.shortPctOfFloat.toFixed(2)}%`
              : null,
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
            onMouseEnter={keepShareStructureModalOpen}
            onMouseLeave={() => {
              if (draggingRef.current) return;
              scheduleCloseShareStructureModal();
            }}
          >
            <div
              className="stock-share-structure-modal__head"
              onPointerDown={onHeadPointerDown}
            >
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
      keepShareStructureModalOpen,
      scheduleCloseShareStructureModal,
      openSymbol: open?.symbol ?? null,
    }),
    [
      showShareStructureModal,
      closeShareStructureModal,
      keepShareStructureModalOpen,
      scheduleCloseShareStructureModal,
      open?.symbol,
    ],
  );

  return (
    <StockShareStructureBubbleContext.Provider value={ctx}>
      {children}
      {modal}
    </StockShareStructureBubbleContext.Provider>
  );
}
