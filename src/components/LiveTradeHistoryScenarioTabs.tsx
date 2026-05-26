import {
  LIVE_TRADE_HISTORY_SCENARIOS,
  type LiveTradeHistoryScenario,
} from "../lib/liveTradeHistoryScenario";
import { ko } from "../i18n/ko";

const LABEL: Record<LiveTradeHistoryScenario, string> = {
  sim: ko.app.liveTradeHistoryScenarioSim,
  "live-bithumb": ko.app.liveTradeHistoryScenarioBithumb,
  "live-toss": ko.app.liveTradeHistoryScenarioToss,
};

export function liveTradeHistoryScenarioSub(
  scenario: LiveTradeHistoryScenario,
): string {
  if (scenario === "sim") return ko.app.liveTradeHistorySimSub;
  if (scenario === "live-bithumb") return ko.app.liveTradeHistoryBithumbSub;
  return ko.app.liveTradeHistoryTossSub;
}

export default function LiveTradeHistoryScenarioTabs({
  value,
  onChange,
  className = "",
}: {
  value: LiveTradeHistoryScenario;
  onChange: (s: LiveTradeHistoryScenario) => void;
  className?: string;
}) {
  return (
    <div
      className={`live-trade-history-scenario-tabs live-trading-tab__segment ${className}`.trim()}
      role="tablist"
      aria-label={ko.app.liveTradeHistoryScenarioLabel}
    >
      {LIVE_TRADE_HISTORY_SCENARIOS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          className={
            value === id
              ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
              : "live-trading-tab__segment-btn"
          }
          aria-selected={value === id}
          onClick={() => onChange(id)}
        >
          {LABEL[id]}
        </button>
      ))}
    </div>
  );
}
