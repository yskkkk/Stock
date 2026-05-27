import type { LiveTradeHolding, LiveTradeRecord } from "../api";
import { resolveSymbolDisplayName } from "../lib/symbolDisplayName";
import CryptoCoinIcon from "./CryptoCoinIcon";

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
  const { label, sublabel } = resolveSymbolDisplayName(symbol, name, market);
  return (
    <span className="live-symbol-with-icon">
      <CryptoCoinIcon symbol={symbol} market={market} />
      <span className={`live-symbol-with-icon__text ${className}`.trim()}>
        <span className="live-portfolio__sym">{label}</span>
        {sublabel ? <span className="live-portfolio__nm">{sublabel}</span> : null}
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
