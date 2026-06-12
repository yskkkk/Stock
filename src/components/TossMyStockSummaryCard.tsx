import type { ReactNode } from "react";
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
  showFeeTaxLink = false,
  onFeeTaxClick,
}: {
  title: string;
  meta?: ReactNode;
  rows: TossMyStockSummaryRow[];
  showFeeTaxLink?: boolean;
  onFeeTaxClick?: () => void;
}) {
  return (
    <article className="toss-my-stock-card">
      <header className="toss-my-stock-card__head">
        <h4 className="toss-my-stock-card__title">{title}</h4>
        {meta ? <div className="toss-my-stock-card__meta">{meta}</div> : null}
      </header>
      <dl className="toss-my-stock-card__rows">
        {rows.map((row, idx) => (
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
                className="toss-my-stock-card__fee-tax"
                onClick={onFeeTaxClick}
              >
                {ko.app.tossMyStockFeeTaxLink}
              </button>
            ) : null}
          </div>
        ))}
      </dl>
    </article>
  );
}
