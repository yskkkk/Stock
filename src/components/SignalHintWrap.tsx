import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ko } from "../i18n/ko";

const LONG_PRESS_MS = 480;

function prefersTouchHints() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

type SignalHintWrapProps = {
  hint: string;
  label?: string;
  children: ReactNode;
};

export default function SignalHintWrap({
  hint,
  label,
  children,
}: SignalHintWrapProps) {
  const tipId = useId();
  const [touchOpen, setTouchOpen] = useState(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const touchModeRef = useRef(prefersTouchHints());

  const clearLongPress = useCallback(() => {
    if (longPressRef.current != null) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

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

  return (
    <>
      <span
        className="signal-hint-wrap"
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
        <span id={tipId} role="tooltip" className="signal-hint-wrap__tip">
          {label ? (
            <>
              <strong className="signal-hint-wrap__tip-title">{label}</strong>
              <span className="signal-hint-wrap__tip-body">{hint}</span>
            </>
          ) : (
            hint
          )}
        </span>
      </span>
      {touchOpen ? (
        <div
          className="signal-hint-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={label ? `${tipId}-title` : undefined}
          onClick={() => setTouchOpen(false)}
        >
          <div
            className="signal-hint-modal__card"
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
