import {
  fetchCryptoQuotes,
  fetchCryptoUniverse,
  fetchLiveTradingPortfolio,
  fetchLiveTradingStatus,
  fetchMacroEvents,
  fetchPicksDailyHistory,
  fetchPicksDailyHistoryQuotes,
  fetchGoldenCrossStatus,
  fetchRecommendationsTracker,
  fetchSectorEarnings,
  fetchStockSearchHot,
  fetchStockVault,
  fetchTechModels,
  type LiveTradingStatusResponse,
  type TechModelsResponse,
} from "../api";
import {
  isRecTrackerSnapshotStale,
  TRACKER_QUOTE_BATCH_INITIAL,
  TRACKER_QUOTE_BATCH_MAX,
} from "./recTrackerLoad";
import { applyTrackerQuotes, prioritizeTrackerSymbols } from "./recTrackerQuotes";
import { sortCryptoAssetsByTurnover, type CryptoAsset } from "../constants/crypto";
import type {
  MacroEvent,
  Market,
  PicksDailyHistoryResponse,
  RecommendationsTrackerResponse,
  SectorEarningsSpotlightItem,
  StockSearchQuoteRow,
  StockVaultResponse,
  StockVaultScanStatus,
} from "../types";

const MACRO_SESSION_CACHE_KEY = "stock-macro-bar-v2";
const TTL_MS = {
  macro: 5 * 60_000,
  recTracker: 30_000,
  cryptoUniverse: 90_000,
  cryptoQuotes: 15_000,
  liveTrading: 30_000,
  picksHistory: 120_000,
  stockSearchHotKr: 120_000,
  stockSearchHotUs: 120_000,
  stockVault: 60_000,
} as const;

type CacheKey = keyof typeof TTL_MS;

/** @type {Map<CacheKey, { at: number; data: unknown }>} */
const cache = new Map();
/** @type {Map<CacheKey, Promise<unknown>>} */
const inflight = new Map();

const recListeners = new Set<(data: RecommendationsTrackerResponse) => void>();

let stockVaultSessionPinned = false;

/** 종목보관 — 페이지를 떠나기 전까지 캐시 TTL 만료 없음 */
export function pinStockVaultSessionCache(): void {
  stockVaultSessionPinned = true;
}

export function isStockVaultSessionPinned(): boolean {
  return stockVaultSessionPinned;
}

function getCached<T>(key: CacheKey): T | null {
  const row = cache.get(key);
  if (!row) return null;
  if (key === "stockVault" && stockVaultSessionPinned) return row.data as T;
  if (Date.now() - row.at > TTL_MS[key]) return null;
  return row.data as T;
}

function setCached<T>(key: CacheKey, data: T): void {
  cache.set(key, { at: Date.now(), data });
}

