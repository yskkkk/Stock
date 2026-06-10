import { GOLDEN_CROSS_MA_SLOW_PERIODS } from "./golden-cross-detect.js";
import {
  fetchKrNaverQuoteForSymbol,
  isKrQuoteSymbol,
  krNaverQuotesEnabled,
} from "./kr-naver-quote.js";
import {
  maxBarAgeDaysForVaultScan,
  normalizeVaultScanTimeframe,
} from "./vault-scan-timeframe.js";

/** detectDailyGoldenCrosses와 동일 — MA120 + 교차 판정용 */
export const GOLDEN_CROSS_MIN_CANDLES =
  Math.max(...GOLDEN_CROSS_MA_SLOW_PERIODS) + 1;

/**
 * @param {{ year: number; month: number; day: number } | number | undefined} time
 * @param {number} [nowMs]
 */
export function candleDayAgeDays(time, nowMs = Date.now()) {
  if (time == null) return Infinity;
  if (typeof time === "number" && Number.isFinite(time)) {
    const ms = time > 1e12 ? time : time * 1000;
    return (nowMs - ms) / 86_400_000;
  }
  if (typeof time === "object") {
    const y = Number(time.year);
    const m = Number(time.month);
    const d = Number(time.day);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      return Infinity;
    }
    return (nowMs - Date.UTC(y, m - 1, d)) / 86_400_000;
  }
  return Infinity;
}

function positivePrice(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * @param {unknown} data loadStock 결과
 * @param {"kr"|"us"} market
 * @param {{ nowMs?: number; maxBarAgeDays?: number; naverPrice?: number | null; timeframe?: import("./vault-scan-timeframe.js").VaultScanTimeframe }} [opts]
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
export function assessGoldenCrossTradable(data, market, opts = {}) {
  const timeframe = normalizeVaultScanTimeframe(opts.timeframe);
  const nowMs = opts.nowMs ?? Date.now();
  const maxBarAgeDays =
    opts.maxBarAgeDays ?? maxBarAgeDaysForVaultScan(timeframe);
  const candles = Array.isArray(data?.candles) ? data.candles : [];

  if (candles.length < GOLDEN_CROSS_MIN_CANDLES) {
    return { ok: false, reason: "insufficient_candles" };
  }

  const closes = candles
    .map((c) => Number(c?.close))
    .filter((v) => Number.isFinite(v));
  if (closes.length < GOLDEN_CROSS_MIN_CANDLES) {
    return { ok: false, reason: "invalid_closes" };
  }

  const price = positivePrice(data?.quote?.price);
  const currency = String(data?.quote?.currency ?? "").trim();
  if (price == null || !currency) {
    return { ok: false, reason: "no_quote" };
  }

  const lastBarAge = candleDayAgeDays(candles.at(-1)?.time, nowMs);
  if (!Number.isFinite(lastBarAge) || lastBarAge > maxBarAgeDays) {
    return { ok: false, reason: "stale_last_bar" };
  }

  if (market === "kr" && krNaverQuotesEnabled()) {
    const naverPx = positivePrice(opts.naverPrice);
    if (naverPx == null) {
      return { ok: false, reason: "kr_naver_unavailable" };
    }
  }

  return { ok: true };
}

/**
 * @param {unknown} data
 * @param {"kr"|"us"} market
 * @param {{ nowMs?: number; maxBarAgeDays?: number; timeframe?: import("./vault-scan-timeframe.js").VaultScanTimeframe }} [opts]
 */
export async function isGoldenCrossTradable(data, market, opts = {}) {
  /** @type {{ nowMs?: number; maxBarAgeDays?: number; naverPrice?: number | null }} */
  const merged = { ...opts };
  if (
    market === "kr" &&
    krNaverQuotesEnabled() &&
    isKrQuoteSymbol(String(data?.quote?.symbol ?? data?.symbol ?? ""))
  ) {
    const sym = String(data?.quote?.symbol ?? data?.symbol ?? "").toUpperCase();
    const naver = await fetchKrNaverQuoteForSymbol(sym);
    merged.naverPrice = naver?.price ?? null;
  }
  return assessGoldenCrossTradable(data, market, merged);
}
