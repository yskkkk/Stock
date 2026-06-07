import { useCallback, useEffect, useState } from "react";
import { patchStockVaultFavoriteMeta } from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import {
  favoriteChangePercent,
  favoriteDPlusDays,
  formatFavoriteDPlus,
} from "../lib/favoriteTracking";

export type FavoriteTrackPanelProps = {
  symbol: string;
  market: "kr" | "us";
  addedAtMs: number | null | undefined;
  basePrice: number | null | undefined;
  currentPrice: number | null | undefined;
  currency?: string;
  editable?: boolean;
  onBasePriceSaved?: (price: number | null) => void;
};

export default function FavoriteTrackPanel({
  symbol,
  market,
  addedAtMs,
  basePrice,
  currentPrice,
  currency,
  editable = false,
  onBasePriceSaved,
}: FavoriteTrackPanelProps) {
  const cur = currency ?? (market === "kr" ? "KRW" : "USD");
  const dPlus = addedAtMs ? favoriteDPlusDays(addedAtMs) : null;
  const chg = favoriteChangePercent(currentPrice, basePrice);
  const chgUp = chg != null && chg >= 0;
  const [draft, setDraft] = useState(
    basePrice != null && Number.isFinite(basePrice) ? String(basePrice) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft(
      basePrice != null && Number.isFinite(basePrice) ? String(basePrice) : "",
    );
  }, [basePrice, symbol]);

  const savePrice = useCallback(async () => {
    const n = Number(draft.replace(/,/g, "").trim());
    if (!Number.isFinite(n) || n <= 0) {
      setSaveErr("유효한 가격을 입력하세요.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await patchStockVaultFavoriteMeta(symbol, { favoritePrice: n });
      onBasePriceSaved?.(res.meta.favoritePrice ?? n);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [draft, onBasePriceSaved, symbol]);

  return (
    <div className="favorite-track">
      <div className="favorite-track__head">
        <span className="favorite-track__title">{ko.stockVault.favoriteTrackTitle}</span>
        <span className="favorite-track__dplus">
          {dPlus != null
            ? ko.stockVault.favoriteTrackDPlus(dPlus)
            : formatFavoriteDPlus(dPlus)}
        </span>
      </div>
      <div className="favorite-track__body">
        <div className="favorite-track__since">
          <span className="favorite-track__label">{ko.stockVault.favoriteTrackSince}</span>
          {chg != null && Number.isFinite(chg) ? (
            <span
              className={
                chgUp
                  ? "favorite-track__chg favorite-track__chg--up"
                  : "favorite-track__chg favorite-track__chg--down"
              }
            >
              {formatPercent(chg)}
            </span>
          ) : (
            <span className="favorite-track__muted">—</span>
          )}
        </div>
        <div className="favorite-track__base">
          <span className="favorite-track__label" title={ko.stockVault.favoriteTrackBasePriceHint}>
            {ko.stockVault.favoriteTrackBasePrice}
          </span>
          {editable ? (
            <div className="favorite-track__price-edit">
              <input
                type="text"
                inputMode="decimal"
                className="favorite-track__price-input"
                value={draft}
                aria-label={ko.stockVault.favoriteTrackBasePrice}
                disabled={saving}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void savePrice();
                }}
              />
              <button
                type="button"
                className="favorite-track__save-btn"
                disabled={saving}
                onClick={() => void savePrice()}
              >
                {ko.stockVault.favoriteTrackSavePrice}
              </button>
            </div>
          ) : basePrice != null && Number.isFinite(basePrice) ? (
            <span className="favorite-track__price">{formatPrice(basePrice, cur)}</span>
          ) : (
            <span className="favorite-track__muted">—</span>
          )}
        </div>
        {currentPrice != null && Number.isFinite(currentPrice) ? (
          <div className="favorite-track__current">
            <span className="favorite-track__label">{ko.stockVault.favoriteTrackCurrentPrice}</span>
            <span className="favorite-track__price">{formatPrice(currentPrice, cur)}</span>
          </div>
        ) : null}
        {saveErr ? (
          <p className="favorite-track__error" role="alert">
            {saveErr}
          </p>
        ) : null}
      </div>
    </div>
  );
}
