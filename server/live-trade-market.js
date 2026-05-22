import { isBinanceUsdtSymbol } from "./binance-usdt.js";

/** @typedef {"kr" | "us" | "crypto"} LiveTradeMarket */

/** @param {string} symbol */
export function isCryptoSymbol(symbol) {
  return isBinanceUsdtSymbol(symbol);
}

/**
 * @param {unknown} market
 * @param {string} [symbol]
 * @returns {LiveTradeMarket}
 */
export function normalizeLiveTradeMarket(market, symbol) {
  const m = String(market ?? "").trim().toLowerCase();
  if (m === "crypto" || isCryptoSymbol(symbol)) return "crypto";
  if (m === "us") return "us";
  return "kr";
}

/** @param {LiveTradeMarket} market */
export function liveTradeCurrency(market) {
  return market === "us" || market === "crypto" ? "USD" : "KRW";
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {LiveTradeMarket} market
 */
export function programAllowsMarket(program, market) {
  const mk = program?.markets ?? {};
  if (market === "crypto") return Boolean(mk.crypto);
  if (market === "us") return Boolean(mk.us);
  return Boolean(mk.kr);
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {LiveTradeMarket} market
 */
export function orderAmountForMarket(program, market) {
  if (market === "us") return program.orderAmountUsd;
  if (market === "crypto") {
    if (program.orderAmountUsd != null) return program.orderAmountUsd;
    return program.orderAmountKrw;
  }
  return program.orderAmountKrw;
}

/**
 * @param {number} amount
 * @param {number} price
 * @param {LiveTradeMarket} market
 */
export function quantityFromOrderAmount(amount, price, market) {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0) {
    return 0;
  }
  let quantity = amount / price;
  if (market === "kr") return Math.max(1, Math.floor(quantity));
  if (market === "crypto") {
    quantity = Math.round(quantity * 1e8) / 1e8;
    return quantity > 0 ? quantity : 0;
  }
  quantity = Math.round(quantity * 10000) / 10000;
  return quantity > 0 ? quantity : 0;
}

/**
 * @param {number} quantity
 * @param {LiveTradeMarket} market
 */
export function normalizeSellQuantity(quantity, market) {
  let q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) return 0;
  if (market === "kr") return Math.floor(q);
  if (market === "crypto") return Math.round(q * 1e8) / 1e8;
  return Math.round(q * 10000) / 10000;
}
