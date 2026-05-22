import { memo } from "react";
import { ko } from "../i18n/ko";
import { formatPercent } from "../lib/format";
import type { MarketIndexItem } from "../types";

function formatIndexPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}

function IndexRow({ item }: { item: MarketIndexItem }) {
  const up = (item.changePercent ?? 0) >= 0;
  const hasChg = item.changePercent != null && Number.isFinite(item.changePercent);

  return (
    <li className="market-indices-rail__item">
      <span className="market-indices-rail__label">{item.label}</span>
      <span className="market-indices-rail__price">{formatIndexPrice(item.price)}</span>
      {hasChg ? (
        <span
          className={
            up
              ? "market-indices-rail__chg market-indices-rail__chg--up"
              : "market-indices-rail__chg market-indices-rail__chg--down"
          }
        >
          {formatPercent(item.changePercent!)}
        </span>
      ) : (
        <span className="market-indices-rail__chg market-indices-rail__chg--muted">—</span>
      )}
    </li>
  );
}

function MarketIndicesRailInner({
  items,
  loading,
  layout = "rail",
}: {
  items: MarketIndexItem[];
  loading: boolean;
  layout?: "rail" | "strip";
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
            <IndexRow key={item.id} item={item} />
          ))}
        </ul>
      ) : !loading ? (
        <p className="market-indices-rail__empty">{ko.app.marketIndicesEmpty}</p>
      ) : (
        <ul className="market-indices-rail__list market-indices-rail__list--skeleton">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="market-indices-rail__item market-indices-rail__item--sk" />
          ))}
        </ul>
      )}
    </aside>
  );
}

export default memo(MarketIndicesRailInner);
