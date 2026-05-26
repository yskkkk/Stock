import { memo } from "react";
import { liveTradeHeaderStripArmed, liveTradeHeaderStripSim } from "../i18n/ko";
import {
  pickRunningLivePrograms,
  useLiveTradingStatusPoll,
} from "../hooks/useLiveTradingStatusPoll";
function LiveTradingHeaderStripInner({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading: (programId: string) => void;
}) {
  const status = useLiveTradingStatusPoll();
  const rows = pickRunningLivePrograms(status);
  if (rows.length === 0) return null;

  const armedN = status?.armedCount ?? rows.filter((r) => r.kind === "armed").length;
  const simN = status?.simCount ?? rows.filter((r) => r.kind === "sim").length;

  return (
    <div className="top-bar__live-trade">
      <div
        className="scan-status scan-status--compact scan-status--bar live-trade-header-strip"
        role="status"
      >
        <div className="scan-status__primary live-trade-header-strip__primary">
          <span className="scan-status__msg live-trade-header-strip__msg">
            {armedN > 0 ? (
              <span className="live-trade-header-strip__armed">
                <span className="live-trade-header-strip__pulse" aria-hidden />
                <strong>{liveTradeHeaderStripArmed(armedN)}</strong>
              </span>
            ) : null}
            {armedN > 0 && simN > 0 ? (
              <span className="live-trade-header-strip__sep"> · </span>
            ) : null}
            {simN > 0 ? (
              <span>{liveTradeHeaderStripSim(simN)}</span>
            ) : null}
            {rows.length > 0 ? (
              <span className="live-trade-header-strip__names">
                {rows.map(({ program, kind }) => (
                  <button
                    key={program.id}
                    type="button"
                    className={`live-trade-header-strip__chip live-trade-header-strip__chip--${kind}`}
                    title={program.name}
                    onClick={() => onOpenLiveTrading(program.id)}
                  >
                    {program.name}
                  </button>
                ))}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(LiveTradingHeaderStripInner);
