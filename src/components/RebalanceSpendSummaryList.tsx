import type { TossRebalanceBuyPlan } from "../api";
import { ko } from "../i18n/ko";
import { buildRebalanceSpendLines } from "../lib/rebalancePlanSummary";

function currencyBadgeLabel(market: "kr" | "us"): string {
  return market === "us" ? "$" : "원";
}

function marketLabel(market: "kr" | "us"): string {
  return market === "us"
    ? ko.app.accountManageMarketUs
    : ko.app.accountManageMarketKr;
}

export default function RebalanceSpendSummaryList({
  plans,
  enabledMarkets,
  className,
}: {
  plans: TossRebalanceBuyPlan[];
  enabledMarkets: Array<"kr" | "us">;
  className?: string;
}) {
  const lines = buildRebalanceSpendLines(plans, enabledMarkets);
  if (!lines.length) return null;
  return (
    <ul
      className={className ?? "account-rebalance-modal__spend-lines"}
      data-vu="account-rebalance-spend-lines"
    >
      {lines.map((line) => (
        <li
          key={line.market}
          className={[
            "account-rebalance-modal__spend-line",
            line.market === "us" ? "is-usd" : "is-krw",
          ].join(" ")}
        >
          <span
            className={[
              "account-rebalance-modal__badge",
              line.market === "us" ? "is-usd" : "is-krw",
            ].join(" ")}
          >
            {currencyBadgeLabel(line.market)}
          </span>
          <span className="account-rebalance-modal__spend-line-market">
            {marketLabel(line.market)}
          </span>
          <span className="account-rebalance-modal__spend-line-text">
            {ko.app.accountManageRebalanceSpendLine
              .replace("{cashLabel}", line.cashLabel)
              .replace("{spend}", line.spend)}
          </span>
        </li>
      ))}
    </ul>
  );
}
