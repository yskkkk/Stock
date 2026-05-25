/**
 * 주요 지수·환율 시세 — Yahoo 차트 스냅샷(일봉·전일대비).
 */
import { loadChartQuoteSnapshot } from "./stock-data.js";

const CACHE_MS = 20_000;
const FETCH_CONCURRENCY = 4;

/** @type {{ items: object[]; updatedAt: number; at: number } | null} */
let cached = null;

/** @typedef {{ id: string; symbol: string; label: string; region: "kr" | "us"; kind?: "index" | "fx"; lookupMarket?: "kr" | "us" }} MarketIndexDef */

/** @type {MarketIndexDef[]} */
export const MARKET_INDEX_DEFS = [
  { id: "kospi", symbol: "^KS11", label: "코스피", region: "kr" },
  { id: "kosdaq", symbol: "^KQ11", label: "코스닥", region: "kr" },
  { id: "nasdaq", symbol: "^IXIC", label: "나스닥", region: "us" },
  { id: "nasdaq-futures", symbol: "NQ=F", label: "나스닥선물", region: "us" },
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
    kind: def.kind ?? "index",
    lookupMarket: def.lookupMarket ?? def.region,
    price,
    changePercent,
    currency: snap?.currency ?? (def.kind === "fx" || def.region === "kr" ? "KRW" : "USD"),
    marketState: typeof snap?.marketState === "string" ? snap.marketState : undefined,
  };
}

async function buildFxItem() {
  /** @type {MarketIndexDef} */
  const def = {
    id: "usdkrw",
    symbol: "KRW=X",
    label: "원/달러",
    region: "us",
    kind: "fx",
    lookupMarket: "us",
  };
  try {
    const snap = await loadChartQuoteSnapshot("KRW=X");
    return rowFromSnap(def, snap);
  } catch {
    return rowFromSnap(def, null);
  }
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

  const indexItems = await mapPool(MARKET_INDEX_DEFS, (def) =>
    loadChartQuoteSnapshot(def.symbol),
  );
  let fxItem;
  try {
    fxItem = await buildFxItem();
  } catch {
    fxItem = rowFromSnap(
      {
        id: "usdkrw",
        symbol: "KRW=X",
        label: "원/달러",
        region: "us",
        kind: "fx",
        lookupMarket: "us",
      },
      null,
    );
  }
  const items = [fxItem, ...indexItems];
  const updatedAt = now;
  cached = { items, updatedAt, at: now };
  return { items, updatedAt };
}
