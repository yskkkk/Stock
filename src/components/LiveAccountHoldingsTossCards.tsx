import { useMemo } from "react";
import type { LiveTradeHolding } from "../api";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { ko } from "../i18n/ko";
import {
  formatLiveTradeQuantity,
  formatPercent,
  formatPrice,
  formatSignedMoney,
} from "../lib/format";
import { feeByMarketFromStatus } from "../lib/liveTradeFeeByMarket";
import { liveTradeHoldingMatchesExchange } from "../lib/liveTradeTradesExchangeFilter";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";
import { exchangeSymbolKey } from "../lib/exchangeAccountPnlSummary";
import type { LiveTradeMarket } from "../types";
import {
  estimateSaleTaxAmount,
  estimateSellFeeAmount,
  roundTripFeeForMarket,
} from "../lib/tossTradeCardEstimates";
import { holdingNetReturnPctFromCost } from "../lib/livePortfolioPnl";
import TossMyStockSummaryCard from "./TossMyStockSummaryCard";

function qtyWithUnit(qty: number, market: LiveTradeMarket): string {
  const n = formatLiveTradeQuantity(qty, market);
  if (market === "crypto") return n;
  return `${n}${ko.app.tossMyStockQtyUnit}`;
}

function estMoney(amount: number, currency?: string): string {
  return `${formatPrice(amount, currency)} ${ko.app.tossMyStockEstSuffix}`;
}

export default function LiveAccountHoldingsTossCards({
  exchange,
  holdings,
  cumulativeReturnBySymbol,
}: {
  exchange: LiveTradeTradesExchange;
  holdings: LiveTradeHolding[];
  cumulativeReturnBySymbol?: Map<string, number | null>;
}) {
  const status = useLiveTradingStatusPoll();
  const feeByMarket = useMemo(
    () => feeByMarketFromStatus(status?.feeRates),
    [status?.feeRates],
  );
  const rows = useMemo(
    () => holdings.filter((h) => liveTradeHoldingMatchesExchange(h, exchange)),
    [holdings, exchange],
  );

  if (rows.length === 0) {
    return (
      <p className="live-account-holdings__empty" role="status">
        {ko.app.liveTradePfNoHoldings}
      </p>
    );
  }

  return (
    <div className="live-account-holdings live-account-holdings--toss-cards">
      <h3 className="live-account-holdings__title">{ko.app.liveTradePfTabHoldings}</h3>
      <div className="toss-my-stock-card-list">
        {rows.map((h) => {
          const roundTrip = roundTripFeeForMarket(h.market, feeByMarket);
          const mv = h.marketValue ?? 0;
          const fee = estimateSellFeeAmount(mv, roundTrip);
          const tax = estimateSaleTaxAmount(mv, h.market);
          const cumKey = exchangeSymbolKey(h);
          const cumPct = cumulativeReturnBySymbol?.get(cumKey);
          const retPct =
            cumPct ??
            holdingNetReturnPctFromCost(h.costBasis, h.marketValue, roundTrip);
          const pnl = h.unrealizedPnl;
          const pnlUp = (pnl ?? 0) >= 0;
          const profitValue =
            pnl != null
              ? `${formatSignedMoney(pnl, h.currency)}${
                  retPct != null ? ` (${formatPercent(retPct)})` : ""
                }`
              : "—";

          return (
            <TossMyStockSummaryCard
              key={`${h.programId}:${h.market}:${h.symbol}`}
              title={h.name?.trim() || h.symbol}
              rows={[
                {
                  label: ko.app.tossMyStockTotalProfit,
                  value: profitValue,
                  tone:
                    pnl == null ? "flat" : pnlUp ? "up" : "down",
                },
                {
                  label: ko.app.tossMyStockTotalAmount,
                  value:
                    h.marketValue != null
                      ? formatPrice(h.marketValue, h.currency)
                      : "—",
                },
                {
                  label: ko.app.tossMyStockQty,
                  value: qtyWithUnit(h.quantity, h.market),
                },
                {
                  label: ko.app.tossMyStockAvgPerShare,
                  value:
                    h.avgEntryPrice > 0
                      ? formatPrice(h.avgEntryPrice, h.currency)
                      : "—",
                },
                {
                  label: ko.app.tossMyStockFee,
                  value: estMoney(fee, h.currency),
                },
                ...(tax > 0
                  ? [
                      {
                        label: ko.app.tossMyStockSaleTax,
                        value: estMoney(tax, h.currency),
                      },
                    ]
                  : []),
              ]}
              showFeeTaxLink
            />
          );
        })}
      </div>
    </div>
  );
}
