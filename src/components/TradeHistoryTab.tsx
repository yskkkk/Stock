import { useState } from "react";
import { LiveTradeExchangePicker } from "./LiveTradeExchangePicker";
import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import { ko } from "../i18n/ko";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";

export default function TradeHistoryTab() {
  const [exchange, setExchange] = useState<LiveTradeTradesExchange | null>(null);

  return (
    <div className="workspace trade-history-workspace">
      <section className="trade-history-workspace__panel card">
        {exchange == null ? (
          <LiveTradeExchangePicker onSelect={setExchange} />
        ) : (
          <>
            <header className="trade-history-workspace__head">
              <button
                type="button"
                className="live-trade-trades-workspace__back"
                onClick={() => setExchange(null)}
              >
                {ko.app.liveTradeTradesWorkspaceBack}
              </button>
              <div className="live-trade-trades-workspace__title-row">
                {exchange === "toss" ? (
                  <TossBrandMark className="live-trade-trades-workspace__mark" />
                ) : (
                  <BithumbBrandMark className="live-trade-trades-workspace__mark" />
                )}
                <h2 className="live-trade-trades-workspace__title">
                  {exchange === "toss"
                    ? ko.app.liveTradeTossShort
                    : ko.app.liveTradeBithumbShort}{" "}
                  · {ko.app.liveTradePfTabTrades}
                </h2>
              </div>
            </header>
            <LiveTradeTradesHistoryPanel
              exchange={exchange}
              loadAll
              workspaceMode
            />
          </>
        )}
      </section>
    </div>
  );
}
