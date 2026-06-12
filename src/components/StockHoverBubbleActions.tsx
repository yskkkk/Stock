import { useValueInvestBubble } from "../contexts/ValueInvestBubbleContext";
import { ko } from "../i18n/ko";
import { dispatchOpenFinancialsTab } from "../lib/openFinancialsTab";

type Variant = "vault" | "earnings";

export default function StockHoverBubbleActions({
  variant,
  symbol,
  name,
  market,
  price,
  currency,
  tvChartUrl,
  onAfterAction,
}: {
  variant: Variant;
  symbol: string;
  name: string;
  market: "kr" | "us";
  price?: number | null;
  currency?: string | null;
  tvChartUrl?: string | null;
  onAfterAction?: () => void;
}) {
  const { showValueInvestBubble } = useValueInvestBubble();
  const base =
    variant === "vault"
      ? "stock-vault-tab__bubble-actions"
      : "earnings-icon-rail__bubble-actions";
  const btn = (kind: "tv" | "fin" | "buffett") =>
    variant === "vault"
      ? `stock-vault-tab__bubble-btn stock-vault-tab__bubble-btn--${kind}`
      : `earnings-icon-rail__bubble-btn earnings-icon-rail__bubble-btn--${kind}`;

  const done = () => onAfterAction?.();

  return (
    <div className={base}>
      {tvChartUrl ? (
        <a
          className={btn("tv")}
          href={tvChartUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${name} ${ko.stockVault.openTradingViewChart}`}
          onClick={done}
        >
          {ko.stockVault.bubbleBtnChart}
        </a>
      ) : null}
      <button
        type="button"
        className={btn("fin")}
        aria-label={`${name} ${ko.stockVault.openFinancialsTab}`}
        onClick={() => {
          dispatchOpenFinancialsTab({ symbol, name, market });
          done();
        }}
      >
        {ko.stockVault.bubbleBtnFinancials}
      </button>
      <button
        type="button"
        className={btn("buffett")}
        aria-label={`${name} ${ko.valueInvest.bubbleAria}`}
        title={ko.valueInvest.bubbleAria}
        onClick={(e) => {
          e.stopPropagation();
          showValueInvestBubble(e.currentTarget, {
            symbol,
            name,
            market,
            price: price ?? null,
            currency: currency ?? null,
          });
          done();
        }}
      >
        {ko.stockVault.bubbleBtnBuffett}
      </button>
    </div>
  );
}
