import { useState, type ReactNode } from "react";
import { ko } from "../i18n/ko";

export type TossMyStockSummaryRow = {
  label: string;
  value: ReactNode;
  tone?: "up" | "down" | "flat";
};

export type TossProfitToggle = {
  gross: Pick<TossMyStockSummaryRow, "value" | "tone">;
  net: Pick<TossMyStockSummaryRow, "value" | "tone">;
};

export default function TossMyStockSummaryCard({
  title,
  meta,
  rows,
  feeTaxRows = [],
  showFeeTaxLink = false,
  profitToggle,
  onTitleClick,
}: {
  title: string;
  meta?: ReactNode;
  rows: TossMyStockSummaryRow[];
  feeTaxRows?: TossMyStockSummaryRow[];
  showFeeTaxLink?: boolean;
  /** 수수료·세금 토글 시 총 수익 금액·% 전환 (ON=순, OFF=총액) */
  profitToggle?: TossProfitToggle;
  onTitleClick?: () => void;
}) {
  const [feeTaxOn, setFeeTaxOn] = useState(true);
  const displayRows = rows.map((row, idx) => {
    if (idx !== 0 || !showFeeTaxLink || !profitToggle) return row;
    const variant = feeTaxOn ? profitToggle.net : profitToggle.gross;
    return { ...row, value: variant.value, tone: variant.tone };
  });
  const visibleRows = [
    ...displayRows,
    ...(showFeeTaxLink && feeTaxOn ? feeTaxRows : []),
  ];

  return (
    <article className="toss-my-stock-card">
      <header className="toss-my-stock-card__head">
        {onTitleClick ? (
          <button
            type="button"
            className="toss-my-stock-card__title-btn"
            onClick={onTitleClick}
          >
            <h4 className="toss-my-stock-card__title">{title}</h4>
          </button>
        ) : (
          <h4 className="toss-my-stock-card__title">{title}</h4>
        )}
        {meta ? <div className="toss-my-stock-card__meta">{meta}</div> : null}
      </header>
      <dl className="toss-my-stock-card__rows">
        {visibleRows.map((row, idx) => (
          <div
            key={`${row.label}-${idx}`}
            className={`toss-my-stock-card__row${
              idx === 0 && showFeeTaxLink ? " toss-my-stock-card__row--profit" : ""
            }`}
          >
            <dt className="toss-my-stock-card__label">{row.label}</dt>
            <dd
              className={[
                "toss-my-stock-card__value",
                row.tone === "up"
                  ? "toss-my-stock-card__value--up"
                  : row.tone === "down"
                    ? "toss-my-stock-card__value--down"
                    : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {row.value}
            </dd>
            {idx === 0 && showFeeTaxLink ? (
              <button
                type="button"
                className={[
                  "toss-my-stock-card__fee-tax",
                  feeTaxOn
                    ? "toss-my-stock-card__fee-tax--on"
                    : "toss-my-stock-card__fee-tax--off",
                ].join(" ")}
                aria-pressed={feeTaxOn}
                aria-label={`${ko.app.tossMyStockFeeTaxLink} ${feeTaxOn ? "켜짐" : "꺼짐"}`}
                onClick={() => setFeeTaxOn((v) => !v)}
              >
                <span className="toss-my-stock-card__fee-tax-icon" aria-hidden>
                  {feeTaxOn ? (
                    <svg viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="8" fill="currentColor" />
                      <path
                        d="M4.6 8.2 6.9 10.5 11.4 6"
                        stroke="#fff"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="none">
                      <circle
                        cx="8"
                        cy="8"
                        r="6.25"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                  )}
                </span>
                {ko.app.tossMyStockFeeTaxLink}
              </button>
            ) : null}
          </div>
        ))}
      </dl>
    </article>
  );
}
