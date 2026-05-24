import { memo } from "react";
import { ko } from "../i18n/ko";
import { formatPercent } from "../lib/format";
import {
  formatMarketIndexPrice,
  marketIndexChangeTone,
} from "../lib/marketIndexFormat";
import type { MarketIndexItem } from "../types";

function IndexRow({
  item,
  onOpen,
}: {
  item: MarketIndexItem;
  onOpen?: (item: MarketIndexItem) => void;
}) {
  const tone = marketIndexChangeTone(item);
  const hasChg = tone !== "muted";
  const clickable = Boolean(onOpen);

  const body = (
    <>
      <span className="market-indices-rail__label">{item.label}</span>
      <span className="market-indices-rail__price">{formatMarketIndexPrice(item)}</span>
      {hasChg ? (
        <span
          className={
            tone === "up"
              ? "market-indices-rail__chg market-indices-rail__chg--up"
              : "market-indices-rail__chg market-indices-rail__chg--down"
          }
        >
          {formatPercent(item.changePercent!)}
        </span>
      ) : (
        <span className="market-indices-rail__chg market-indices-rail__chg--muted">—</span>
      )}
    </>
  );

  if (!clickable) {
    return <li className="market-indices-rail__item">{body}</li>;
  }

  return (
    <li>
      <button
        type="button"
        className="market-indices-rail__item market-indices-rail__item--clickable"
        aria-label={
          ko.app.marketIndicesOpenChart?.replace("{name}", item.label) ??
          item.label
        }
        onClick={() => onOpen!(item)}
      >
        {body}
      </button>
    </li>
  );
}

function MarketIndicesRailInner({
  items,
  loading,
  layout = "rail",
  onOpenItem,
}: {
  items: MarketIndexItem[];
  loading: boolean;
  layout?: "rail" | "strip";
  onOpenItem?: (item: MarketIndexItem) => void;
}) {
  const rootClass =
    layout === "strip"
      ? "market-indices-rail market-indices-rail--strip"
      : "market-indices-rail market-indices-rail--side";

  return (
    <aside
      className={rootClass}
      role="complementary"
      aria-label={ko.app.marketIndicesAria}
    >
      <div className="market-indices-rail__head">
        <span className="market-indices-rail__title">{ko.app.marketIndicesTitle}</span>
        {loading ? (
          <span className="market-indices-rail__status">{ko.app.marketIndicesLoading}</span>
        ) : null}
      </div>
      {items.length > 0 ? (
        <ul className="market-indices-rail__list">
          {items.map((item) => (
            <IndexRow key={item.id} item={item} onOpen={onOpenItem} />
          ))}
        </ul>
      ) : !loading ? (
        <p className="market-indices-rail__empty">{ko.app.marketIndicesEmpty}</p>
      ) : (
        <ul className="market-indices-rail__list market-indices-rail__list--skeleton">
          {Array.from({ length: 7 }, (_, i) => (
            <li key={i} className="market-indices-rail__item market-indices-rail__item--sk" />
          ))}
        </ul>
      )}
    </aside>
  );
}

export default memo(MarketIndicesRailInner);
