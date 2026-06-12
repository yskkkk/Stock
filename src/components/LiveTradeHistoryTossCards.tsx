import { useMemo } from "react";
import type { LiveTradeRecord } from "../api";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { ko } from "../i18n/ko";
import {
  formatLiveTradeQuantity,
  formatPercent,
  formatPrice,
  formatSignedMoney,
} from "../lib/format";
import { feeByMarketFromStatus } from "../lib/liveTradeFeeByMarket";
import { tradeFillDisplayByTradeId } from "../lib/liveTradeBuySellPrices";
import { formatTradeSideLabel } from "../lib/liveTradeSideDisplay";
import type { LiveTradeMarket } from "../types";
import {
  estimateSaleTaxAmount,
  estimateSellFeeAmount,
  roundTripFeeForMarket,
} from "../lib/tossTradeCardEstimates";
import TossMyStockSummaryCard, {
  type TossMyStockSummaryRow,
} from "./TossMyStockSummaryCard";

function formatTs(ms: number, withYear = false): string {
  if (!Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      year: withYear ? "numeric" : undefined,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function qtyWithUnit(qty: number, market: LiveTradeMarket): string {
  const n = formatLiveTradeQuantity(qty, market);
  if (market === "crypto") return n;
  return `${n}${ko.app.tossMyStockQtyUnit}`;
}

function estMoney(amount: number, currency?: string): string {
  return `${formatPrice(amount, currency)} ${ko.app.tossMyStockEstSuffix}`;
}

export default function LiveTradeHistoryTossCards({
  trades,
  loadAll,
}: {
  trades: LiveTradeRecord[];
  loadAll: boolean;
}) {
  const status = useLiveTradingStatusPoll();
  const feeByMarket = useMemo(
    () => feeByMarketFromStatus(status?.feeRates),
    [status?.feeRates],
  );
  const tradeFill = useMemo(
    () => tradeFillDisplayByTradeId(trades),
    [trades],
  );
  const nameBySymbol = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of trades) {
      const nm = String(t.name ?? "").trim();
      if (nm) m.set(t.symbol.toUpperCase(), nm);
    }
    return m;
  }, [trades]);

  return (
    <div className="toss-my-stock-card-list">
      {trades.map((t) => {
        const fd = tradeFill.get(t.id);
        const name =
          nameBySymbol.get(t.symbol.toUpperCase()) ??
          String(t.name ?? "").trim() ||
          t.symbol;
        const roundTrip = roundTripFeeForMarket(t.market, feeByMarket);
        const gross = t.amount;
        const fee =
          t.feeAmount != null && Number.isFinite(t.feeAmount)
            ? t.feeAmount
            : estimateSellFeeAmount(gross, roundTrip);
        const rows: TossMyStockSummaryRow[] = [];

        if (t.side === "sell" && fd?.realizedPnl != null) {
          const up = fd.realizedPnl >= 0;
          const pct =
            fd.realizedPnlPct != null
              ? ` (${formatPercent(fd.realizedPnlPct)})`
              : "";
          rows.push({
            label: ko.app.tossMyStockTotalProfit,
            value: `${formatSignedMoney(fd.realizedPnl, t.currency)}${pct}`,
            tone: up ? "up" : "down",
          });
        } else if (t.side === "sell") {
          rows.push({
            label: ko.app.tossMyStockTotalProfit,
            value: "—",
            tone: "flat",
          });
        }

        rows.push({
          label: ko.app.tossMyStockTotalAmount,
          value: formatPrice(gross, t.currency),
        });
        rows.push({
          label: ko.app.tossMyStockQty,
          value: qtyWithUnit(t.quantity, t.market),
        });
        rows.push({
          label: ko.app.tossMyStockAvgPerShare,
          value: formatPrice(t.price, t.currency),
        });
        rows.push({
          label: ko.app.tossMyStockFee,
          value: estMoney(fee, t.currency),
        });

        if (t.side === "sell") {
          const tax = estimateSaleTaxAmount(gross, t.market);
          if (tax > 0) {
            rows.push({
              label: ko.app.tossMyStockSaleTax,
              value: estMoney(tax, t.currency),
            });
          }
        }

        return (
          <TossMyStockSummaryCard
            key={t.id}
            title={name}
            meta={
              <>
                <span className="toss-my-stock-card__side">{formatTradeSideLabel(t)}</span>
                <span className="toss-my-stock-card__time">{formatTs(t.atMs, loadAll)}</span>
              </>
            }
            rows={rows}
            showFeeTaxLink={t.side === "sell"}
          />
        );
      })}
    </div>
  );
}
