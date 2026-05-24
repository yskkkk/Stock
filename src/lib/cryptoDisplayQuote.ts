import type { QuoteResponse } from "../types";

export type CryptoPriceDisplay = "krw" | "usdt";

const STORAGE_KEY = "ystock-crypto-price-display";

export function readCryptoPriceDisplay(): CryptoPriceDisplay {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "usdt" ? "usdt" : "krw";
  } catch {
    return "krw";
  }
}

export function persistCryptoPriceDisplay(mode: CryptoPriceDisplay) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** 코인 탭 — Binance USDT 시세를 원화 UI 표시로 변환 */
export function cryptoQuoteForKrwDisplay(
  q: QuoteResponse | null | undefined,
  usdKrwRate: number | null,
): QuoteResponse | null {
  if (!q) return null;
  const cur = q.currency?.toUpperCase();
  if (cur === "KRW" || !cur) return q;

  const px = q.price;
  if (px == null || !Number.isFinite(px)) {
    return { ...q, currency: "KRW" };
  }

  const rate = usdKrwRate;
  if (cur === "USDT" && rate != null && rate > 0) {
    return {
      ...q,
      price: Math.round(px * rate),
      change:
        q.change != null && Number.isFinite(q.change)
          ? Math.round(q.change * rate)
          : q.change,
      currency: "KRW",
    };
  }

  return q;
}

/** 코인 탭 목록·헤더 시세 — 원화 / USDT(달러) 표시 */
export function applyCryptoPriceDisplay(
  q: QuoteResponse | null | undefined,
  mode: CryptoPriceDisplay,
  usdKrwRate: number | null,
): QuoteResponse | null {
  if (!q) return null;
  const cur = String(q.currency ?? "").toUpperCase();

  if (mode === "krw") {
    if (cur === "KRW" || !cur) return q;
    return cryptoQuoteForKrwDisplay(q, usdKrwRate) ?? q;
  }

  if (cur === "USDT") return q;
  if (
    cur === "KRW" &&
    usdKrwRate != null &&
    usdKrwRate > 0 &&
    q.price != null &&
    Number.isFinite(q.price)
  ) {
    const rate = usdKrwRate;
    return {
      ...q,
      price: q.price / rate,
      change:
        q.change != null && Number.isFinite(q.change)
          ? q.change / rate
          : q.change,
      turnover:
        q.turnover != null && Number.isFinite(q.turnover)
          ? q.turnover / rate
          : q.turnover,
      currency: "USDT",
    };
  }

  return q;
}