function dedupe<T>(key: CacheKey, run: () => Promise<T>): Promise<T> {
  const hit = getCached<T>(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = run()
    .then((data) => {
      setCached(key, data);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

function writeMacroSessionCache(
  events: MacroEvent[],
  sectorEarnings: SectorEarningsSpotlightItem[],
) {
  try {
    sessionStorage.setItem(
      MACRO_SESSION_CACHE_KEY,
      JSON.stringify({ events, sectorEarnings, at: Date.now() }),
    );
  } catch {
    /* quota */
  }
}

function scheduleIdle(fn: () => void, timeoutMs = 2500) {
  if (typeof window === "undefined") return;
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => fn(), { timeout: timeoutMs });
  } else {
    window.setTimeout(fn, 500);
  }
}

export type MacroPrefetchBundle = {
  events: MacroEvent[];
  sectorEarnings: SectorEarningsSpotlightItem[];
};

export function peekMacroPrefetch(): MacroPrefetchBundle | null {
  return getCached<MacroPrefetchBundle>("macro");
}

export function peekRecommendationsTracker(): RecommendationsTrackerResponse | null {
  return getCached<RecommendationsTrackerResponse>("recTracker");
}

export function subscribeRecommendationsTrackerPrefetch(
  listener: (data: RecommendationsTrackerResponse) => void,
): () => void {
  const cached = peekRecommendationsTracker();
  if (cached) listener(cached);
  recListeners.add(listener);
  return () => recListeners.delete(listener);
}

function notifyRecTracker(data: RecommendationsTrackerResponse) {
  for (const fn of recListeners) {
    try {
      fn(data);
    } catch {
      /* ignore */
    }
  }
}

export async function prefetchMacroBundle(): Promise<MacroPrefetchBundle> {
  return dedupe("macro", async () => {
    const [macro, sector] = await Promise.all([
      fetchMacroEvents(),
      fetchSectorEarnings(),
    ]);
    const events = macro.events ?? [];
    const sectorEarnings = Array.isArray(sector.sectorEarnings)
      ? sector.sectorEarnings
      : [];
    if (events.length) writeMacroSessionCache(events, sectorEarnings);
    return { events, sectorEarnings };
  });
}

async function mergeRecTrackerQuotes(
  base: RecommendationsTrackerResponse,
  maxSymbols: number,
  prev?: RecommendationsTrackerResponse | null,
): Promise<RecommendationsTrackerResponse> {
  const syms = prioritizeTrackerSymbols(base.items, maxSymbols);
  let freshQuotes: Awaited<
    ReturnType<typeof fetchPicksDailyHistoryQuotes>
  >["quotes"] = {};
  if (syms.length) {
    try {
      freshQuotes = (await fetchPicksDailyHistoryQuotes(syms)).quotes;
    } catch {
      /* 시세 없이 기본 payload */
    }
  }
  const prior = prev ?? peekRecommendationsTracker();
  return applyTrackerQuotes(base, freshQuotes, prior);
}

export async function prefetchRecommendationsTracker(): Promise<RecommendationsTrackerResponse> {
  return dedupe("recTracker", async () => {
    let snap: RecommendationsTrackerResponse;
    try {
      snap = await fetchRecommendationsTracker({ quotes: false });
      setCached("recTracker", snap);
      notifyRecTracker(snap);
    } catch {
      const fresh = await fetchRecommendationsTracker({
        quotes: false,
        refresh: true,
      });
      const merged = await mergeRecTrackerQuotes(
        fresh,
        TRACKER_QUOTE_BATCH_INITIAL,
      );
      notifyRecTracker(merged);
      return merged;
    }

    const quick = await mergeRecTrackerQuotes(
      snap,
      TRACKER_QUOTE_BATCH_INITIAL,
    );
    notifyRecTracker(quick);

    if (TRACKER_QUOTE_BATCH_MAX > TRACKER_QUOTE_BATCH_INITIAL) {
      void mergeRecTrackerQuotes(snap, TRACKER_QUOTE_BATCH_MAX, quick)
        .then((full) => {
          setCached("recTracker", full);
          notifyRecTracker(full);
        })
        .catch(() => {});
    }

    if (isRecTrackerSnapshotStale(snap)) {
      void fetchRecommendationsTracker({ quotes: false, refresh: true })
        .then((fresh) =>
          mergeRecTrackerQuotes(fresh, TRACKER_QUOTE_BATCH_MAX, quick),
        )
        .then((merged) => {
          setCached("recTracker", merged);
          notifyRecTracker(merged);
        })
        .catch(() => {});
    }

    return quick;
  });
}

export function peekCryptoUniversePrefetch(): { assets: CryptoAsset[]; updatedAt?: number } | null {
  return getCached<{ assets: CryptoAsset[]; updatedAt?: number }>("cryptoUniverse");
}

export function peekCryptoListQuotesPrefetch(): Record<string, import("../types").QuoteResponse> | null {
  return getCached<Record<string, import("../types").QuoteResponse>>("cryptoQuotes");
}

export async function prefetchCryptoTabData(): Promise<void> {
  const uni = await dedupe("cryptoUniverse", async () => {
    const res = await fetchCryptoUniverse();
    const assets = res.assets?.length
      ? sortCryptoAssetsByTurnover(res.assets)
      : [];
    return { assets, updatedAt: res.updatedAt };
  });
  const symbols = uni.assets.map((a) => a.symbol).filter(Boolean);
  if (!symbols.length) return;
  await dedupe("cryptoQuotes", async () => {
    const res = await fetchCryptoQuotes(symbols);
    return res.quotes ?? {};
  });
}

export type LiveTradingPrefetch = {
  status: LiveTradingStatusResponse;
  techModels: TechModelsResponse;
};

export function peekLiveTradingPrefetch(): LiveTradingPrefetch | null {
  return getCached<LiveTradingPrefetch>("liveTrading");
}

export function invalidateLiveTradingPrefetch(): void {
  cache.delete("liveTrading");
  inflight.delete("liveTrading");
}

export async function prefetchLiveTradingTab(): Promise<LiveTradingPrefetch> {
  return dedupe("liveTrading", async () => {
    const [status, techModels] = await Promise.all([
      fetchLiveTradingStatus(),
      fetchTechModels(),
    ]);
    return { status, techModels };
  });
}

export function prefetchLiveTradingPortfolio(): void {
  void fetchLiveTradingPortfolio(null).catch(() => {});
}

export function peekPicksDailyHistoryPrefetch(): PicksDailyHistoryResponse | null {
  return getCached<PicksDailyHistoryResponse>("picksHistory");
}

export async function prefetchPicksDailyHistory(): Promise<PicksDailyHistoryResponse> {
  return dedupe("picksHistory", async () => {
    const data = await fetchPicksDailyHistory();
    try {
      localStorage.setItem("stock_picks_daily_history_v1", JSON.stringify(data));
    } catch {
      /* ignore */
    }
    return data;
  });
}

function stockSearchHotCacheKey(
  market: Market,
): "stockSearchHotKr" | "stockSearchHotUs" | null {
  if (market === "kr") return "stockSearchHotKr";
  if (market === "us") return "stockSearchHotUs";
  return null;
}

export function peekStockSearchHotPrefetch(market: Market): StockSearchQuoteRow[] | null {
  const key = stockSearchHotCacheKey(market);
  if (!key) return null;
  return getCached<StockSearchQuoteRow[]>(key);
}

/** 종목검색·재무 — 인기 종목(시장별) */
export function loadStockSearchHot(market: Market): Promise<StockSearchQuoteRow[]> {
  const key = stockSearchHotCacheKey(market);
  if (!key) return Promise.resolve([]);
  return dedupe(key, async () => {
    const data = await fetchStockSearchHot(market);
    return data.quotes ?? [];
  });
}

export async function prefetchStockSearchHotTabs(): Promise<void> {
  await Promise.all([loadStockSearchHot("kr"), loadStockSearchHot("us")]);
}

export type StockVaultPrefetch = {
  vault: StockVaultResponse;
  scanStatus: StockVaultScanStatus | null;
};

const vaultListeners = new Set<(data: StockVaultPrefetch) => void>();

export function peekStockVaultPrefetch(): StockVaultPrefetch | null {
  return getCached<StockVaultPrefetch>("stockVault");
}

export function subscribeStockVaultPrefetch(
  listener: (data: StockVaultPrefetch) => void,
): () => void {
  const cached = peekStockVaultPrefetch();
  if (cached) listener(cached);
  vaultListeners.add(listener);
  return () => vaultListeners.delete(listener);
}

function notifyStockVaultPrefetch(data: StockVaultPrefetch) {
  for (const fn of vaultListeners) {
    try {
      fn(data);
    } catch {
      /* ignore */
    }
  }
}

export function invalidateStockVaultPrefetch(): void {
  cache.delete("stockVault");
  inflight.delete("stockVault");
}

async function fetchStockVaultBundle(): Promise<StockVaultPrefetch> {
  const [vault, scanStatus] = await Promise.all([
    fetchStockVault(),
    fetchGoldenCrossStatus().catch(() => null),
  ]);
  return { vault, scanStatus };
}

export function loadStockVault(opts?: {
  refresh?: boolean;
}): Promise<StockVaultPrefetch> {
  const refresh = opts?.refresh === true;
  if (refresh) {
    return fetchStockVaultBundle().then((data) => {
      pinStockVaultSessionCache();
      setCached("stockVault", data);
      notifyStockVaultPrefetch(data);
      return data;
    });
  }
  return dedupe("stockVault", fetchStockVaultBundle).then((data) => {
    pinStockVaultSessionCache();
    notifyStockVaultPrefetch(data);
    return data;
  });
}

export async function refreshStockVaultTab(): Promise<StockVaultPrefetch> {
  invalidateStockVaultPrefetch();
  return loadStockVault();
}

export function updateStockVaultPrefetchVault(vault: StockVaultResponse): void {
  const existing = peekStockVaultPrefetch();
  const bundle: StockVaultPrefetch = {
    vault,
    scanStatus: existing?.scanStatus ?? null,
  };
  pinStockVaultSessionCache();
  setCached("stockVault", bundle);
  notifyStockVaultPrefetch(bundle);
}

export async function prefetchStockVaultTab(): Promise<StockVaultPrefetch> {
  return loadStockVault();
}

let prefetchStarted = false;

/** config 로드 후 — 탭 미진입 데이터를 백그라운드로 선요청 */
export function startBackgroundTabPrefetch(): void {
  if (typeof window === "undefined" || prefetchStarted) return;
  prefetchStarted = true;

  /* 종목보관 — 탭 진입 전 즉시 선로드(idle 대기 없음) */
  void prefetchStockVaultTab().catch(() => {});

  scheduleIdle(() => {
    void prefetchMacroBundle().catch(() => {});
    void prefetchRecommendationsTracker().catch(() => {});
    void prefetchCryptoTabData().catch(() => {});
    void prefetchLiveTradingTab().catch(() => {});
    prefetchLiveTradingPortfolio();
    void prefetchPicksDailyHistory().catch(() => {});
    void prefetchStockSearchHotTabs().catch(() => {});
  });
}
