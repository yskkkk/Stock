import type { LiveTradeHolding } from "../api";
import {
  formatLiveTradeQuantity,
  formatPercent,
  formatPrice,
  formatSignedMoney,
} from "../lib/format";
import { ko } from "../i18n/ko";
import { LiveTradeSymbolCell } from "./LiveTradeSymbolCell";

export default function LiveTradeProgramHoldingsMini({
  holdings,
  loading,
}: {
  holdings: LiveTradeHolding[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <p className="live-trade-history__muted live-trade-program-holdings__loading">
        {ko.app.liveTradePfLoading}
      </p>
    );
  }
  if (holdings.length === 0) {
    return (
      <p className="live-trade-history__muted live-trade-program-holdings__empty">
        {ko.app.liveTradeHistorySimNoHoldings}
      </p>
    );
  }
  return (
    <div className="live-trade-program-holdings">
      <h6 className="live-trade-program-holdings__title">
        {ko.app.liveTradeHistorySimHoldingsTitle}
      </h6>
      <ul className="live-trade-program-holdings__list">
        {holdings.map((h) => {
          const chg =
            h.changePct != null && Number.isFinite(h.changePct)
              ? h.changePct
              : null;
          return (
            <li key={`${h.programId}:${h.symbol}:${h.market}`} className="live-trade-program-holdings__row">
              <LiveTradeSymbolCell
                symbol={h.symbol}
                name={h.name}
                market={h.market}
              />
              <span className="live-trade-program-holdings__qty">
                {formatLiveTradeQuantity(h.quantity, h.market)}
              </span>
              <span className="live-trade-program-holdings__px">
                {h.currentPrice != null
                  ? formatPrice(h.currentPrice, h.currency)
                  : formatPrice(h.avgEntryPrice, h.currency)}
              </span>
              <span
                className={
                  chg == null
                    ? "live-trade-program-holdings__chg"
                    : chg >= 0
                      ? "live-trade-program-holdings__chg live-trade-program-holdings__chg--up"
                      : "live-trade-program-holdings__chg live-trade-program-holdings__chg--down"
                }
              >
                {chg != null ? formatPercent(chg) : "—"}
              </span>
              <span className="live-trade-program-holdings__pnl">
                {h.unrealizedPnl != null
                  ? formatSignedMoney(h.unrealizedPnl, h.currency)
                  : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
