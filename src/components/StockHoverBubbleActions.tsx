import { useOptionalValueInvestBubble } from "../contexts/ValueInvestBubbleContext";
import { useOptionalStockShareStructureBubble } from "../contexts/StockShareStructureBubbleContext";
import { useIsMobilePhone } from "../hooks/useIsMobilePhone";
import { ko } from "../i18n/ko";
import { dispatchOpenFinancialsTab } from "../lib/openFinancialsTab";
import { openTradingViewChartUrl } from "../lib/openTradingViewChart";

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
  /** 차트·재무제표 등 — 버핏은 실적 말풍선을 유지 */
  onAfterAction?: (action: "chart" | "financials") => void;
}) {
  const valueInvest = useOptionalValueInvestBubble();
  const shareStructure = useOptionalStockShareStructureBubble();
  const mobile = useIsMobilePhone();
  const base =
    variant === "vault"
      ? "stock-vault-tab__bubble-actions"
      : "earnings-icon-rail__bubble-actions";
  const btn = (kind: "tv" | "fin" | "buffett" | "shares") =>
    variant === "vault"
      ? `stock-vault-tab__bubble-btn stock-vault-tab__bubble-btn--${kind}`
      : `earnings-icon-rail__bubble-btn earnings-icon-rail__bubble-btn--${kind}`;

  return (
    <div className={base}>
      {tvChartUrl ? (
        mobile ? (
          <button
            type="button"
            className={btn("tv")}
            aria-label={`${name} ${ko.stockVault.openTradingViewChart}`}
            onClick={() => {
              void openTradingViewChartUrl(tvChartUrl);
              onAfterAction?.("chart");
            }}
          >
            {ko.stockVault.bubbleBtnChart}
          </button>
        ) : (
          <a
            className={btn("tv")}
            href={tvChartUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${name} ${ko.stockVault.openTradingViewChart}`}
            onClick={() => onAfterAction?.("chart")}
          >
            {ko.stockVault.bubbleBtnChart}
          </a>
        )
      ) : null}
      <button
        type="button"
        className={btn("fin")}
        aria-label={`${name} ${ko.stockVault.openFinancialsTab}`}
        onClick={() => {
          dispatchOpenFinancialsTab({ symbol, name, market });
          onAfterAction?.("financials");
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
          if (valueInvest) {
            valueInvest.showValueInvestBubble(
              e.currentTarget,
              {
                symbol,
                name,
                market,
                price: price ?? null,
                currency: currency ?? null,
              },
              { clientX: e.clientX, clientY: e.clientY },
            );
          } else {
            dispatchOpenFinancialsTab({ symbol, name, market });
          }
        }}
      >
        {ko.stockVault.bubbleBtnBuffett}
      </button>
      {shareStructure ? (
        <button
          type="button"
          className={btn("shares")}
          aria-label={`${name} ${ko.stockVault.shareStructureTitle}`}
          title={ko.stockVault.shareStructureTitle}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const bubble =
              e.currentTarget.closest('[role="tooltip"]') ?? e.currentTarget;
            shareStructure.showShareStructureModal(
              bubble instanceof HTMLElement ? bubble : e.currentTarget,
              { symbol, name, market },
            );
          }}
        >
          {ko.stockVault.bubbleBtnShareStructure}
        </button>
      ) : null}
    </div>
  );
}
