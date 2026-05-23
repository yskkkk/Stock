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

function LiveFxRow({
  rate,
  changePercent,
  onOpen,
}: {
  rate: number | null;
  changePercent: number | null;
  onOpen?: () => void;
}) {
  const hasRate = rate != null && Number.isFinite(rate) && rate > 0;
  const up = (changePercent ?? 0) >= 0;
  const hasChg = changePercent != null && Number.isFinite(changePercent);

  const body = (
    <>
      <div className="market-indices-rail__live-fx-head">
        <span className="market-indices-rail__label">{ko.app.topBarFxLabel}</span>
        <span className="market-indices-rail__live-badge">{ko.app.marketIndicesLiveFxBadge}</span>
      </div>
      <span className="market-indices-rail__price">
        {hasRate ? formatPrice(rate, "KRW") : "—"}
      </span>
      {hasChg ? (
        <span
          className={
            up
              ? "market-indices-rail__chg market-indices-rail__chg--up"
              : "market-indices-rail__chg market-indices-rail__chg--down"
          }
        >
          {formatPercent(changePercent!)}
        </span>
      ) : (
        <span className="market-indices-rail__chg market-indices-rail__chg--muted">—</span>
      )}
    </>
  );

  if (!onOpen) {
    return (
      <div
        className="market-indices-rail__live-fx"
        role="group"
        aria-label={ko.app.marketIndicesLiveFxAria}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="market-indices-rail__live-fx market-indices-rail__live-fx--clickable"
      aria-label={ko.app.marketIndicesOpenChart.replace("{name}", ko.app.topBarFxLabel)}
      onClick={onOpen}
    >
      {body}
    </button>
  );
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
  /** /api/fx/usd-krw — 약 20초마다 갱신(환율 계산과 동일) */
  liveFxRate?: number | null;
  onOpenItem?: (item: MarketIndexItem) => void;
}) {
  const { indexItems, fxChangePercent, fxOpen } = useMemo(() => {
    const fx = items.find((i) => i.id === "usdkrw");
    return {
      indexItems: items.filter((i) => i.id !== "usdkrw"),
      fxChangePercent: fx?.changePercent ?? null,
      fxOpen: fx && onOpenItem ? () => onOpenItem(fx) : undefined,
    };
  }, [items, onOpenItem]);

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
      <LiveFxRow
        rate={liveFxRate ?? null}
        changePercent={fxChangePercent}
        onOpen={fxOpen}
      />
      {indexItems.length > 0 ? (
        <ul className="market-indices-rail__list">
          {indexItems.map((item) => (
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
