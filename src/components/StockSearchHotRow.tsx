import { ko } from "../i18n/ko";
import { formatPercent, formatPrice, formatTurnover } from "../lib/format";
import { resolveUsQuoteDisplay } from "../lib/usQuoteDisplay";
import type { StockPick, StockSearchQuoteRow } from "../types";

export function rowToStockPick(row: StockSearchQuoteRow): StockPick {
  const pick: StockPick = {
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    score: 0,
    signals: [],
  };
  const koName = row.nameKo?.trim();
  const enName = row.nameEn?.trim();
  if (koName) pick.nameKo = koName;
  if (enName) pick.nameEn = enName;
  if (row.price != null && Number.isFinite(row.price)) pick.price = row.price;
  if (row.changePercent != null && Number.isFinite(row.changePercent)) {
    pick.changePercent = row.changePercent;
  }
  if (row.currency?.trim()) pick.currency = row.currency.trim();
  if (row.turnover != null && Number.isFinite(row.turnover) && row.turnover > 0) {
    pick.turnover = row.turnover;
  }
  return pick;
}

export default function StockSearchHotRow({
  row,
  isActive,
  onSelectPick,
  usQuoteInKrw = false,
  usdKrwRate = null,
  onAddToVault,
  vaultSaved = false,
}: {
  row: StockSearchQuoteRow;
  isActive: boolean;
  onSelectPick: (pick: StockPick) => void;
  usQuoteInKrw?: boolean;
  usdKrwRate?: number | null;
  onAddToVault?: (pick: StockPick) => void;
  vaultSaved?: boolean;
}) {
  const pick = rowToStockPick(row);
  const hasPrice = row.price != null && Number.isFinite(row.price);
  const quoteDisplay = resolveUsQuoteDisplay(
    row.price,
    row.currency,
    row.market,
    usQuoteInKrw,
    usdKrwRate ?? null,
  );
  const chg = row.changePercent;
  const chgUp = chg != null && chg >= 0;
  const code = row.symbol.replace(/\.(KS|KQ)$/i, "");
  const cur = quoteDisplay.currency ?? row.currency ?? undefined;
  const turnoverDisplay = resolveUsQuoteDisplay(
    row.turnover,
    row.currency,
    row.market,
    usQuoteInKrw,
    usdKrwRate ?? null,
  );

  return (
    <li
      className={isActive ? "stock-hot-item stock-hot-item--active" : "stock-hot-item"}
    >
      {onAddToVault && (row.market === "kr" || row.market === "us") ? (
        <button
          type="button"
          className={
            vaultSaved
              ? "stock-hot-item__vault-btn stock-hot-item__vault-btn--saved"
              : "stock-hot-item__vault-btn"
          }
          title={vaultSaved ? ko.stockVault.added : ko.stockVault.addAria}
          aria-label={vaultSaved ? ko.stockVault.added : ko.stockVault.addAria}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAddToVault(pick);
          }}
        >
          {vaultSaved ? "✓" : "+"}
        </button>
      ) : null}
      <button
        type="button"
        className="stock-hot-item__btn"
        onClick={() => onSelectPick(pick)}
      >
        <span className="stock-hot-item__identity">
          <span className="stock-hot-item__name" title={row.name}>
            {row.name}
          </span>
          <span className="stock-hot-item__code">{code}</span>
        </span>
        {hasPrice ? (
          <>
            {row.turnover != null &&
            Number.isFinite(row.turnover) &&
            row.turnover > 0 ? (
              <span className="stock-hot-item__turnover" title={ko.app.pickTurnoverTitle}>
                {formatTurnover(
                  turnoverDisplay.price ?? undefined,
                  turnoverDisplay.currency ?? cur,
                  { plainSymbols: true },
                )}
              </span>
            ) : null}
            <span className="stock-hot-item__quote">
              <span className="stock-hot-item__price">
                {formatPrice(quoteDisplay.price ?? undefined, cur)}
              </span>
              {chg != null && Number.isFinite(chg) ? (
                <span
                  className={
                    chgUp
                      ? "stock-hot-item__chg stock-hot-item__chg--up"
                      : "stock-hot-item__chg stock-hot-item__chg--down"
                  }
                >
                  {formatPercent(chg)}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="stock-hot-item__pending">{ko.app.stockLookupQuotePending}</span>
        )}
      </button>
    </li>
  );
}
