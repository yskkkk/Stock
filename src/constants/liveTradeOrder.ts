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

/** 입력 중에도 최소 금액 미만 완성값은 거부(예: 10000원 미만 코인 5000 입력 불가) */
export function filterOrderAmountKrwInput(
  raw: string,
  markets: { kr?: boolean; us?: boolean; crypto?: boolean },
): string {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  if (digits === "") return "";
  const n = Number(digits);
  if (!Number.isFinite(n)) return "";
  const min = minOrderAmountKrwForMarkets(markets);
  if (n >= min) return digits;
  if (String(min).startsWith(digits)) return digits;
  return "";
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
