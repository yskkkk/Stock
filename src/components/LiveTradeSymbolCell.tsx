import type { LiveTradeHolding, LiveTradeRecord } from "../api";
import CryptoCoinIcon from "./CryptoCoinIcon";

function showSymbolName(symbol: string, name: string): boolean {
  const nm = name.trim();
  if (!nm) return false;
  const sym = symbol.trim().toUpperCase();
  return nm.toUpperCase() !== sym && !nm.toUpperCase().startsWith(`${sym} `);
}

export function LiveTradeSymbolCell({
  symbol,
  name,
  market,
  className = "live-portfolio__sym-cell",
}: {
  symbol: string;
  name?: string | null;
  market?: LiveTradeHolding["market"];
  className?: string;
}) {
  const displayName = String(name ?? "").trim();
  const showName = showSymbolName(symbol, displayName);
  return (
    <span className="live-symbol-with-icon">
      <CryptoCoinIcon symbol={symbol} market={market} />
      <span className={`live-symbol-with-icon__text ${className}`.trim()}>
        <span className="live-portfolio__sym">{symbol}</span>
        {showName ? <span className="live-portfolio__nm">{displayName}</span> : null}
      </span>
    </span>
  );
}

export function LiveTradeSymbolCellFromRecord({ t }: { t: LiveTradeRecord }) {
  return (
    <LiveTradeSymbolCell symbol={t.symbol} name={t.name} market={t.market} />
  );
}

export function LiveTradeSymbolCellFromHolding({ h }: { h: LiveTradeHolding }) {
  return (
    <LiveTradeSymbolCell symbol={h.symbol} name={h.name} market={h.market} />
  );
}
