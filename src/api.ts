import { ko } from "./i18n/ko";
import type {
  ChartResponse,
  ChartTimeframe,
  CryptoQuotesResponse,
  CryptoUniverseResponse,
  MacroEventsResponse,
  NewsResponse,
  PicksResponse,
  QuoteResponse,
  RefreshResponse,
  TelegramSentResponse,
} from "./types";

export interface StockData extends ChartResponse {
  quote: QuoteResponse;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(ko.errors.network);
    }
    throw err;
  }
  const text = await res.text();
  let data: { error?: string; message?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(ko.errors.parse);
  }
  if (!res.ok) throw new Error(data.error ?? data.message ?? ko.errors.request);
  return data as T;
}

export function fetchPicks() {
  return fetchJson<PicksResponse>("/api/picks");
}

export function fetchMacroEvents() {
  return fetchJson<MacroEventsResponse>("/api/macro-events");
}

export function refreshPicks() {
  return fetchJson<RefreshResponse>("/api/picks/refresh", { method: "POST" });
}

export function fetchConfig() {
  return fetchJson<{
    dartEnabled: boolean;
    telegramNotify?: {
      enabled: boolean;
      minAlertScore: number;
      todaySentCount?: number;
    };
  }>("/api/config");
}

export function resetTelegramAlertHistory() {
  return fetchJson<{ ok: boolean; removed: number; message: string }>(
    "/api/telegram/reset-sent",
    { method: "POST" },
  );
}

export function fetchTelegramSent() {
  return fetchJson<TelegramSentResponse>("/api/telegram/sent");
}

export function fetchNews(
  symbol: string,
  name: string,
  signal?: AbortSignal,
) {
  const q = name ? `?name=${encodeURIComponent(name)}` : "";
  return fetchJson<NewsResponse>(
    `/api/news/${encodeURIComponent(symbol)}${q}`,
    { signal },
  );
}

export function fetchStock(symbol: string, timeframe: ChartTimeframe, live = false) {
  const liveParam = live ? "&live=1" : "";
  return fetchJson<StockData>(
    `/api/stock/${encodeURIComponent(symbol)}?timeframe=${timeframe}${liveParam}`,
  );
}

/** 코인 탭 목록 — 고정 3 + 거래량 상위 7 (서버에서 정렬) */
export function fetchCryptoUniverse() {
  return fetchJson<CryptoUniverseResponse>("/api/crypto-universe");
}

/** 코인 목록 등 — 한 번에 여러 심볼 시세 (차트 캔들 없음) */
export function fetchCryptoQuotes(symbols: readonly string[]) {
  const q = symbols.join(",");
  return fetchJson<CryptoQuotesResponse>(
    `/api/crypto-quotes?symbols=${encodeURIComponent(q)}`,
  );
}
