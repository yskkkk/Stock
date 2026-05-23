import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ko } from "../i18n/ko";

const LONG_PRESS_MS = 480;
const HIDE_DELAY_MS = 140;

function prefersTouchHints() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

type TipPos = {
  left: number;
  top: number;
  placement: "above" | "below";
};

type SignalHintWrapProps = {
  hint: string;
  label?: string;
  children: ReactNode;
};

function measureTipPos(el: HTMLElement): TipPos {
  const r = el.getBoundingClientRect();
  const aboveTop = r.top - 10;
  const placement = aboveTop < 72 ? "below" : "above";
  return {
    left: r.left + r.width / 2,
    top: placement === "above" ? r.top - 10 : r.bottom + 10,
    placement,
  };
}

export default function SignalHintWrap({
  hint,
  label,
  children,
}: SignalHintWrapProps) {
  const tipId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverTip, setHoverTip] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const [tipPos, setTipPos] = useState<TipPos | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const touchModeRef = useRef(prefersTouchHints());

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current != null) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const refreshTipPos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setTipPos(measureTipPos(el));
  }, []);

  const openTip = useCallback(() => {
    if (touchModeRef.current) return;
    clearHideTimer();
    const el = anchorRef.current;
    if (el) setTipPos(measureTipPos(el));
    setHoverTip(true);
  }, [clearHideTimer]);

  const scheduleHideTip = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setHoverTip(false);
      setTipPos(null);
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const showDesktopTip = hoverTip && !touchModeRef.current && tipPos != null;

  useEffect(() => {
    if (!showDesktopTip) return;
    const onScroll = () => refreshTipPos();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [showDesktopTip, refreshTipPos]);

  useEffect(
    () => () => {
      clearHideTimer();
      clearLongPress();
    },
    [clearHideTimer, clearLongPress],
  );

  useEffect(() => {
    if (!touchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTouchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [touchOpen]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!touchModeRef.current || e.pointerType !== "touch") return;
      longPressFiredRef.current = false;
      clearLongPress();
      longPressRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        setTouchOpen(true);
      }, LONG_PRESS_MS);
    },
    [clearLongPress],
  );

  const onPointerUp = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressFiredRef.current = false;
    }
  }, []);

  const onBlur = useCallback((e: ReactFocusEvent<HTMLSpanElement>) => {
    if (touchModeRef.current) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      scheduleHideTip();
    }
  }, [scheduleHideTip]);

  const bubbleTransform =
    tipPos?.placement === "below"
      ? "translate(-50%, 0)"
      : "translate(-50%, -100%)";

  const desktopBubble =
    showDesktopTip && typeof document !== "undefined"
      ? createPortal(
          <div
            id={tipId}
            role="tooltip"
            className={
              tipPos.placement === "below"
                ? "signal-hint-bubble signal-hint-bubble--below"
                : "signal-hint-bubble"
            }
            style={{
              left: `${tipPos.left}px`,
              top: `${tipPos.top}px`,
              transform: bubbleTransform,
            }}
            onMouseEnter={openTip}
            onMouseLeave={scheduleHideTip}
          >
            {hint}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        ref={anchorRef}
        className="signal-hint-wrap"
        aria-describedby={showDesktopTip ? tipId : undefined}
        onMouseEnter={openTip}
        onMouseLeave={scheduleHideTip}
        onFocusCapture={openTip}
        onBlurCapture={onBlur}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        onContextMenu={(e) => {
          if (touchModeRef.current) e.preventDefault();
        }}
      >
        {children}
      </span>
      {desktopBubble}
      {touchOpen ? (
        <div
          className="signal-hint-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={label ? `${tipId}-title` : undefined}
          onClick={() => setTouchOpen(false)}
        >
          <div
            className="signal-hint-modal__card signal-hint-bubble signal-hint-bubble--sheet"
            onClick={(e) => e.stopPropagation()}
          >
            {label ? (
              <p id={`${tipId}-title`} className="signal-hint-modal__title">
                {label}
              </p>
            ) : null}
            <p className="signal-hint-modal__body">{hint}</p>
            <button
              type="button"
              className="btn btn--secondary btn--sm signal-hint-modal__close"
              onClick={() => setTouchOpen(false)}
            >
              {ko.app.signalHintClose}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
