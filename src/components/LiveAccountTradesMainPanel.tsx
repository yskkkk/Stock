import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import { ko } from "../i18n/ko";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";

export default function LiveAccountTradesMainPanel({
  exchange,
}: {
  exchange: LiveTradeTradesExchange;
}) {
  const title =
    exchange === "toss" ? ko.app.liveTradeTossShort : ko.app.liveTradeBithumbShort;
  const Mark = exchange === "toss" ? TossBrandMark : BithumbBrandMark;

  return (
    <div className="trade-history-main-workspace card">
      <header className="trade-history-main-workspace__head">
        <div className="live-trade-trades-workspace__title-row">
          <Mark className="live-trade-trades-workspace__mark" />
          <h2 className="live-trade-trades-workspace__title">
            {title} · {ko.app.liveTradePfTabTrades}
          </h2>
        </div>
      </header>
      <LiveTradeTradesHistoryPanel
        exchange={exchange}
        loadAll
        workspaceMode
      />
    </div>
  );
}
