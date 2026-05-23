/**
 * 빗썸 GET /v1/accounts → 연결 테스트·UI 표시용 요약
 */
import { isBinanceUsdtSymbol } from "./binance-usdt.js";
import { cryptoYahooUsdtDisplayName } from "./crypto-display-names.js";

/** @param {string} base */
export function bithumbBaseToUsdtSymbol(base) {
  const b = String(base ?? "").trim().toUpperCase();
  if (!b || b === "KRW") return null;
  const sym = `${b}-USDT`;
  return isBinanceUsdtSymbol(sym) ? sym : null;
}

/**
 * @param {unknown[]} accounts
 */
export function summarizeBithumbAccountsForDisplay(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  let krwAvailable = 0;
  let krwLocked = 0;
  /** @type {import("./bithumb-accounts-summary.js").BithumbAccountHoldingSummary[]} */
  const holdings = [];

  for (const acc of list) {
    const currency = String(acc?.currency ?? "").trim().toUpperCase();
    if (!currency) continue;
    const balance = Number(acc?.balance ?? 0);
    const locked = Number(acc?.locked ?? 0);
    if (!Number.isFinite(balance) || !Number.isFinite(locked)) continue;

    if (currency === "KRW") {
      krwAvailable += balance;
      krwLocked += locked;
      continue;
    }

    const quantity = balance + locked;
    if (!(quantity > 0)) continue;

    const symbol = bithumbBaseToUsdtSymbol(currency);
    const avgRaw = Number(acc?.avg_buy_price);
    holdings.push({
      currency,
      symbol: symbol ?? currency,
      name: symbol ? cryptoYahooUsdtDisplayName(symbol) : currency,
      quantity,
      available: balance,
      locked,
      avgBuyPrice:
        Number.isFinite(avgRaw) && avgRaw > 0 ? avgRaw : null,
    });
  }

  holdings.sort((a, b) => a.currency.localeCompare(b.currency, "en"));

  return {
    krw: {
      available: krwAvailable,
      locked: krwLocked,
      total: krwAvailable + krwLocked,
    },
    holdings,
  };
}

/**
 * @typedef {{
 *   currency: string;
 *   symbol: string;
 *   name: string;
 *   quantity: number;
 *   available: number;
 *   locked: number;
 *   avgBuyPrice: number | null;
 * }} BithumbAccountHoldingSummary
 */
