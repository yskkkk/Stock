import type {
  LiveTradeProgram,
  LiveTradeProgramReturnSummary,
} from "../api";
import { formatPercent } from "../lib/format";
import { ko } from "../i18n/ko";

/** 시뮬 거래내역 — 프로그램 선택(드롭다운) */
export default function LiveTradeHistorySimProgramSelect({
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
    <label
      className={`live-trade-history-sim-pick live-trade-history-sim-pick--select ${className}`.trim()}
    >
      <span className="live-trade-history-sim-pick__label">
        {ko.app.liveTradeHistorySimProgramSelect}
      </span>
      <select
        className="input live-trade-history-sim-pick__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ko.app.liveTradeHistoryPickSim}
      >
        {programs.map((p) => {
          const ret = programReturns[p.id]?.totalReturnPct;
          const retOk = ret != null && Number.isFinite(ret);
          const retLabel = retOk ? formatPercent(ret) : "";
          return (
            <option key={p.id} value={p.id}>
              {retLabel ? `${p.name} · ${retLabel}` : p.name}
            </option>
          );
        })}
      </select>
    </label>
  );
}
