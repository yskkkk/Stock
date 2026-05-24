import { cryptoSpotDisplayName } from "./crypto-display-names.js";
import {
  bithumbTickerTurnoverKrw,
  fetchBithumbAllKrwTickers,
} from "./bithumb-krw.js";

const CACHE_MS = 60_000;
let cache = null;
let cacheAt = 0;

const FIXED_CORE = [
  { symbol: "BTC-USDT", base: "BTC" },
  { symbol: "ETH-USDT", base: "ETH" },
  { symbol: "SOL-USDT", base: "SOL" },
];

const FIXED_BASES = new Set(FIXED_CORE.map((f) => f.base));

/** 스테이블·법정화 페어 등 — 거래대금 상위 7종 후보에서 제외 */
const TURNOVER_EXTRA_EXCLUDE = new Set([
  "USDC",
  "USDT",
  "DAI",
  "TUSD",
  "BUSD",
  "USDP",
  "PYUSD",
  "USD1",
  "AEUR",
  "USDE",
  "BFUSD",
  "EUR",
  "GBP",
  "USTC",
  "RLUSD",
]);

/**
 * 고정 3종 + 빗썸 KRW 24h 거래대금 상위 7종, 전체를 거래대금 내림차순.
 * @returns {{ assets: Array<{ symbol: string, name: string, quoteTurnoverKrw: number }>, updatedAt: number }}
 */
export async function loadCryptoWatchlistTen() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  const all = await fetchBithumbAllKrwTickers();

  /** @type {Array<{ base: string; quoteTurnoverKrw: number }>} */
  const ranked = [];
  for (const [base, row] of Object.entries(all)) {
    if (!base || base === "date") continue;
    if (TURNOVER_EXTRA_EXCLUDE.has(base)) continue;
    const tv = bithumbTickerTurnoverKrw(row);
    if (tv <= 0) continue;
    ranked.push({ base, quoteTurnoverKrw: tv });
  }
  ranked.sort((a, b) => b.quoteTurnoverKrw - a.quoteTurnoverKrw);

  const byBase = new Map(ranked.map((r) => [r.base, r]));

  const fixedAssets = FIXED_CORE.map((f) => {
    const row = all[f.base];
    const tv = row
      ? bithumbTickerTurnoverKrw(row)
      : (byBase.get(f.base)?.quoteTurnoverKrw ?? 0);
    return {
      symbol: f.symbol,
      name: cryptoSpotDisplayName(f.base),
      quoteTurnoverKrw: Number.isFinite(tv) ? tv : 0,
    };
  });

  const used = new Set(FIXED_BASES);
  const extras = [];
  for (const { base, quoteTurnoverKrw } of ranked) {
    if (used.has(base)) continue;
    used.add(base);
    extras.push({
      symbol: `${base}-USDT`,
      name: cryptoSpotDisplayName(base),
      quoteTurnoverKrw,
    });
    if (extras.length >= 7) break;
  }

  const merged = [...fixedAssets, ...extras];
  merged.sort((a, b) => b.quoteTurnoverKrw - a.quoteTurnoverKrw);

  const out = { assets: merged, updatedAt: now };
  cache = out;
  cacheAt = now;
  return out;
}
