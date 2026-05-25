import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import { LiveTradeExchangePicker } from "./LiveTradeExchangePicker";
import { ko } from "../i18n/ko";
import {
  dispatchLiveTradeTradesWorkspace,
  type LiveTradeTradesWorkspaceState,
} from "../lib/liveTradeTradesWorkspace";

export default function LiveTradeTradesWorkspaceShell({
  state,
}: {
  state: LiveTradeTradesWorkspaceState;
}) {
  if (state.mode === "picker") {
    return (
      <div className="live-trade-trades-workspace live-trade-trades-workspace--picker card">
        <LiveTradeExchangePicker />
      </div>
    );
  }

  const title =
    state.exchange === "toss"
      ? ko.app.liveTradeTossShort
      : ko.app.liveTradeBithumbShort;
  const Mark =
    state.exchange === "toss" ? TossBrandMark : BithumbBrandMark;

  return (
    <div className="live-trade-trades-workspace live-trade-trades-workspace--history card">
      <header className="live-trade-trades-workspace__head">
        <button
          type="button"
          className="live-trade-trades-workspace__back"
          onClick={() => dispatchLiveTradeTradesWorkspace({ mode: "picker" })}
        >
          {ko.app.liveTradeTradesWorkspaceBack}
        </button>
        <div className="live-trade-trades-workspace__title-row">
          <Mark className="live-trade-trades-workspace__mark" />
          <h2 className="live-trade-trades-workspace__title">
            {title} · {ko.app.liveTradePfTabTrades}
          </h2>
        </div>
      </header>
      <LiveTradeTradesHistoryPanel
        exchange={state.exchange}
        workspaceMode
        loadAll
      />
    </div>
  );
}
