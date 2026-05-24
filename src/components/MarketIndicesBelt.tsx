import { memo, useMemo, type CSSProperties } from "react";
import { ko } from "../i18n/ko";
import {
  formatMarketIndexChange,
  formatMarketIndexPrice,
  marketIndexChangeTone,
} from "../lib/marketIndexFormat";
import type { MarketIndexItem } from "../types";

function BeltChip({
  item,
  onOpen,
}: {
  item: MarketIndexItem;
  onOpen?: (item: MarketIndexItem) => void;
}) {
  const tone = marketIndexChangeTone(item);
  const body = (
    <>
      <span className="market-indices-belt__label">{item.label}</span>
      <span className="market-indices-belt__price">{formatMarketIndexPrice(item)}</span>
      <span
        className={
          tone === "up"
            ? "market-indices-belt__chg market-indices-belt__chg--up"
            : tone === "down"
              ? "market-indices-belt__chg market-indices-belt__chg--down"
              : "market-indices-belt__chg market-indices-belt__chg--muted"
        }
      >
        {formatMarketIndexChange(item)}
      </span>
    </>
  );

  if (!onOpen) {
    return <span className="market-indices-belt__chip">{body}</span>;
  }

  return (
    <button
      type="button"
      className="market-indices-belt__chip market-indices-belt__chip--btn"
      aria-label={
        ko.app.marketIndicesOpenChart?.replace("{name}", item.label) ?? item.label
      }
      onClick={() => onOpen(item)}
    >
      {body}
    </button>
  );
}

function MarketIndicesBeltInner({
  items,
  loading,
  layout = "rail",
  onOpenItem,
}: {
  items: MarketIndexItem[];
  loading: boolean;
  layout?: "rail" | "strip" | "top";
  onOpenItem?: (item: MarketIndexItem) => void;
}) {
  const loopItems = useMemo(() => {
    if (items.length === 0) return [];
    return [...items, ...items];
  }, [items]);

  const durationSec = Math.max(18, Math.min(48, items.length * 5));

  const rootClass =
    layout === "top"
      ? "market-indices-belt market-indices-belt--top"
      : layout === "strip"
        ? "market-indices-belt market-indices-belt--strip"
        : "market-indices-belt market-indices-belt--side";

  return (
    <div
      className={rootClass}
      role="region"
      aria-label={ko.app.marketIndicesBeltAria}
      aria-busy={loading}
    >
      <div className="market-indices-belt__viewport">
        {loading && items.length === 0 ? (
          <div className="market-indices-belt__track market-indices-belt__track--sk">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className="market-indices-belt__chip market-indices-belt__chip--sk" />
            ))}
          </div>
        ) : loopItems.length > 0 ? (
          <div
            className="market-indices-belt__track"
            style={
              {
                "--market-indices-belt-duration": `${durationSec}s`,
              } as CSSProperties
            }
          >
            {loopItems.map((item, i) => (
              <BeltChip
                key={`${item.id}-${i}`}
                item={item}
                onOpen={onOpenItem}
              />
            ))}
          </div>
        ) : (
          <p className="market-indices-belt__empty">{ko.app.marketIndicesEmpty}</p>
        )}
      </div>
    </div>
  );
}

export default memo(MarketIndicesBeltInner);
