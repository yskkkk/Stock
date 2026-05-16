import { ko } from "./i18n/ko";
import type {
  ChartResponse,
  ChartTimeframe,
  CryptoQuotesResponse,
  CryptoUniverseResponse,
  FeedbackInboxResponse,
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
    feedbackInboxEnabled?: boolean;
    /** 서버 TELEGRAM_RESET_ADMIN_IPS에 포함된 클라이언트만 true */
    telegramResetAllowed?: boolean;
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

export type AccessClientState = "allowed" | "pending" | "rejected" | "none";

export interface AccessStatusResponse {
  enabled: boolean;
  state: AccessClientState;
  yourIp: string;
}

export type AccessDeviceInfoPayload = {
  userAgent?: string;
  platform?: string;
  language?: string;
  languages?: string;
  screen?: string;
  viewport?: string;
  timezone?: string;
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
  maxTouchPoints?: number | null;
  cookieEnabled?: boolean | null;
};

export interface AccessRequestItem {
  id: string;
  ip: string;
  userAgent: string;
  message: string;
  deviceInfo?: AccessDeviceInfoPayload | null;
  requestedAt: string;
  status: string;
}

export interface AccessAllowedEntry {
  ip: string;
  /** 관리자가 적은 식별 메모 */
  memo?: string;
  /** 승인 시점 신청자 메시지 (구 데이터는 `note`에만 있을 수 있음) */
  requestMessage?: string;
  /** 구버전: 신청 메시지가 note에만 저장됨 */
  note?: string;
  addedAt: string;
  fromRequestId?: string;
}

export interface AccessAdminSnapshot {
  pending: AccessRequestItem[];
  allowed: AccessAllowedEntry[];
  recent: AccessRequestItem[];
}

export function fetchAccessStatus() {
  return fetchJson<AccessStatusResponse>("/api/access/status", {
    cache: "no-store",
  });
}

export function postAccessRequest(
  message: string,
  deviceInfo?: AccessDeviceInfoPayload | null,
) {
  return fetchJson<{ ok: boolean; message: string }>("/api/access/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(deviceInfo ? { deviceInfo } : {}),
    }),
  });
}

export function fetchAccessAdminRequests(adminToken: string) {
  return fetchJson<AccessAdminSnapshot>("/api/access/admin/requests", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function postAccessAdminApprove(
  adminToken: string,
  id: string,
  memo?: string,
) {
  return fetchJson<{ ok: boolean }>("/api/access/admin/approve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      id,
      memo: (memo ?? "").trim().slice(0, 300),
    }),
  });
}

export function postAccessAdminAllowedMemo(
  adminToken: string,
  ip: string,
  memo: string,
) {
  return fetchJson<{ ok: boolean }>("/api/access/admin/allowed-memo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ ip, memo }),
  });
}

export function postAccessAdminReject(adminToken: string, id: string) {
  return fetchJson<{ ok: boolean }>("/api/access/admin/reject", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ id }),
  });
}

export function postAccessAdminRevoke(adminToken: string, ip: string) {
  return fetchJson<{ ok: boolean }>("/api/access/admin/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ ip }),
  });
}

export function postFeedbackMessage(message: string) {
  return fetchJson<{ ok: boolean }>("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

export function fetchFeedbackInbox(token: string) {
  return fetchJson<FeedbackInboxResponse>("/api/feedback/inbox", {
    headers: { Authorization: `Bearer ${token.trim()}` },
  });
}
