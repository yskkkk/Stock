/**
 * 주요 지수 시세 — Yahoo 차트 스냅샷(일봉·전일대비).
 */
import { loadChartQuoteSnapshot } from "./stock-data.js";

const CACHE_MS = 50_000;
const FETCH_CONCURRENCY = 4;

/** @type {{ items: object[]; updatedAt: number; at: number } | null} */
let cached = null;

/** @typedef {{ id: string; symbol: string; label: string; region: "kr" | "us" }} MarketIndexDef */

/** @type {MarketIndexDef[]} */
export const MARKET_INDEX_DEFS = [
  { id: "kospi", symbol: "^KS11", label: "코스피", region: "kr" },
  { id: "kosdaq", symbol: "^KQ11", label: "코스닥", region: "kr" },
  { id: "nasdaq", symbol: "^IXIC", label: "나스닥", region: "us" },
  { id: "ndx", symbol: "^NDX", label: "나스닥100", region: "us" },
  { id: "sp500", symbol: "^GSPC", label: "S&P500", region: "us" },
  { id: "dow", symbol: "^DJI", label: "다우", region: "us" },
];

/**
 * @param {MarketIndexDef} def
 * @param {Awaited<ReturnType<typeof loadChartQuoteSnapshot>>} snap
 */
function rowFromSnap(def, snap) {
  const price =
    snap?.price != null && Number.isFinite(snap.price) && snap.price > 0
      ? snap.price
      : null;
  const changePercent =
    snap?.changePercent != null && Number.isFinite(snap.changePercent)
      ? snap.changePercent
      : null;
  return {
    id: def.id,
    symbol: def.symbol,
    label: def.label,
    region: def.region,
    price,
    changePercent,
    currency: snap?.currency ?? (def.region === "kr" ? "KRW" : "USD"),
    marketState: typeof snap?.marketState === "string" ? snap.marketState : undefined,
  };
}

/**
 * @param {MarketIndexDef[]} defs
 * @param {(def: MarketIndexDef) => Promise<object>} worker
 */
async function mapPool(defs, worker) {
  let i = 0;
  const n = Math.min(FETCH_CONCURRENCY, defs.length || 1);
  const out = /** @type {object[]} */ ([]);
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= defs.length) break;
        const def = defs[idx];
        try {
          const snap = await worker(def);
          out.push(rowFromSnap(def, snap));
        } catch {
          out.push(rowFromSnap(def, null));
        }
      }
    }),
  );
  const order = new Map(defs.map((d, i) => [d.id, i]));
  out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return out;
}

export async function getMarketIndices() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return { items: cached.items, updatedAt: cached.updatedAt };
  }

  const items = await mapPool(MARKET_INDEX_DEFS, (def) =>
    loadChartQuoteSnapshot(def.symbol),
  );
  const updatedAt = now;
  cached = { items, updatedAt, at: now };
  return { items, updatedAt };
}
