/**
 * 코인(crypto) 텔레그램 알림 정책 — 운영자 요청으로 항상 OFF.
 * 스크리너 picks·박스권·카탈로그 스캔 등 crypto 채널 공통.
 */

/** 코인 텔레그램 발송 허용 — env로 켜지지 않음 */
export function cryptoTelegramNotifyEnabled() {
  return false;
}

/** @param {string} [market] */
export function isCryptoTelegramMarket(market) {
  return String(market ?? "").trim().toLowerCase() === "crypto";
}

/**
 * @param {{ market?: string; symbol?: string }} [ctx]
 */
export function isCryptoTelegramTarget(ctx) {
  if (!ctx || typeof ctx !== "object") return false;
  if (isCryptoTelegramMarket(ctx.market)) return true;
  const sym = String(ctx.symbol ?? "").trim().toUpperCase();
  if (!sym) return false;
  return sym.includes("USDT") || sym.endsWith("-USDT");
}

/**
 * @param {string} [market]
 * @param {{ market?: string; symbol?: string }} [ctx]
 */
export function shouldBlockCryptoTelegram(market, ctx) {
  if (cryptoTelegramNotifyEnabled()) return false;
  if (isCryptoTelegramMarket(market)) return true;
  return isCryptoTelegramTarget(ctx);
}
