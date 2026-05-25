import { useMemo } from "react";
import type { LiveTradeHolding } from "../api";
import { formatLiveTradeQuantity, formatPercent, formatPrice, formatSignedMoney } from "../lib/format";
import { liveTradeHoldingMatchesExchange } from "../lib/liveTradeTradesExchangeFilter";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";
import { ko } from "../i18n/ko";
import { LiveHoldingChartSymbol } from "./LiveTradeHoldingDisplay";

export default function LiveAccountHoldingsTable({
  exchange,
  holdings,
  onOpenHoldingChart,
}: {
  exchange: LiveTradeTradesExchange;
  holdings: LiveTradeHolding[];
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
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
    <div className="live-account-holdings">
      <h3 className="live-account-holdings__title">{ko.app.liveTradePfTabHoldings}</h3>
      <div className="live-sim-run__table-wrap live-account-holdings__table-wrap">
        <table className="live-sim-run__table live-sim-run__table--stacked live-account-holdings__table">
          <thead>
            <tr>
              <th>{ko.app.liveTradePfColSymbol}</th>
              <th>{ko.app.liveTradePfColQty}</th>
              <th>{ko.app.liveTradePfColBuyPrice}</th>
              <th>{ko.app.liveTradePfColCurrent}</th>
              <th>{ko.app.liveTradePfColCostBasis}</th>
              <th>{ko.app.liveTradePfEval}</th>
              <th>{ko.app.liveTradePfColPnl}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const chgUp = (h.changePct ?? 0) >= 0;
              const pnlUp = (h.unrealizedPnl ?? 0) >= 0;
              return (
                <tr key={`${h.programId}:${h.market}:${h.symbol}`}>
                  <td data-label={ko.app.liveTradePfColSymbol}>
                    <LiveHoldingChartSymbol
                      holding={h}
                      onOpen={onOpenHoldingChart}
                    />
                  </td>
                  <td className="live-sim-run__num" data-label={ko.app.liveTradePfColQty}>
                    {formatLiveTradeQuantity(h.quantity, h.market)}
                  </td>
                  <td className="live-sim-run__num" data-label={ko.app.liveTradePfColBuyPrice}>
                    {h.avgEntryPrice > 0
                      ? formatPrice(h.avgEntryPrice, h.currency)
                      : "—"}
                  </td>
                  <td className="live-sim-run__num" data-label={ko.app.liveTradePfColCurrent}>
                    {h.currentPrice != null ? (
                      <>
                        {formatPrice(h.currentPrice, h.currency)}
                        {h.changePct != null ? (
                          <span
                            className={
                              chgUp
                                ? "live-sim-run__quote-1m live-sim-run__num--up"
                                : "live-sim-run__quote-1m live-sim-run__num--down"
                            }
                          >
                            {formatPercent(h.changePct)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="live-sim-run__num" data-label={ko.app.liveTradePfColCostBasis}>
                    {h.costBasis > 0
                      ? formatPrice(h.costBasis, h.currency)
                      : "—"}
                  </td>
                  <td className="live-sim-run__num" data-label={ko.app.liveTradePfEval}>
                    {h.marketValue != null
                      ? formatPrice(h.marketValue, h.currency)
                      : "—"}
                  </td>
                  <td
                    className={
                      h.unrealizedPnl == null
                        ? "live-sim-run__num"
                        : pnlUp
                          ? "live-sim-run__num live-sim-run__num--up"
                          : "live-sim-run__num live-sim-run__num--down"
                    }
                    data-label={ko.app.liveTradePfColPnl}
                  >
                    {h.unrealizedPnl != null
                      ? formatSignedMoney(h.unrealizedPnl, h.currency)
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
