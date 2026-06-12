import type { LiveTradeHolding } from "../api";
import { useOptionalValueInvestBubble } from "../contexts/ValueInvestBubbleContext";
import { ko } from "../i18n/ko";
import {
  holdingToValueInvestTarget,
  isStockHoldingMarket,
} from "../lib/valueInvestBubbleTarget";

export default function HoldingBuffettButton({
  holding,
  className = "live-holding-buffett-btn",
}: {
  holding: LiveTradeHolding;
  className?: string;
}) {
  const valueInvest = useOptionalValueInvestBubble();
  if (!valueInvest || !isStockHoldingMarket(holding.market)) return null;

  const label = holding.name?.trim() || holding.symbol;
  const target = holdingToValueInvestTarget(holding);

  return (
    <button
      type="button"
      className={className}
      aria-label={`${label} ${ko.valueInvest.bubbleAria}`}
      title={ko.valueInvest.bubbleAria}
      onClick={(e) => {
        e.stopPropagation();
        valueInvest.showValueInvestBubble(
          e.currentTarget,
          target,
          { clientX: e.clientX, clientY: e.clientY },
        );
      }}
    >
      {ko.stockVault.bubbleBtnBuffett}
    </button>
  );
}
