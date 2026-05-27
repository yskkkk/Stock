import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import { liveTradeHistoryScenarioSub } from "./LiveTradeHistoryScenarioTabs";
import type { LiveTradeProgramTradesMainDetail } from "../lib/liveTradeProgramTradesMain";
import { ko } from "../i18n/ko";

export default function LiveTradeProgramTradesMainWorkspace({
  detail,
  programReturnPct,
  adminViewUserId = null,
  onClose,
}: {
  detail: LiveTradeProgramTradesMainDetail;
  programReturnPct?: number | null;
  adminViewUserId?: string | null;
  onClose: () => void;
}) {
  const { programId, programName, scenario } = detail;

  return (
    <section
      className="live-trade-program-trades-main trade-history-main-workspace card"
      aria-label={`${programName} ${ko.app.liveTradePfTabTrades}`}
    >
      <header className="live-trade-program-trades-main__head trade-history-main-workspace__head">
        <div className="live-trade-program-trades-main__title-row">
          <h2 className="live-trade-program-trades-main__title live-trade-trades-workspace__title">
            {programName}
          </h2>
          <p className="live-trade-program-trades-main__sub live-trade-history__sub">
            {liveTradeHistoryScenarioSub(scenario)} · {ko.app.liveTradePfTabTrades}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm live-trade-program-trades-main__close"
          onClick={onClose}
        >
          {ko.app.liveTradeCardModalClose}
        </button>
      </header>
      <div className="live-trade-program-trades-main__body trade-history-main-workspace__body">
        <LiveTradeTradesHistoryPanel
          workspaceMode
          loadAll
          adminViewUserId={adminViewUserId}
          scenario={scenario}
          programId={programId}
          programName={programName}
          programReturnPct={programReturnPct ?? null}
        />
      </div>
    </section>
  );
}
