import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ko } from "../i18n/ko";
import type { AccountManageDisplayCurrency } from "../hooks/useAccountManageDisplayCurrency";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function WonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="account-currency-slide__svg">
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="13"
        fontWeight="800"
        fill="currentColor"
        fontFamily="system-ui,Segoe UI,sans-serif"
      >
        ₩
      </text>
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="account-currency-slide__svg">
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="14"
        fontWeight="800"
        fill="currentColor"
        fontFamily="system-ui,Segoe UI,sans-serif"
      >
        $
      </text>
    </svg>
  );
}

type Props = {
  value: AccountManageDisplayCurrency;
  onChange: (next: AccountManageDisplayCurrency) => void;
  usdEnabled: boolean;
  usdRateTitle?: string;
};

/** 원화↔달러 — 테마 토글과 같은 슬라이드 스위치 */
export default function AccountCurrencySlideToggle({
  value,
  onChange,
  usdEnabled,
  usdRateTitle,
}: Props) {
  const isUsd = value === "USD";
  const trackRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const thumbWidthRef = useRef(0);
  const dragRef = useRef(false);
  const dragStartRef = useRef<AccountManageDisplayCurrency | null>(null);
  const valueRef = useRef(value);
  const [dragging, setDragging] = useState(false);
  const [dragT, setDragT] = useState(() => (isUsd ? 1 : 0));

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!dragging) setDragT(isUsd ? 1 : 0);
  }, [isUsd, dragging]);

  const currencyFromT = useCallback(
    (t: number): AccountManageDisplayCurrency => {
      if (t >= 0.5) return usdEnabled ? "USD" : "KRW";
      return "KRW";
    },
    [usdEnabled],
  );

  const measureThumbWidth = useCallback(() => {
    const thumb = thumbRef.current;
    if (!thumb) return 0;
    const w = thumb.getBoundingClientRect().width;
    if (w > 0) thumbWidthRef.current = w;
    return thumbWidthRef.current;
  }, []);

  const pointerToT = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return valueRef.current === "USD" ? 1 : 0;
      const tr = track.getBoundingClientRect();
      const cs = getComputedStyle(track);
      const padL = Number.parseFloat(cs.paddingLeft) || 0;
      const padR = Number.parseFloat(cs.paddingRight) || 0;
      const thumbW = thumbWidthRef.current || measureThumbWidth();
      if (thumbW <= 0) return valueRef.current === "USD" ? 1 : 0;
      const minLeft = tr.left + padL;
      const maxLeft = tr.right - padR - thumbW;
      const travel = Math.max(1, maxLeft - minLeft);
      const left = Math.min(maxLeft, Math.max(minLeft, clientX - thumbW / 2));
      return clamp01((left - minLeft) / travel);
    },
    [measureThumbWidth],
  );

  const finishPointer = useCallback(
    (clientX: number) => {
      const nextT = pointerToT(clientX);
      dragRef.current = false;
      dragStartRef.current = null;
      setDragging(false);
      const want = currencyFromT(nextT);
      if (want !== valueRef.current) onChange(want);
      setDragT(want === "USD" ? 1 : 0);
    },
    [currencyFromT, onChange, pointerToT],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    measureThumbWidth();
    dragStartRef.current = valueRef.current;
    dragRef.current = true;
    setDragging(true);
    setDragT(pointerToT(e.clientX));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    setDragT(pointerToT(e.clientX));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!dragRef.current) return;
    finishPointer(e.clientX);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = false;
    setDragging(false);
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (start != null) {
      onChange(start);
      setDragT(start === "USD" ? 1 : 0);
    } else {
      setDragT(valueRef.current === "USD" ? 1 : 0);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (isUsd) onChange("KRW");
    else if (usdEnabled) onChange("USD");
  };

  const thumbT = dragging ? dragT : isUsd ? 1 : 0;
  const previewUsd = thumbT >= 0.5 && usdEnabled;
  const title =
    usdRateTitle?.trim() ||
    (isUsd ? ko.app.accountManageCurrencyKrw : ko.app.accountManageCurrencyUsd);

  return (
    <button
      type="button"
      className={[
        "account-currency-slide",
        isUsd ? "account-currency-slide--usd" : "account-currency-slide--krw",
        dragging ? "account-currency-slide--dragging" : "",
        previewUsd
          ? "account-currency-slide--preview-usd"
          : "account-currency-slide--preview-krw",
        !usdEnabled ? "account-currency-slide--usd-locked" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="switch"
      aria-checked={isUsd}
      aria-label={ko.app.accountManageCurrencyAria}
      title={title}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ touchAction: "none" } as CSSProperties}
    >
      <span ref={trackRef} className="account-currency-slide__track">
        <span
          ref={thumbRef}
          className="account-currency-slide__thumb"
          aria-hidden
          style={
            {
              "--currency-thumb-translate": String(thumbT * 100),
            } as CSSProperties
          }
        />
        <span className="account-currency-slide__icon account-currency-slide__icon--won">
          <WonIcon />
        </span>
        <span
          className={[
            "account-currency-slide__icon account-currency-slide__icon--dollar",
            !usdEnabled ? "is-disabled" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <DollarIcon />
        </span>
      </span>
    </button>
  );
}
