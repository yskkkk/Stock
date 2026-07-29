/**
 * 주요 지수·환율 시세 — Yahoo 차트 스냅샷(일봉·전일대비).
 */
import { loadChartQuoteSnapshot } from "./stock-data.js";
import { waitForYahooQueueReady } from "./yahoo-queue.js";

const CACHE_MS = 20_000;
const FETCH_CONCURRENCY = 4;
const SNAPSHOT_RETRY_ATTEMPTS = 3;

/** @type {{ items: object[]; updatedAt: number; at: number } | null} */
let cached = null;
/** @type {Promise<{ items: object[]; updatedAt: number }> | null} */
let inflight = null;

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
function itemHasPrice(item) {
  return item?.price != null && Number.isFinite(item.price) && item.price > 0;
}

async function loadChartQuoteSnapshotWithRetry(symbol) {
  for (let attempt = 0; attempt < SNAPSHOT_RETRY_ATTEMPTS; attempt++) {
    try {
      const snap = await loadChartQuoteSnapshot(symbol);
      if (snap) return snap;
    } catch (err) {
      if (err?.code === "RATE_LIMIT" && attempt + 1 < SNAPSHOT_RETRY_ATTEMPTS) {
        await waitForYahooQueueReady({ minWaitMs: 800 * (attempt + 1), jitterMs: 300 });
        continue;
      }
    }
    break;
  }
  return null;
}

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
    const snap = await loadChartQuoteSnapshotWithRetry("KRW=X");
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

async function fetchMarketIndicesFresh() {
  const now = Date.now();
  const indexItems = await mapPool(MARKET_INDEX_DEFS, (def) =>
    loadChartQuoteSnapshotWithRetry(def.symbol),
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
  const hasAnyPrice = items.some(itemHasPrice);
  if (!hasAnyPrice && cached?.items?.some(itemHasPrice)) {
    return { items: cached.items, updatedAt: cached.updatedAt };
  }
  if (hasAnyPrice) {
    cached = { items, updatedAt, at: now };
  }
  return { items, updatedAt };
}

function kickMarketIndicesRefresh() {
  if (inflight) return inflight;
  inflight = fetchMarketIndicesFresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function getMarketIndices() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return { items: cached.items, updatedAt: cached.updatedAt };
  }
  // stale-while-revalidate: 만료 캐시가 있으면 즉시 반환하고 백그라운드 갱신
  if (cached?.items?.some(itemHasPrice)) {
    void kickMarketIndicesRefresh();
    return { items: cached.items, updatedAt: cached.updatedAt };
  }
  return kickMarketIndicesRefresh();
}

/** 서버 기동 시 Yahoo 스냅샷을 미리 채워 첫 페이지 로딩과 겹치게 */
export function prewarmMarketIndicesCache() {
  void kickMarketIndicesRefresh().catch((e) => {
    console.warn(
      "[market-indices] prewarm:",
      e instanceof Error ? e.message : e,
    );
  });
}
