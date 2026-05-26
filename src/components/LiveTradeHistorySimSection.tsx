import { useEffect, useMemo, useState } from "react";
import type { LiveTradeProgramReturnSummary } from "../api";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import LiveTradeHistorySimProgramTabs from "./LiveTradeHistorySimProgramTabs";
import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import { ko } from "../i18n/ko";

export default function LiveTradeHistorySimSection({
  embedded = false,
  workspaceMode = false,
  loadAll = true,
  adminViewUserId = null,
  programs: programsProp,
  programReturns: programReturnsProp,
}: {
  embedded?: boolean;
  workspaceMode?: boolean;
  loadAll?: boolean;
  adminViewUserId?: string | null;
  programs?: { id: string; name: string }[];
  programReturns?: Record<string, LiveTradeProgramReturnSummary>;
}) {
  const status = useLiveTradingStatusPoll();
  const programs = programsProp ?? status?.programs ?? [];
  const programReturns = programReturnsProp ?? status?.programReturns ?? {};
  const [programId, setProgramId] = useState("");

  useEffect(() => {
    if (programs.length === 0) {
      setProgramId("");
      return;
    }
    if (!programId || !programs.some((p) => p.id === programId)) {
      setProgramId(programs[0].id);
    }
  }, [programs, programId]);

  const selectedName = useMemo(
    () => programs.find((p) => p.id === programId)?.name ?? null,
    [programs, programId],
  );

  const programReturnPct =
    programId && programReturns[programId]
      ? programReturns[programId].totalReturnPct
      : null;

  if (programs.length === 0) {
    return (
      <p className="live-trade-history__muted">{ko.app.liveTradeListEmpty}</p>
    );
  }

  return (
    <div className="live-trade-history-sim-section">
      <LiveTradeHistorySimProgramTabs
        programs={programs}
        value={programId}
        onChange={setProgramId}
        className="live-trade-history-sim-section__pick"
      />
      {programId ? (
        <LiveTradeTradesHistoryPanel
          embedded={embedded}
          workspaceMode={workspaceMode}
          loadAll={loadAll}
          adminViewUserId={adminViewUserId}
          scenario="sim"
          programId={programId}
          programName={selectedName}
          programReturnPct={programReturnPct}
        />
      ) : (
        <p className="live-trade-history__muted">
          {ko.app.liveTradeHistoryPickSim}
        </p>
      )}
    </div>
  );
}
