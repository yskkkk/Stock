import { cryptoSpotDisplayName } from "./crypto-display-names.js";
import { fetchBinanceTicker24hAll } from "./binance-usdt.js";

const CACHE_MS = 60_000;
let cache = null;
let cacheAt = 0;

const FIXED_CORE = [
  { symbol: "BTC-USDT", base: "BTC" },
  { symbol: "ETH-USDT", base: "ETH" },
  { symbol: "SOL-USDT", base: "SOL" },
];

const FIXED_BASES = new Set(FIXED_CORE.map((f) => f.base));

/** 스테이블·법정화 페어 등 — 거래량 상위 7종 후보에서 제외 */
const VOLUME_EXTRA_EXCLUDE = new Set([
  "USDC",
  "FDUSD",
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

/** USDT 현물 페어 (BTCUSDT 형태) */
function isUsdtSpotSymbol(sym) {
  const s = String(sym ?? "").toUpperCase();
  return /^[A-Z0-9]{2,20}USDT$/.test(s);
}

function baseFromBinanceUsdt(sym) {
  return sym.slice(0, -4);
}

/**
 * 고정 3종 + 거래량(USDT) 상위 7종, 전체를 quoteVolume 내림차순.
 * @returns {{ assets: Array<{ symbol: string, name: string, quoteVolume: number }>, updatedAt: number }}
 */
export async function loadCryptoWatchlistTen() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  const rows = await fetchBinanceTicker24hAll();
  if (!Array.isArray(rows)) {
    throw new Error("Binance ticker 전체 응답 형식 오류");
  }

  const usdtRows = rows.filter((r) => isUsdtSpotSymbol(r.symbol));
  usdtRows.sort(
    (a, b) => Number(b.quoteVolume || 0) - Number(a.quoteVolume || 0),
  );

  const byPair = new Map(usdtRows.map((r) => [r.symbol.toUpperCase(), r]));

  const fixedAssets = FIXED_CORE.map((f) => {
    const row = byPair.get(`${f.base}USDT`);
    const qv = row ? Number(row.quoteVolume) : 0;
    return {
      symbol: f.symbol,
      name: cryptoSpotDisplayName(f.base),
      quoteVolume: Number.isFinite(qv) ? qv : 0,
    };
  });

  const used = new Set(FIXED_BASES);
  const extras = [];
  for (const row of usdtRows) {
    const base = baseFromBinanceUsdt(row.symbol);
    if (used.has(base)) continue;
    if (VOLUME_EXTRA_EXCLUDE.has(base)) continue;
    used.add(base);
    const qv = Number(row.quoteVolume);
    extras.push({
      symbol: `${base}-USDT`,
      name: cryptoSpotDisplayName(base),
      quoteVolume: Number.isFinite(qv) ? qv : 0,
    });
    if (extras.length >= 7) break;
  }

  const merged = [...fixedAssets, ...extras];
  merged.sort((a, b) => b.quoteVolume - a.quoteVolume);

  const out = { assets: merged, updatedAt: now };
  cache = out;
  cacheAt = now;
  return out;
}
