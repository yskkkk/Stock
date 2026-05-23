import { memo, useMemo } from "react";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import type { MarketIndexItem } from "../types";

function formatIndexPrice(item: MarketIndexItem): string {
  const value = item.price;
  if (value == null || !Number.isFinite(value)) return "—";
  if (item.kind === "fx") {
    return formatPrice(value, "KRW");
  }
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}

function IndexRow({
  item,
  onOpen,
}: {
  item: MarketIndexItem;
  onOpen?: (item: MarketIndexItem) => void;
}) {
  const up = (item.changePercent ?? 0) >= 0;
  const hasChg = item.changePercent != null && Number.isFinite(item.changePercent);
  const clickable = Boolean(onOpen);

  const body = (
    <>
      <span className="market-indices-rail__label">{item.label}</span>
      <span className="market-indices-rail__price">{formatIndexPrice(item)}</span>
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
        aria-label={ko.app.marketIndicesOpenChart.replace("{name}", item.label)}
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
  liveFxRate,
  onOpenItem,
}: {
  items: MarketIndexItem[];
  loading: boolean;
  layout?: "rail" | "strip";
  /** 환율 행 시세 — /api/fx/usd-krw (지수 폴링과 병행) */
  liveFxRate?: number | null;
  onOpenItem?: (item: MarketIndexItem) => void;
}) {
  const displayItems = useMemo(() => {
    if (liveFxRate == null || !Number.isFinite(liveFxRate) || liveFxRate <= 0) {
      return items;
    }
    return items.map((item) =>
      item.id === "usdkrw" ? { ...item, price: liveFxRate } : item,
    );
  }, [items, liveFxRate]);

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
      {displayItems.length > 0 ? (
        <ul className="market-indices-rail__list">
          {displayItems.map((item) => (
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
