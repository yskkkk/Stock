/** 국내 주식 1회 매수 금액 하한(원) */
export const KR_MIN_ORDER_KRW = 5_000;
/** 코인(빗썸 KRW) 1회 매수 금액 하한(원) */
export const CRYPTO_MIN_ORDER_KRW = 10_000;

export function minOrderAmountKrwForMarkets(markets: {
  kr?: boolean;
  us?: boolean;
  crypto?: boolean;
}): number {
  if (markets.crypto) return CRYPTO_MIN_ORDER_KRW;
  return KR_MIN_ORDER_KRW;
}

export function isOrderAmountKrwValid(
  raw: string,
  markets: { kr?: boolean; us?: boolean; crypto?: boolean },
): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  const n = Number(t);
  if (!Number.isFinite(n)) return false;
  return n >= minOrderAmountKrwForMarkets(markets);
}
