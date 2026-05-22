import {
  fetchCryptoQuotes,
  fetchCryptoUniverse,
  fetchLiveTradingPortfolio,
  fetchLiveTradingStatus,
  fetchMacroEvents,
  fetchPicksDailyHistory,
  fetchPicksDailyHistoryQuotes,
  fetchRecommendationsTracker,
  fetchSectorEarnings,
  fetchTechModels,
  type LiveTradingStatusResponse,
  type TechModelsResponse,
} from "../api";
import {
  applyTrackerQuotes,
  prioritizeTrackerSymbols,
} from "./recTrackerQuotes";
import { sortCryptoAssetsByTurnover, type CryptoAsset } from "../constants/crypto";
import type {
  MacroEvent,
  PicksDailyHistoryResponse,
  RecommendationsTrackerResponse,
  SectorEarningsSpotlightItem,
} from "../types";

const MACRO_SESSION_CACHE_KEY = "stock-macro-bar-v2";
const TRACKER_QUOTE_BATCH = 96;

const TTL_MS = {
  macro: 5 * 60_000,
  recTracker: 30_000,
  cryptoUniverse: 90_000,
  cryptoQuotes: 15_000,
  liveTrading: 30_000,
  picksHistory: 120_000,
} as const;

type CacheKey = keyof typeof TTL_MS;

/** @type {Map<CacheKey, { at: number; data: unknown }>} */
const cache = new Map();
/** @type {Map<CacheKey, Promise<unknown>>} */
const inflight = new Map();

const recListeners = new Set<(data: RecommendationsTrackerResponse) => void>();

function getCached<T>(key: CacheKey): T | null {
  const row = cache.get(key);
  if (!row) return null;
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
): Promise<RecommendationsTrackerResponse> {
  const syms = prioritizeTrackerSymbols(base.items, TRACKER_QUOTE_BATCH);
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
  const prev = peekRecommendationsTracker();
  return applyTrackerQuotes(base, freshQuotes, prev);
}

export async function prefetchRecommendationsTracker(): Promise<RecommendationsTrackerResponse> {
  return dedupe("recTracker", async () => {
    try {
      const snap = await fetchRecommendationsTracker({ quotes: false });
      const quick = await mergeRecTrackerQuotes(snap);
      notifyRecTracker(quick);
    } catch {
      /* refresh에서 복구 */
    }
    void fetchRecommendationsTracker({ quotes: false, refresh: true })
      .then((fresh) => mergeRecTrackerQuotes(fresh))
      .then((merged) => notifyRecTracker(merged))
      .catch(() => {});
    const cached = peekRecommendationsTracker();
    if (cached) return cached;
    const fresh = await fetchRecommendationsTracker({
      quotes: false,
      refresh: true,
    });
    const merged = await mergeRecTrackerQuotes(fresh);
    notifyRecTracker(merged);
    return merged;
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

let prefetchStarted = false;

/** config 로드 후 — 탭 미진입 데이터를 백그라운드로 선요청 */
export function startBackgroundTabPrefetch(): void {
  if (typeof window === "undefined" || prefetchStarted) return;
  prefetchStarted = true;

  scheduleIdle(() => {
    void prefetchMacroBundle();
    void prefetchRecommendationsTracker();
    void prefetchCryptoTabData();
    void prefetchLiveTradingTab();
    prefetchLiveTradingPortfolio();
    void prefetchPicksDailyHistory();
  });
}
