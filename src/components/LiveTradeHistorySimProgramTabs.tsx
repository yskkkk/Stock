import type {
  LiveTradeProgram,
  LiveTradeProgramReturnSummary,
} from "../api";
import { formatPercent } from "../lib/format";
import { ko } from "../i18n/ko";

export default function LiveTradeHistorySimProgramTabs({
  programs,
  programReturns = {},
  value,
  onChange,
  className = "",
}: {
  programs: LiveTradeProgram[];
  programReturns?: Record<string, LiveTradeProgramReturnSummary>;
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
      {programs.map((p) => {
        const ret = programReturns[p.id]?.totalReturnPct;
        const retOk = ret != null && Number.isFinite(ret);
        const retLabel = retOk ? formatPercent(ret) : null;
        return (
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
            title={
              retLabel
                ? `${p.name} · ${ko.app.liveTradeHistoryTotalReturn} ${retLabel}`
                : p.name
            }
            onClick={() => onChange(p.id)}
          >
            <span className="live-trade-history-sim-pick__name">{p.name}</span>
            {retLabel ? (
              <span
                className={
                  ret! >= 0
                    ? "live-trade-history-sim-pick__ret live-trade-history-sim-pick__ret--up"
                    : "live-trade-history-sim-pick__ret live-trade-history-sim-pick__ret--down"
                }
              >
                {retLabel}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
