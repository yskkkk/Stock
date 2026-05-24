import { isBinanceUsdtSymbol } from "./binance-usdt.js";
import { getUsdKrwRate } from "./fx-usd-krw.js";

/** @typedef {"kr" | "us" | "crypto"} LiveTradeMarket */

/** 국내 주식 1회 매수 금액 하한(원) */
export const KR_MIN_ORDER_KRW = 10_000;
/** 코인(빗썸 KRW) 1회 매수 금액 하한(원) */
export const CRYPTO_MIN_ORDER_KRW = 10_000;

/**
 * @param {{ kr?: boolean; us?: boolean; crypto?: boolean } | null | undefined} markets
 */
export function minOrderAmountKrwForMarkets(markets) {
  if (markets?.crypto) return CRYPTO_MIN_ORDER_KRW;
  return KR_MIN_ORDER_KRW;
}

/**
 * @param {LiveTradeMarket} market
 * @param {number | null | undefined} amountKrw
 */
export function assertMinCryptoOrderAmountKrw(market, amountKrw) {
  if (market !== "crypto") return;
  const n = Number(amountKrw);
  if (!Number.isFinite(n) || n < CRYPTO_MIN_ORDER_KRW) {
    throw new Error(
      `코인 1회 매수 금액은 ${CRYPTO_MIN_ORDER_KRW.toLocaleString("ko-KR")}원 이상이어야 합니다.`,
    );
  }
}

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
  // 코인 시세는 빗썸 KRW 기준 → 통화도 KRW
  return market === "us" ? "USD" : "KRW";
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
  // crypto: KRW 기준. orderAmountUsd가 있으면 별도 환산 필요(resolveOrderAmountForMarket 사용 권장)
  return program.orderAmountKrw;
}

/**
 * 체결 수량 계산용 주문 금액(KRW 반환).
 * 코인: orderAmountUsd → 환율 곱해 KRW 환산(빗썸 KRW 시세로 나눔).
 *       orderAmountUsd 없으면 orderAmountKrw 그대로.
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {LiveTradeMarket} market
 */
export async function resolveOrderAmountForMarket(program, market) {
  if (market === "us") return program.orderAmountUsd;
  if (market === "crypto") {
    const usd = program.orderAmountUsd;
    if (usd != null && Number.isFinite(usd) && usd > 0) {
      try {
        const { rate } = await getUsdKrwRate();
        if (rate > 0) return Math.round(usd * rate);
      } catch (e) {
        console.warn("[live-trade:market] FX 조회 실패, KRW 금액으로 폴백:", e instanceof Error ? e.message : e);
      }
    }
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
