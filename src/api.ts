import { ko } from "./i18n/ko";
import type {
  ChartResponse,
  ChartTimeframe,
  CryptoQuotesResponse,
  CryptoUniverseResponse,
  FeedbackInboxResponse,
  MacroEventsResponse,
  Market,
  NewsResponse,
  PicksResponse,
  QuoteResponse,
  RefreshResponse,
  StockSearchResponse,
  TelegramSentResponse,
  UsdKrwRateResponse,
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
  let data: { error?: string; message?: string; code?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(ko.errors.parse);
  }
  if (!res.ok) {
    if (
      res.status === 403 &&
      data.code === "ACCESS_DENIED" &&
      typeof window !== "undefined"
    ) {
      if (!(window as unknown as { __stockAccessDeniedNav?: boolean }).__stockAccessDeniedNav) {
        (window as unknown as { __stockAccessDeniedNav?: boolean }).__stockAccessDeniedNav = true;
        try {
          clearStoredAccessAdminToken();
        } catch {
          /* ignore */
        }
        window.location.replace("/access-gate.html");
      }
    }
    throw new Error(data.error ?? data.message ?? ko.errors.request);
  }
  return data as T;
}

const ACCESS_ADMIN_TOKEN_KEY = "stock_access_admin_token";

export function getStoredAccessAdminToken(): string {
  if (typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(ACCESS_ADMIN_TOKEN_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** 관리자 모달·게이트와 동일 키 — 잠금/로그아웃 시 둘 다 비움 */
export function clearStoredAccessAdminToken(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(ACCESS_ADMIN_TOKEN_KEY);
    localStorage.removeItem(ACCESS_ADMIN_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** 세션에만 저장하고, 예전에 localStorage에 남은 동일 키는 제거(우선순위 꼬임 방지) */
export function persistAccessAdminToken(token: string): void {
  if (typeof sessionStorage === "undefined") return;
  const t = token.trim();
  if (!t) return;
  try {
    localStorage.removeItem(ACCESS_ADMIN_TOKEN_KEY);
    sessionStorage.setItem(ACCESS_ADMIN_TOKEN_KEY, t);
  } catch {
    /* ignore */
  }
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
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<{
    dartEnabled: boolean;
    telegramNotify?: {
      enabled: boolean;
      minAlertScore: number;
      todaySentCount?: number;
    };
    feedbackInboxEnabled?: boolean;
    telegramResetAllowed?: boolean;
    adminIpConsole?: boolean;
    accessAdmin?: boolean;
    opsCursorAgentAvailable?: boolean;
  }>("/api/config", Object.keys(headers).length ? { headers } : undefined);
}

export interface OpsCursorAgentResponse {
  ok: boolean;
  status: string;
  result: string;
  durationMs?: number;
}

export type OpsAgentSseEvent =
  | { type: "phase"; message: string }
  | { type: "delta"; text: string }
  | { type: "cursor_status"; status: string; detail: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; toolStatus: string }
  | {
      type: "done";
      ok: true;
      status: string;
      result: string;
      durationMs?: number;
      runtime?: string;
    }
  | { type: "error"; message: string };

/** 관리자 전용 — SSE로 에이전트 진행·델타·결과 수신 */
export async function fetchOpsCursorAgentStream(
  instruction: string,
  context: string,
  onEvent: (ev: OpsAgentSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    Accept: "text/event-stream",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch("/api/ops/cursor-agent-stream", {
    method: "POST",
    headers,
    body: JSON.stringify({ instruction, context }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg: string = ko.errors.request;
    let accessDenied = false;
    try {
      const j = text ? JSON.parse(text) : {};
      if (typeof j.error === "string") msg = j.error;
      if (j.code === "ACCESS_DENIED") accessDenied = true;
    } catch {
      if (text) msg = text.slice(0, 500);
    }
    if (
      res.status === 403 &&
      accessDenied &&
      typeof window !== "undefined"
    ) {
      if (!(window as unknown as { __stockAccessDeniedNav?: boolean }).__stockAccessDeniedNav) {
        (window as unknown as { __stockAccessDeniedNav?: boolean }).__stockAccessDeniedNav = true;
        try {
          clearStoredAccessAdminToken();
        } catch {
          /* ignore */
        }
        window.location.replace("/access-gate.html");
      }
    }
    throw new Error(msg);
  }
  if (!res.body) {
    throw new Error(ko.errors.network);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const m = /\r?\n\r?\n/.exec(buffer);
      if (!m || m.index === undefined) break;
      const chunk = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      const line = chunk.split(/\r?\n/).find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(6)) as OpsAgentSseEvent;
        onEvent(ev);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

/** 관리자 전용 — 서버에서 로컬 Cursor 에이전트 실행 (수 분 소요 가능) */
export function postOpsCursorAgent(instruction: string, context: string) {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsCursorAgentResponse>("/api/ops/cursor-agent", {
    method: "POST",
    headers,
    body: JSON.stringify({ instruction, context }),
  });
}

export function resetTelegramAlertHistory() {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<{ ok: boolean; removed: number; message: string }>(
    "/api/telegram/reset-sent",
    { method: "POST", headers: Object.keys(headers).length ? headers : undefined },
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

export function fetchStockSearch(
  query: string,
  market: Market,
  signal?: AbortSignal,
) {
  const q = query.trim();
  return fetchJson<StockSearchResponse>(
    `/api/stock-search?q=${encodeURIComponent(q)}&market=${market}`,
    signal ? { signal } : undefined,
  );
}

/** USD/KRW (Yahoo KRW=X, 서버 짧은 캐시) */
export function fetchUsdKrw(signal?: AbortSignal) {
  return fetchJson<UsdKrwRateResponse>(
    "/api/fx/usd-krw",
    signal ? { signal } : undefined,
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
  /** ACCESS_ADMIN_IPS — 게이트에서 관리자 패널 비밀번호 생략 */
  adminIpConsole?: boolean;
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
  /** 허용 IP에 부여된 위임 관리자(접속 IP 일치 시 관리자 API 사용 가능) */
  adminDelegate?: boolean;
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

/** adminToken 이 비면 등록 관리자 IP로만 호출 가능 */
export function fetchAccessAdminRequests(adminToken: string) {
  const headers: Record<string, string> = {};
  const t = adminToken.trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<AccessAdminSnapshot>("/api/access/admin/requests", {
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

function accessAdminPostHeaders(adminToken: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = adminToken.trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

export function postAccessAdminApprove(
  adminToken: string,
  id: string,
  memo?: string,
) {
  return fetchJson<{ ok: boolean }>("/api/access/admin/approve", {
    method: "POST",
    headers: accessAdminPostHeaders(adminToken),
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
    headers: accessAdminPostHeaders(adminToken),
    body: JSON.stringify({ ip, memo }),
  });
}

export function postAccessAdminReject(adminToken: string, id: string) {
  return fetchJson<{ ok: boolean }>("/api/access/admin/reject", {
    method: "POST",
    headers: accessAdminPostHeaders(adminToken),
    body: JSON.stringify({ id }),
  });
}

export function postAccessAdminRevoke(adminToken: string, ip: string) {
  return fetchJson<{ ok: boolean }>("/api/access/admin/revoke", {
    method: "POST",
    headers: accessAdminPostHeaders(adminToken),
    body: JSON.stringify({ ip }),
  });
}

export function postAccessAdminGrantDelegate(adminToken: string, ip: string) {
  return fetchJson<{ ok: boolean }>("/api/access/admin/grant-delegate", {
    method: "POST",
    headers: accessAdminPostHeaders(adminToken),
    body: JSON.stringify({ ip }),
  });
}

export function postAccessAdminRevokeDelegate(adminToken: string, ip: string) {
  return fetchJson<{ ok: boolean }>("/api/access/admin/revoke-delegate", {
    method: "POST",
    headers: accessAdminPostHeaders(adminToken),
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

export function fetchFeedbackInbox(token?: string) {
  const headers: Record<string, string> = {};
  const t = token?.trim() ?? "";
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<FeedbackInboxResponse>("/api/feedback/inbox", {
    headers: Object.keys(headers).length ? headers : undefined,
    cache: "no-store",
  });
}

export function postFeedbackAdminReply(adminToken: string, id: string, message: string) {
  return fetchJson<{ ok: boolean }>("/api/feedback/admin/reply", {
    method: "POST",
    headers: accessAdminPostHeaders(adminToken),
    body: JSON.stringify({ id, message }),
  });
}

export function postFeedbackAdminDelete(adminToken: string, id: string) {
  return fetchJson<{ ok: boolean }>("/api/feedback/admin/delete", {
    method: "POST",
    headers: accessAdminPostHeaders(adminToken),
    body: JSON.stringify({ id }),
  });
}
