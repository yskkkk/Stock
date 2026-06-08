import { parseTossDecimal } from "./toss-openapi.js";
import { resolveDisplayName } from "./names-ko.js";

/**
 * @param {unknown} rateDecimal 소수비율 (0.1077 = 10.77%)
 */
function tossRateToPercent(rateDecimal) {
  const n = parseTossDecimal(rateDecimal);
  if (!Number.isFinite(n)) return null;
  const pct = n * 100;
  return Number.isFinite(pct) ? pct : null;
}

/**
 * @param {{
 *   holdings?: unknown;
 *   buyingPowerKrw?: unknown;
 *   buyingPowerUsd?: unknown;
 * }} raw
 */
export function summarizeTossAccountsForDisplay(raw) {
  const ov =
    raw?.holdings && typeof raw.holdings === "object" ? raw.holdings : {};
  const items = Array.isArray(ov.items) ? ov.items : [];

  const cashKrw = parseTossDecimal(raw?.buyingPowerKrw?.cashBuyingPower);
  const cashUsd = parseTossDecimal(raw?.buyingPowerUsd?.cashBuyingPower);

  /** @type {import("./toss-accounts-summary.js").TossAccountHoldingSummary[]} */
  const holdings = [];

  for (const item of items) {
    const symbol = String(item?.symbol ?? "").trim();
    if (!symbol) continue;
    const quantity = parseTossDecimal(item?.quantity);
    if (!(quantity > 0)) continue;

    const marketCountry = String(item?.marketCountry ?? "").trim().toUpperCase();
    const market = marketCountry === "US" ? "us" : "kr";
    const currencyRaw = String(item?.currency ?? "").trim().toUpperCase();
    const currency = currencyRaw === "USD" ? "USD" : "KRW";
    const avgBuyPrice = parseTossDecimal(item?.averagePurchasePrice);
    const currentPrice = parseTossDecimal(item?.lastPrice);
    const marketValue = parseTossDecimal(item?.marketValue?.amount);

    holdings.push({
      symbol: market === "kr" && /^\d{6}$/.test(symbol) ? `${symbol}.KS` : symbol,
      rawSymbol: symbol,
      name: resolveDisplayName(
        market === "kr" && /^\d{6}$/.test(symbol) ? `${symbol}.KS` : symbol,
        String(item?.name ?? symbol).trim() || symbol,
      ),
      market,
      currency,
      quantity,
      avgBuyPrice: avgBuyPrice > 0 ? avgBuyPrice : null,
      currentPrice: currentPrice > 0 ? currentPrice : null,
      marketValue: marketValue > 0 ? marketValue : null,
      returnPercent: tossRateToPercent(item?.profitLoss?.rate),
      dailyChangePercent: tossRateToPercent(item?.dailyProfitLoss?.rate),
    });
  }

  holdings.sort((a, b) => {
    const va = a.marketValue ?? 0;
    const vb = b.marketValue ?? 0;
    return vb - va;
  });

  const plKrw = parseTossDecimal(ov?.profitLoss?.amount?.krw);
  const plUsd = parseTossDecimal(ov?.profitLoss?.amount?.usd);
  const mvKrw = parseTossDecimal(ov?.marketValue?.amount?.krw);
  const mvUsd = parseTossDecimal(ov?.marketValue?.amount?.usd);

  return {
    cash: {
      krw: cashKrw,
      usd: cashUsd,
    },
    summary: {
      profitLossKrw: Number.isFinite(plKrw) ? plKrw : null,
      profitLossUsd: Number.isFinite(plUsd) ? plUsd : null,
      marketValueKrw: mvKrw > 0 ? mvKrw : null,
      marketValueUsd: mvUsd > 0 ? mvUsd : null,
    },
    holdings,
  };
}

/**
 * @typedef {{
 *   symbol: string;
 *   rawSymbol: string;
 *   name: string;
 *   market: "kr" | "us";
 *   currency: "KRW" | "USD";
 *   quantity: number;
 *   avgBuyPrice: number | null;
 *   currentPrice?: number | null;
 *   marketValue?: number | null;
 *   returnPercent?: number | null;
 *   dailyChangePercent?: number | null;
 * }} TossAccountHoldingSummary
 */
