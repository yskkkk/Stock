import { useState, type ReactNode } from "react";
import { ko } from "../i18n/ko";

export type TossMyStockSummaryRow = {
  label: string;
  value: ReactNode;
  tone?: "up" | "down" | "flat";
};

export default function TossMyStockSummaryCard({
  title,
  meta,
  rows,
  feeTaxRows = [],
  showFeeTaxLink = false,
  onTitleClick,
}: {
  title: string;
  meta?: ReactNode;
  rows: TossMyStockSummaryRow[];
  feeTaxRows?: TossMyStockSummaryRow[];
  showFeeTaxLink?: boolean;
  onTitleClick?: () => void;
}) {
  const [feeTaxOn, setFeeTaxOn] = useState(true);
  const visibleRows = [
    ...rows,
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
                  feeTaxOn ? "toss-my-stock-card__fee-tax--on" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={feeTaxOn}
                onClick={() => setFeeTaxOn((v) => !v)}
              >
                {feeTaxOn ? (
                  <span className="toss-my-stock-card__fee-tax-check" aria-hidden>
                    ✓
                  </span>
                ) : null}
                {ko.app.tossMyStockFeeTaxLink}
              </button>
            ) : null}
          </div>
        ))}
      </dl>
    </article>
  );
}
