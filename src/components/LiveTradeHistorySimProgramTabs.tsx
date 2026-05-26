import type { LiveTradeProgram } from "../api";
import { ko } from "../i18n/ko";

export default function LiveTradeHistorySimProgramTabs({
  programs,
  value,
  onChange,
  className = "",
}: {
  programs: LiveTradeProgram[];
  value: string;
  onChange: (programId: string) => void;
  className?: string;
}) {
  if (programs.length === 0) {
    return (
      <p className="live-trade-history__muted live-trade-history-sim-pick__empty">
        {ko.app.liveTradeListEmpty}
      </p>
    );
  }
  return (
    <div
      className={`live-trade-history-sim-pick live-trading-tab__segment ${className}`.trim()}
      role="tablist"
      aria-label={ko.app.liveTradeHistoryPickSim}
    >
      {programs.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          className={
            value === p.id
              ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
              : "live-trading-tab__segment-btn"
          }
          aria-selected={value === p.id}
          onClick={() => onChange(p.id)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
