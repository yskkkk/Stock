import { memo, useState, type MutableRefObject } from "react";
import FavoriteTrackPanel from "./FavoriteTrackPanel";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import { goldenCrossRecencyClass } from "../lib/goldenCrossRecency";
import type { VaultDisplayRow } from "../lib/stockVaultFilter";
import {
  formatGoldenCrossChain,
  formatMa120NearLabel,
  formatMaAlignChain,
  resolveMa120Approach,
} from "../lib/stockVaultMaDisplay";
import {
  stockVaultTimeframeBadgeClass,
  stockVaultTimeframeLabel,
  stockVaultTimeframeRowClass,
} from "../lib/stockVaultTimeframe";
import type { StockVaultChartInsightSnapshot, StockVaultScanSource } from "../types";
import { VaultBookmarkIcon } from "./StockVaultMarkButton";
import {
  type StockVaultRowBubbleActions,
  type StockVaultRowBubbleTarget,
} from "./StockVaultRowBubble";

const SOURCE_BADGE_LABEL: Record<StockVaultScanSource, string> = {
  golden_cross: ko.stockVault.sourceGolden,
  ma_align: ko.stockVault.sourceMaAlign,
  ma120_near: ko.stockVault.sourceMa120Near,
  bottom_candle: ko.stockVault.sourceBottomCandle,
};

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

export type StockVaultRowQuote = {
  price: number;
  changePercent?: number;
  currency?: string;
};

export type StockVaultRowProps = {
  row: VaultDisplayRow;
  quote?: StockVaultRowQuote;
  displayLabel: string;
  displaySublabel?: string | null;
  industry: string | null;
  tvSymbol: string;
  chartInsight?: StockVaultChartInsightSnapshot;
  favoriteAddedAtMs?: number | null;
  favoritePrice?: number | null;
  isHistoricalView: boolean;
  authenticated: boolean;
  favoriting: string | null;
  removing: string | null;
  rowBubbleTipId: string;
  bubbleActionsRef: MutableRefObject<StockVaultRowBubbleActions | null>;
  onToggleFavorite: (
    symbol: string,
    favorited: boolean,
    market: "kr" | "us",
    name: string,
  ) => void;
  onRemove: (symbol: string) => void;
  onFavoritePriceSaved: (symbol: string, price: number | null) => void;
};

