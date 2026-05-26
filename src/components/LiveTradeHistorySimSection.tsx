import { useEffect, useMemo, useState } from "react";
import type { LiveTradeProgramReturnSummary } from "../api";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { filterSimPrograms } from "../lib/liveTradeSimPrograms";
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
  const simPrograms = useMemo(
    () => filterSimPrograms(programsProp ?? status?.programs ?? []),
    [programsProp, status?.programs],
  );
  const programReturns = programReturnsProp ?? status?.programReturns ?? {};
  const [programId, setProgramId] = useState("");

  useEffect(() => {
    if (simPrograms.length === 0) {
      setProgramId("");
      return;
    }
    if (!programId || !simPrograms.some((p) => p.id === programId)) {
      setProgramId(simPrograms[0].id);
    }
  }, [simPrograms, programId]);

  const selectedName = useMemo(
    () => simPrograms.find((p) => p.id === programId)?.name ?? null,
    [simPrograms, programId],
  );

  const programReturnPct =
    programId && programReturns[programId]
      ? programReturns[programId].totalReturnPct
      : null;

  if (simPrograms.length === 0) {
    return (
      <p className="live-trade-history__muted">{ko.app.liveTradeSimHistoryEmpty}</p>
    );
  }

  return (
    <div className="live-trade-history-sim-section">
      <LiveTradeHistorySimProgramTabs
        programs={simPrograms}
        programReturns={programReturns}
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
