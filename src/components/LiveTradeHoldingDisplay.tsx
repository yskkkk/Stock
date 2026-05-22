import type { LiveTradeHolding } from "../api";
import { SHOW_HOLDING_RATIONALE_ROW } from "../constants/uiFlags";
import { formatPercent, formatPrice } from "../lib/format";
import { netReturnPctFromPrices } from "../lib/netReturn";
import { ko } from "../i18n/ko";

/** 목표·손절가 + 왕복 수수료 반영 손익률 */
export function LiveTradeExitPriceCell({
  entry,
  exitPrice,
  currency,
  variant,
}: {
  entry: number;
  exitPrice: number | null | undefined;
  currency: string;
  variant: "success" | "failure";
}) {
  const pct = netReturnPctFromPrices(entry, exitPrice);
  const label =
    variant === "success"
      ? ko.app.liveTradeExitIfSuccess
      : ko.app.liveTradeExitIfFailure;

  if (exitPrice == null || !Number.isFinite(exitPrice) || exitPrice <= 0) {
    return <span className="live-exit-cell__price">—</span>;
  }

  const pctUp = pct != null && pct >= 0;
  return (
    <span className="live-exit-cell">
      <span className="live-exit-cell__price">{formatPrice(exitPrice, currency)}</span>
      {pct != null ? (
        <span
          className={
            pctUp
              ? "live-exit-cell__pct live-exit-cell__pct--up"
              : "live-exit-cell__pct live-exit-cell__pct--down"
          }
        >
          {label} {formatPercent(pct)}
        </span>
      ) : null}
    </span>
  );
}

export function LiveTradeHoldingRationaleRow({
  holding: h,
  colSpan = 6,
}: {
  holding: LiveTradeHolding;
  colSpan?: number;
}) {
  const entryNote = h.entryStructureNote?.trim();
  const exitNote = h.exitScenarioNote?.trim();
  if (!entryNote && !exitNote) return null;

  return (
    <tr className="live-sim-run__scenario-row">
      <td colSpan={colSpan}>
        {entryNote ? (
          <p className="live-holding-rationale__line">
            <span className="live-sim-run__scenario-k">
              {ko.app.liveTradePfColEntryStructure}
            </span>
            {h.entryIdeal ? " ◆ " : " "}
            {entryNote}
          </p>
        ) : null}
        {exitNote ? (
          <p className="live-holding-rationale__line">
            <span className="live-sim-run__scenario-k">{ko.app.liveTradeExitWhy}</span>{" "}
            {exitNote}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

export function LiveHoldingChartSymbol({
  holding,
  selected = false,
  onOpen,
  variant = "sim",
}: {
  holding: LiveTradeHolding;
  selected?: boolean;
  onOpen?: (h: LiveTradeHolding) => void;
  variant?: "sim" | "portfolio";
}) {
  if (!onOpen) {
    if (variant === "portfolio") {
      return (
        <>
          <span className="live-portfolio__sym">{holding.symbol}</span>
          <span className="live-portfolio__nm">{holding.name}</span>
          <span className="live-portfolio__prog">
            {holding.programName ?? holding.programId}
          </span>
        </>
      );
    }
    return (
      <>
        <span className="live-sim-run__sym">{holding.symbol}</span>
        <span className="live-sim-run__name">{holding.name}</span>
      </>
    );
  }

  const cls = `live-holding-chart-btn${selected ? " live-holding-chart-btn--selected" : ""}`;
  if (variant === "portfolio") {
    return (
      <button
        type="button"
        className={cls}
        onClick={() => onOpen(holding)}
        aria-pressed={selected}
        title={ko.app.liveTradeChartOpenLookup}
      >
        <span className="live-portfolio__sym">{holding.symbol}</span>
        <span className="live-portfolio__nm">{holding.name}</span>
        <span className="live-portfolio__prog">
          {holding.programName ?? holding.programId}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={cls}
      onClick={() => onOpen(holding)}
      aria-pressed={selected}
      title={ko.app.liveTradeChartOpenLookup}
    >
      <span className="live-sim-run__sym">{holding.symbol}</span>
      <span className="live-sim-run__name">{holding.name}</span>
    </button>
  );
}
