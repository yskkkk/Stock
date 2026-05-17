import { loadChartQuoteSnapshot } from "./stock-data.js";

const TTL_MS = 15_000;
let cached = { rate: null, at: 0 };

/**
 * USD 1달러당 KRW (Yahoo KRW=X 스냅샷).
 * @returns {{ rate: number, updatedAt: number }}
 */
export async function getUsdKrwRate() {
  const now = Date.now();
  if (cached.rate != null && now - cached.at < TTL_MS) {
    return { rate: cached.rate, updatedAt: cached.at };
  }

  const quote = await loadChartQuoteSnapshot("KRW=X");
  const px = quote?.price;
  if (px == null || !Number.isFinite(px) || px <= 0) {
    throw new Error("원/달러 환율을 가져올 수 없습니다.");
  }

  cached = { rate: px, at: now };
  return { rate: px, updatedAt: now };
}
