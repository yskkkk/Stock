import type { ReactNode } from "react";
import type { LiveTradeHolding } from "../api";
import { SHOW_HOLDING_RATIONALE_ROW } from "../constants/uiFlags";
import { formatPercent, formatPrice } from "../lib/format";
import { useLiveTradeFeeRates } from "../contexts/LiveTradeFeeRatesContext";
import { netReturnPctFromPrices } from "../lib/netReturn";
import { ko } from "../i18n/ko";
import { resolveSymbolDisplayName } from "../lib/symbolDisplayName";
import CryptoCoinIcon from "./CryptoCoinIcon";

function HoldingSymbolLabels({
  holding,
  footer,
}: {
  holding: LiveTradeHolding;
  footer?: ReactNode;
}) {
  const { label, sublabel } = resolveSymbolDisplayName(
    holding.symbol,
    holding.name,
    holding.market,
  );
  return (
    <>
      <span className="live-sim-run__sym">{label}</span>
      {sublabel ? <span className="live-sim-run__name">{sublabel}</span> : null}
      {footer}
    </>
  );
}

function SymbolWithCoinIcon({
  symbol,
  market,
  children,
}: {
  symbol: string;
  market: LiveTradeHolding["market"];
  children: ReactNode;
}) {
  return (
    <span className="live-symbol-with-icon">
      <CryptoCoinIcon symbol={symbol} market={market} />
      <span className="live-symbol-with-icon__text">{children}</span>
    </span>
  );
}

/** 목표·손절가 + 왕복 수수료 반영 손익률 */
export function LiveTradeExitPriceCell({
  entry,
  exitPrice,
  currency,
  variant,
  market = "kr",
  compact = false,
}: {
  entry: number;
  exitPrice: number | null | undefined;
  currency: string;
  variant: "success" | "failure";
  market?: "kr" | "us" | "crypto";
  compact?: boolean;
}) {
  const { roundTripForMarket } = useLiveTradeFeeRates();
  const pct = netReturnPctFromPrices(
    entry,
    exitPrice,
    roundTripForMarket(market ?? "kr"),
  );
  const label = compact
    ? variant === "success"
      ? ko.app.liveTradeExitCompactSuccess
      : ko.app.liveTradeExitCompactFailure
    : variant === "success"
      ? ko.app.liveTradeExitIfSuccess
      : ko.app.liveTradeExitIfFailure;

  if (exitPrice == null || !Number.isFinite(exitPrice) || exitPrice <= 0) {
    return <span className="live-exit-cell__price">—</span>;
  }

  const pctUp = pct != null && pct >= 0;
  return (
    <span className={compact ? "live-exit-cell live-exit-cell--compact" : "live-exit-cell"}>
      <span className="live-exit-cell__price">{formatPrice(exitPrice, currency)}</span>
      {pct != null ? (
        <span
          className={
            pctUp
              ? "live-exit-cell__pct live-exit-cell__pct--up"
              : "live-exit-cell__pct live-exit-cell__pct--down"
          }
        >
          {label}{" "}
          {formatPercent(pct)}
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
  if (!SHOW_HOLDING_RATIONALE_ROW) return null;

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
  footer,
}: {
  holding: LiveTradeHolding;
  selected?: boolean;
  onOpen?: (h: LiveTradeHolding) => void;
  variant?: "sim" | "portfolio";
  /** 심볼·이름 아래 (프로그램명 등) */
  footer?: ReactNode;
}) {
  if (!onOpen) {
    if (variant === "portfolio") {
      const prog = holding.programName ?? holding.programId;
      const { label, sublabel } = resolveSymbolDisplayName(
        holding.symbol,
        holding.name,
        holding.market,
      );
      return (
        <span className="live-portfolio__sym-block">
          <span className="live-portfolio__sym-line">
            <span className="live-portfolio__sym">{label}</span>
            {prog ? (
              <span className="live-portfolio__prog-badge" title={prog}>
                {prog}
              </span>
            ) : null}
          </span>
          {sublabel ? <span className="live-portfolio__nm">{sublabel}</span> : null}
        </span>
      );
    }
    return (
      <SymbolWithCoinIcon symbol={holding.symbol} market={holding.market}>
        <HoldingSymbolLabels holding={holding} footer={footer} />
      </SymbolWithCoinIcon>
    );
  }

  const cls = `live-holding-chart-btn${selected ? " live-holding-chart-btn--selected" : ""}`;
  const { label, sublabel } = resolveSymbolDisplayName(
    holding.symbol,
    holding.name,
    holding.market,
  );

  if (variant === "portfolio") {
    return (
      <button
        type="button"
        className={cls}
        onClick={() => onOpen(holding)}
        aria-pressed={selected}
        title={ko.app.liveTradeChartOpenLookup}
      >
        <span className="live-portfolio__sym-line">
          <span className="live-portfolio__sym">{label}</span>
          {(holding.programName ?? holding.programId) ? (
            <span
              className="live-portfolio__prog-badge"
              title={holding.programName ?? holding.programId}
            >
              {holding.programName ?? holding.programId}
            </span>
          ) : null}
        </span>
        {sublabel ? <span className="live-portfolio__nm">{sublabel}</span> : null}
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
      <SymbolWithCoinIcon symbol={holding.symbol} market={holding.market}>
        <span className="live-sim-run__sym">{label}</span>
        {sublabel ? <span className="live-sim-run__name">{sublabel}</span> : null}
        {footer}
      </SymbolWithCoinIcon>
    </button>
  );
}
