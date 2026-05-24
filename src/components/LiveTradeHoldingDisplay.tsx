import type { ReactNode } from "react";
import type { LiveTradeHolding } from "../api";
import { SHOW_HOLDING_RATIONALE_ROW } from "../constants/uiFlags";
import { formatPercent, formatPrice } from "../lib/format";
import { useLiveTradeFeeRates } from "../contexts/LiveTradeFeeRatesContext";
import { netReturnPctFromPrices } from "../lib/netReturn";
import { ko } from "../i18n/ko";
import CryptoCoinIcon from "./CryptoCoinIcon";

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
      const nm = String(holding.name ?? "").trim();
      const showNm =
        nm &&
        nm.toUpperCase() !== holding.symbol.toUpperCase() &&
        !nm.toUpperCase().startsWith(holding.symbol.toUpperCase());
      return (
        <span className="live-portfolio__sym-block">
          <span className="live-portfolio__sym-line">
            <span className="live-portfolio__sym">{holding.symbol}</span>
            {prog ? (
              <span className="live-portfolio__prog-badge" title={prog}>
                {prog}
              </span>
            ) : null}
          </span>
          {showNm ? <span className="live-portfolio__nm">{nm}</span> : null}
        </span>
      );
    }
    return (
      <SymbolWithCoinIcon symbol={holding.symbol} market={holding.market}>
        <span className="live-sim-run__sym">{holding.symbol}</span>
        <span className="live-sim-run__name">{holding.name}</span>
        {footer}
      </SymbolWithCoinIcon>
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
        <span className="live-portfolio__sym-line">
          <span className="live-portfolio__sym">{holding.symbol}</span>
          {(holding.programName ?? holding.programId) ? (
            <span
              className="live-portfolio__prog-badge"
              title={holding.programName ?? holding.programId}
            >
              {holding.programName ?? holding.programId}
            </span>
          ) : null}
        </span>
        {holding.name && holding.name !== holding.symbol ? (
          <span className="live-portfolio__nm">{holding.name}</span>
        ) : null}
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
        <span className="live-sim-run__sym">{holding.symbol}</span>
        <span className="live-sim-run__name">{holding.name}</span>
        {footer}
      </SymbolWithCoinIcon>
    </button>
  );
}