function StockVaultRowInner({
  row,
  quote,
  displayLabel,
  displaySublabel,
  industry,
  tvSymbol,
  chartInsight,
  favoriteAddedAtMs,
  favoritePrice,
  isHistoricalView,
  authenticated,
  favoriting,
  removing,
  rowBubbleTipId,
  bubbleActionsRef,
  onToggleFavorite,
  onRemove,
  onFavoritePriceSaved,
}: StockVaultRowProps) {
  const [favoriteTrackOpen, setFavoriteTrackOpen] = useState(false);
  const cur = quote?.currency ?? (row.market === "kr" ? "KRW" : "USD");
  const chg = quote?.changePercent;
  const chgUp = chg != null && chg >= 0;
  const gcItem = row.goldenCross;
  const bottomItem = row.bottomCandle;
  const gcRecencyClass = gcItem ? goldenCrossRecencyClass(gcItem) : null;
  const rowClassName = [
    "stock-vault-tab__row",
    stockVaultTimeframeRowClass(row.timeframe),
    gcRecencyClass,
  ]
    .filter(Boolean)
    .join(" ");
  const scanDate =
    gcItem?.crossDate ??
    gcItem?.scanDate ??
    row.maAlign?.scanDate ??
    bottomItem?.signalDate ??
    bottomItem?.scanDate ??
    null;
  const sourceLabels =
    row.scanSources.length > 0
      ? row.scanSources.map((s) => SOURCE_BADGE_LABEL[s])
      : row.favorite
        ? [ko.stockVault.sourceFavorite]
        : [];
  const gcChain = formatGoldenCrossChain(gcItem?.crosses);
  const ma120Label = row.ma120Near
    ? formatMa120NearLabel(
        row.ma120Near.distancePct,
        resolveMa120Approach(row.ma120Near, chartInsight, quote?.price),
        {
          fromBelow: ko.stockVault.maApproachFromBelow,
          fromAbove: ko.stockVault.maApproachFromAbove,
        },
      )
    : null;
  const bottomLabel = bottomItem?.bottomTag
    ? `${bottomItem.bottomTag}${
        bottomItem.bottomScore != null ? ` ${bottomItem.bottomScore}pt` : ""
      }`
    : null;
  const hasSignalBadges =
    Boolean(gcChain) ||
    Boolean(row.maAlign) ||
    Boolean(ma120Label) ||
    Boolean(bottomLabel);

  const bubbleTarget = (): StockVaultRowBubbleTarget => ({
    symbol: row.symbol,
    name: displayLabel,
    market: row.market,
    industry,
    tvSymbol,
    price: quote?.price ?? null,
    currency: cur ?? null,
  });

  const openRowBubble = (el: HTMLElement, opts?: { immediate?: boolean }) =>
    bubbleActionsRef.current?.showTip(el, bubbleTarget(), opts);

  return (
    <li className={rowClassName}>
      <div
        className="stock-vault-tab__row-hover-zone"
        aria-describedby={rowBubbleTipId}
        onMouseEnter={(e) => openRowBubble(e.currentTarget)}
        onMouseLeave={() => bubbleActionsRef.current?.scheduleHideTip()}
      >
        <div
          className="stock-vault-tab__row-link"
          tabIndex={0}
          aria-label={`${displayLabel} ${ko.stockVault.rowBubbleAria}`}
          onFocus={(e) =>
            openRowBubble(
              e.currentTarget.closest(".stock-vault-tab__row-hover-zone") ??
                e.currentTarget,
              { immediate: true },
            )
          }
          onBlur={(e) => {
            const rel = e.relatedTarget as Node | null;
            if (rel && document.getElementById(rowBubbleTipId)?.contains(rel)) return;
            bubbleActionsRef.current?.scheduleHideTip();
          }}
        >
          <div className="stock-vault-tab__row-top">
            <div className="stock-vault-tab__row-main">
              <div className="stock-vault-tab__row-head">
                <span className="stock-vault-tab__name" title={displayLabel}>
                  {displayLabel}
                </span>
                {displaySublabel ? (
                  <span className="stock-vault-tab__sym">{displaySublabel}</span>
                ) : null}
                {industry ? (
                  <span className="stock-vault-tab__sector-inline">{industry}</span>
                ) : null}
              </div>
            </div>
            <div className="stock-vault-tab__row-aside">
              <div className="stock-vault-tab__quote">
                {quote?.price != null && Number.isFinite(quote.price) ? (
                  <>
                    <span className="stock-vault-tab__price">
                      {formatPrice(quote.price, cur)}
                    </span>
                    {chg != null && Number.isFinite(chg) ? (
                      <span
                        className={
                          chgUp
                            ? "stock-vault-tab__chg stock-vault-tab__chg--up"
                            : "stock-vault-tab__chg stock-vault-tab__chg--down"
                        }
                      >
                        {formatPercent(chg)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="stock-vault-tab__quote-pending">
                    {ko.app.stockLookupQuotePending}
                  </span>
                )}
              </div>
              <div className="stock-vault-tab__row-actions">
                <button
                  type="button"
                  className={
                    row.favorited
                      ? "stock-vault-tab__favorite stock-vault-tab__favorite--on"
                      : "stock-vault-tab__favorite"
                  }
                  aria-label={
                    row.favorited
                      ? `${displayLabel} ${ko.stockVault.favoriteRemoveAria}`
                      : `${displayLabel} ${ko.stockVault.favoriteAddAria}`
                  }
                  title={
                    row.favorited
                      ? ko.stockVault.favoriteRemove
                      : ko.stockVault.favoriteAdd
                  }
                  aria-pressed={Boolean(row.favorited)}
                  disabled={favoriting === row.symbol}
                  onMouseEnter={() => bubbleActionsRef.current?.scheduleHideTip()}
                  onClick={() =>
                    void onToggleFavorite(
                      row.symbol,
                      Boolean(row.favorited),
                      row.market,
                      displayLabel,
                    )
                  }
                >
                  <VaultBookmarkIcon filled={Boolean(row.favorited)} />
                </button>
                {!isHistoricalView ? (
                  <button
                    type="button"
                    className="stock-vault-tab__remove"
                    aria-label={`${displayLabel} ${ko.stockVault.removeAria}`}
                    title={ko.stockVault.remove}
                    disabled={removing === row.symbol || !authenticated}
                    onMouseEnter={() => bubbleActionsRef.current?.scheduleHideTip()}
                    onClick={() => void onRemove(row.symbol)}
                  >
                    <span className="stock-vault-tab__remove-icon" aria-hidden>
                      ×
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="stock-vault-tab__meta">
            <span className="stock-vault-tab__market">
              {row.market === "kr" ? ko.app.marketKr : ko.app.marketUs}
            </span>
            {sourceLabels.map((label) => (
              <span key={label} className="stock-vault-tab__source">
                {label}
              </span>
            ))}
            <span className={stockVaultTimeframeBadgeClass(row.timeframe)}>
              {stockVaultTimeframeLabel(row.timeframe)}
            </span>
            {scanDate ? (
              <span className="stock-vault-tab__scan-date">{scanDate}</span>
            ) : (
              <span className="stock-vault-tab__added">{fmtDate(row.updatedAtMs)}</span>
            )}
          </div>
          {hasSignalBadges ? (
            <div className="stock-vault-tab__crosses">
              {gcChain ? (
                <span className="stock-vault-tab__cross">{gcChain}</span>
              ) : null}
              {row.maAlign ? (
                <span
                  className="stock-vault-tab__cross stock-vault-tab__cross--align"
                  title={ko.stockVault.maAlignBadgeHint}
                >
                  {formatMaAlignChain()}
                </span>
              ) : null}
              {ma120Label ? (
                <span
                  className="stock-vault-tab__cross stock-vault-tab__cross--ma120"
                  title={ko.stockVault.ma120NearBadgeHint}
                >
                  {ma120Label}
                </span>
              ) : null}
              {bottomLabel ? (
                <span
                  className="stock-vault-tab__cross stock-vault-tab__cross--bottom"
                  title={ko.stockVault.bottomCandleBadgeHint}
                >
                  {bottomLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {row.favorited ? (
        favoriteTrackOpen ? (
          <FavoriteTrackPanel
            symbol={row.symbol}
            market={row.market}
            addedAtMs={favoriteAddedAtMs}
            basePrice={favoritePrice}
            currentPrice={quote?.price}
            currency={cur}
            editable={authenticated}
            onBasePriceSaved={(price) => onFavoritePriceSaved(row.symbol, price)}
          />
        ) : (
          <button
            type="button"
            className="stock-vault-tab__favorite-track-toggle"
            onClick={() => setFavoriteTrackOpen(true)}
          >
            {ko.stockVault.favoriteTrackTitle} ▾
          </button>
        )
      ) : null}
    </li>
  );
}

function rowPropsEqual(prev: StockVaultRowProps, next: StockVaultRowProps) {
  return (
    prev.row.key === next.row.key &&
    prev.row.updatedAtMs === next.row.updatedAtMs &&
    prev.row.favorited === next.row.favorited &&
    prev.quote?.price === next.quote?.price &&
    prev.quote?.changePercent === next.quote?.changePercent &&
    prev.quote?.currency === next.quote?.currency &&
    prev.displayLabel === next.displayLabel &&
    prev.displaySublabel === next.displaySublabel &&
    prev.industry === next.industry &&
    prev.chartInsight === next.chartInsight &&
    prev.favoriteAddedAtMs === next.favoriteAddedAtMs &&
    prev.favoritePrice === next.favoritePrice &&
    prev.favoriting === next.favoriting &&
    prev.removing === next.removing &&
    prev.authenticated === next.authenticated &&
    prev.isHistoricalView === next.isHistoricalView
  );
}

const StockVaultRow = memo(StockVaultRowInner, rowPropsEqual);
export default StockVaultRow;
