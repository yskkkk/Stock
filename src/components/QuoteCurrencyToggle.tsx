import { memo } from "react";
import { ko } from "../i18n/ko";

export interface QuoteCurrencyToggleProps {
  inKrw: boolean;
  onToggle: () => void;
  fxValuationDate?: string | null;
  className?: string;
  /** ₩/$ 만 표시 — 거래대금 상위 제목 옆 */
  iconOnly?: boolean;
  /** true면 현재 표시 통화 아이콘(원→₩, 달러→$). 기본은 누르면 전환될 통화 */
  iconShowsActive?: boolean;
}

function QuoteCurrencyKrwIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6.2 5.2 10 13.4l3.8-8.2"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 8.6h10M5 11.8h10"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
    </svg>
  );
}

function QuoteCurrencyUsdIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="10" cy="10" r="7.1" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M10 5.1v9.8M8.35 6.4c0-.95.77-1.72 1.72-1.72s1.72.77 1.72 1.72-.77 1.72-1.72 1.72H8.35M8.35 13.6c0 .95.77 1.72 1.72 1.72s1.72-.77 1.72-1.72"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function currencyIcon(iconShowsActive: boolean, inKrw: boolean) {
  const showKrw = iconShowsActive ? inKrw : !inKrw;
  const cls = "quote-currency-toggle__svg";
  return showKrw ? (
    <QuoteCurrencyKrwIcon className={cls} />
  ) : (
    <QuoteCurrencyUsdIcon className={cls} />
  );
}

function QuoteCurrencyToggleInner({
  inKrw,
  onToggle,
  fxValuationDate,
  className = "",
  iconOnly = false,
  iconShowsActive = false,
}: QuoteCurrencyToggleProps) {
  const title = inKrw
    ? fxValuationDate
      ? ko.app.quoteCurrencyFxBasis.replace("{date}", fxValuationDate)
      : ko.app.quoteCurrencyShowUsd
    : ko.app.quoteCurrencyShowKrw;

  return (
    <button
      type="button"
      className={[
        "quote-currency-toggle",
        iconOnly ? "quote-currency-toggle--icon-only" : "quote-currency-toggle--labeled",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      title={title}
      aria-label={ko.app.quoteCurrencyToggleAria}
      aria-pressed={inKrw}
    >
      <span className="quote-currency-toggle__icon" aria-hidden>
        {currencyIcon(iconShowsActive, inKrw)}
      </span>
      {iconOnly ? null : (
        <span className="quote-currency-toggle__label">
          {inKrw ? "USD" : "원화"}
        </span>
      )}
    </button>
  );
}

export default memo(QuoteCurrencyToggleInner);
