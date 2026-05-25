import type { LiveTradeBoxRangePublicBox } from "../api";
import { formatPrice } from "../lib/format";
import { ko } from "../i18n/ko";

function boxStateLabel(state: LiveTradeBoxRangePublicBox["state"]): string {
  switch (state) {
    case "in_position":
      return ko.app.liveTradeBoxStateInPosition;
    case "armed":
      return ko.app.liveTradeBoxStateArmed;
    case "idle":
      return ko.app.liveTradeBoxStateIdle;
    default:
      return state;
  }
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatPrice(n, "KRW");
}

export default function LiveTradeProgramBoxRangeSection({
  boxes,
}: {
  boxes: LiveTradeBoxRangePublicBox[];
}) {
  if (!boxes.length) {
    return (
      <p className="live-trading-tab__box-range-empty">
        {ko.app.liveTradeBoxRangeEmpty}
      </p>
    );
  }

  return (
    <div className="live-trading-tab__box-range">
      <h4 className="live-trading-tab__box-range-title">
        {ko.app.liveTradeBoxRangeActiveTitle}
      </h4>
      <div className="live-sim-run__table-wrap">
        <table className="live-sim-run__table live-sim-run__table--stacked live-trading-tab__box-range-table">
          <thead>
            <tr>
              <th>{ko.app.liveTradeBoxColSymbol}</th>
              <th>{ko.app.liveTradeBoxColTf}</th>
              <th>{ko.app.liveTradeBoxColState}</th>
              <th>{ko.app.liveTradeBoxColEntry}</th>
              <th>{ko.app.liveTradeBoxColTp}</th>
              <th>{ko.app.liveTradeBoxColSl}</th>
              <th>{ko.app.liveTradeBoxColMid}</th>
            </tr>
          </thead>
          <tbody>
            {boxes.map((b) => (
              <tr key={b.boxId}>
                <td data-label={ko.app.liveTradeBoxColSymbol}>{b.symbol}</td>
                <td data-label={ko.app.liveTradeBoxColTf}>{b.timeframe}</td>
                <td data-label={ko.app.liveTradeBoxColState}>
                  <span
                    className={`live-trading-tab__box-state live-trading-tab__box-state--${b.state}`}
                  >
                    {boxStateLabel(b.state)}
                  </span>
                </td>
                <td
                  className="live-sim-run__num"
                  data-label={ko.app.liveTradeBoxColEntry}
                >
                  {b.state === "in_position"
                    ? fmtPx(b.entryPrice)
                    : b.state === "armed"
                      ? fmtPx(b.mid)
                      : "—"}
                </td>
                <td
                  className="live-sim-run__num"
                  data-label={ko.app.liveTradeBoxColTp}
                >
                  {fmtPx(b.takeProfitPrice)}
                </td>
                <td
                  className="live-sim-run__num"
                  data-label={ko.app.liveTradeBoxColSl}
                >
                  {fmtPx(b.stopLossPrice)}
                </td>
                <td
                  className="live-sim-run__num"
                  data-label={ko.app.liveTradeBoxColMid}
                >
                  {fmtPx(b.mid)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
