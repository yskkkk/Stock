import type { ExchangeAccountPnlSummary } from "../lib/exchangeAccountPnlSummary";
import { formatPercent } from "../lib/format";
import { ko } from "../i18n/ko";

export default function LiveAccountPnlSummaryBar({
  summary,
}: {
  summary: ExchangeAccountPnlSummary;
}) {
  const retUp = summary.totalReturnPct != null && summary.totalReturnPct >= 0;
  const realUp = summary.realizedPnl >= 0;
  const unrealUp = summary.unrealizedPnl >= 0;

  return (
    <div className="live-trade-history__pnl-summary live-account-pnl-summary" role="status">
      <div className="live-trade-history__pnl-row">
        <span className="live-trade-history__pnl-label">
          {ko.app.liveTradeHistoryTotalReturn}
        </span>
        <span
          className={
            summary.totalReturnPct == null
              ? "live-trade-history__pnl-val"
              : retUp
                ? "live-trade-history__pnl-val live-trade-history__pnl-val--up"
                : "live-trade-history__pnl-val live-trade-history__pnl-val--down"
          }
        >
          {summary.totalReturnPct == null ? "—" : formatPercent(summary.totalReturnPct)}
        </span>
      </div>
      <div className="live-trade-history__pnl-row">
        <span className="live-trade-history__pnl-label">
          {ko.app.liveTradePfColRealizedPnl}
        </span>
        <span
          className={
            realUp
              ? "live-trade-history__pnl-val live-trade-history__pnl-val--up"
              : "live-trade-history__pnl-val live-trade-history__pnl-val--down"
          }
        >
          {summary.realizedLabel}
        </span>
      </div>
      <div className="live-trade-history__pnl-row">
        <span className="live-trade-history__pnl-label">
          {ko.app.liveTradePfUnrealized}
        </span>
        <span
          className={
            unrealUp
              ? "live-trade-history__pnl-val live-trade-history__pnl-val--up"
              : "live-trade-history__pnl-val live-trade-history__pnl-val--down"
          }
        >
          {summary.unrealizedLabel}
        </span>
      </div>
    </div>
  );
}
