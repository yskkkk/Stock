import { ko } from "./i18n/ko";
import { withApiBase, getWebBaseUrl } from "./lib/apiBase";
import type {
  ChartResponse,
  ChartTimeframe,
  CryptoQuotesResponse,
  CryptoUniverseResponse,
  FeedbackInboxResponse,
  MacroEventsResponse,
  Market,
  NewsResponse,
  PicksDailyHistoryResponse,
  PicksResponse,
  RecommendationsTrackerResponse,
  QuoteResponse,
  RefreshResponse,
  StockSearchResponse,
  StockTechnicalResponse,
  TelegramSentResponse,
  UsdKrwRateResponse,
} from "./types";

export interface StockData extends ChartResponse {
  quote: QuoteResponse;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const reqInit: RequestInit = init ?? {};
  const resolved = url.startsWith("/") ? withApiBase(url) : url;
  let res: Response;
  try {
    res = await fetch(resolved, reqInit);
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
        clearStockOpsInstructionDraft();
        redirectToAccessGate();
      }
    }
    throw new Error(data.error ?? data.message ?? ko.errors.request);
  }
  return data as T;
}

const ACCESS_ADMIN_TOKEN_KEY = "stock_access_admin_token";

/** 예전 운영 탭 요청 초안 키(저장 기능 제거 후). stale 값 제거·게이트 전환 시 비우기 용도로만 사용 */
export const STOCK_OPS_INSTRUCTION_DRAFT_KEY = "stock-app-ops-instruction-draft-v1";

function redirectToAccessGate(): void {
  if (typeof window === "undefined") return;
  const base = getWebBaseUrl();
  window.location.replace(base ? `${base}/access-gate.html` : "/access-gate.html");
}

export function clearStockOpsInstructionDraft(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STOCK_OPS_INSTRUCTION_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

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

export function fetchPicksDailyHistory() {
  return fetchJson<PicksDailyHistoryResponse>("/api/picks/daily-history");
}

export function fetchRecommendationsTracker(opts?: {
  quotes?: boolean;
  /** true면 스냅샷 무시하고 전체 재빌드 */
  refresh?: boolean;
}) {
  const params = new URLSearchParams();
  if (opts?.quotes === false) params.set("quotes", "0");
  if (opts?.refresh) params.set("refresh", "1");
  const q = params.toString() ? `?${params}` : "";
  return fetchJson<RecommendationsTrackerResponse>(
    `/api/picks/recommendations-tracker${q}`,
  );
}

export function fetchPicksDailyHistoryQuotes(
  symbols: string[],
  opts?: { fresh?: boolean },
) {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!uniq.length) {
    return Promise.resolve({ quotes: {} as PicksDailyHistoryQuotesMap });
  }
  const params = new URLSearchParams({ symbols: uniq.join(",") });
  if (opts?.fresh) params.set("fresh", "1");
  return fetchJson<{ quotes: PicksDailyHistoryQuotesMap }>(
    `/api/picks/daily-history/quotes?${params}`,
  );
}

export type PicksDailyHistoryQuotesMap = Record<
  string,
  {
    price: number;
    changePercent?: number;
    currency?: string;
    quotedAtMs?: number;
    interval?: string;
    priceSource?: "1m" | "over" | "regular" | string;
  }
>;

export function fetchLiveTradingMinuteQuotes(symbols: string[]) {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!uniq.length) {
    return Promise.resolve({
      quotes: {} as PicksDailyHistoryQuotesMap,
      interval: "1m" as const,
      updatedAtMs: Date.now(),
    });
  }
  const params = new URLSearchParams({ symbols: uniq.join(",") });
  return fetchJson<{
    quotes: PicksDailyHistoryQuotesMap;
    interval: "1m";
    updatedAtMs: number;
  }>(`/api/live-trading/quotes?${params}`);
}

export function fetchMacroEvents() {
  return fetchJson<MacroEventsResponse>("/api/macro-events");
}

export function fetchSectorEarnings() {
  return fetchJson<{ sectorEarnings: MacroEventsResponse["sectorEarnings"]; updatedAt: number }>(
    "/api/sector-earnings",
  );
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
      lastError?: { message: string; atMs: number; status: number | null } | null;
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
  | { type: "meta"; requestId: string }
  | { type: "phase"; message: string }
  | { type: "delta"; text: string }
  | { type: "cursor_status"; status: string; detail: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; toolStatus: string; detail?: string }
  | {
      type: "done";
      ok: true;
      status: string;
      result: string;
      durationMs?: number;
      runtime?: string;
    }
  | { type: "error"; message: string };

export type OpsAgentHistoryEntry = {
  id: string;
  state?: "waiting" | "running" | "ok" | "error" | "cancelled" | "rejected";
  startedAtMs?: number;
  updatedAtMs?: number;
  /** 완료 후에만 설정 (진행 중이면 null) */
  finishedAtMs: number | null;
  instruction: string;
  /** HTTP 요청 클라이언트 IP (프록시 시 X-Forwarded-For 첫 값 등) */
  requestIp?: string;
  error: string | null;
  phaseLine: string;
  cursorLine: string;
  thinkingLine: string;
  toolLine: string;
  /** read_file / write 등 도구 호출 누적(줄바꿈 구분) */
  toolLog?: string;
  streamText: string;
  statusText: string | null;
  resultText: string | null;
  durationMs: number | null;
  runtimeLabel: string | null;
  /** 사용자가 워크스페이스 반영 완료로 표시한 시각 — 재실행 UI에서 차단 */
  workspaceAppliedAtMs?: number | null;
};

export type OpsAgentHistoryResponse = {
  entries: OpsAgentHistoryEntry[];
};

export type OpsCursorAgentPendingResponse = {
  instruction: string;
  startedAtMs: number | null;
};

export type OpsAgentQueueSource = "web" | "ide";

export type OpsAgentQueueEntry = {
  id: string;
  requestIp: string;
  /** web=운영 탭 SSE·기록, ide=Cursor IDE 입력(단일 큐) */
  source?: OpsAgentQueueSource;
  instructionPreview: string;
  /** 큐 카드 도움말(title) 짧은 요약 — 서버 폴링 버전에서는 전체 초안 가능 */
  instructionTooltip?: string;
  /** 카드 클릭 팝업용 요청 원문(길면 생략) */
  instructionBody?: string;
  enqueuedAtMs: number;
  status: "running" | "waiting";
  /** 단일 실행 큐 기준 대기 순번(1-based, 에이전트·기록 모드 공통) */
  unifiedQueueSeq?: number;
};

export type OpsAgentQueueResponse = {
  entries: OpsAgentQueueEntry[];
  viewerIp?: string | null;
};

/** 허용 IP — 디스크 스냅샷 기반 개발 대기열(관리자 토큰 불필요) */
export type OpsDevQueueDisplayResponse = {
  updatedAtMs: number;
  agentEntries: OpsAgentQueueEntry[];
  recordItems: OpsRecordModeItem[];
  /** 관리자 Bearer 시에만 — 운영 탭「내 IP」필터용 */
  viewerIp?: string | null;
};

export function fetchOpsDevQueueDisplay(opts?: { includeViewerIp?: boolean }) {
  const headers: Record<string, string> = {};
  if (opts?.includeViewerIp) {
    const t = getStoredAccessAdminToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  return fetchJson<OpsDevQueueDisplayResponse>("/api/ops/dev-queue-display", {
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

export type OpsRecordModeItemStatus = "pending" | "running" | "done" | "error";

export type OpsRecordModeItem = {
  id: string;
  instruction: string;
  status: OpsRecordModeItemStatus;
  createdAtMs: number;
  lockedAtMs?: number | null;
  updatedAtMs?: number | null;
  error?: string | null;
  /** 단일 실행 큐 기준 순번. 대기 중(in-memory 미포함) pending만 파일 순으로 부여, 완료·오류는 null */
  unifiedQueueSeq?: number | null;
};

export type OpsRecordModeResponse = {
  items: OpsRecordModeItem[];
  pollIntervalMs: number;
};

export type OpsRecordModeEnqueueResponse = OpsRecordModeResponse & {
  ok: true;
  id: string;
};

/** 관리자 전용 — 기록 모드 큐(JSON 파일) 조회 */
export function fetchOpsRecordMode() {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsRecordModeResponse>("/api/ops/record-mode", {
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

/** 관리자 전용 — 기록 모드 큐 저장(서버가 실행 중 행은 보존) */
export function putOpsRecordMode(items: OpsRecordModeItem[]) {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsRecordModeResponse>("/api/ops/record-mode", {
    method: "PUT",
    headers,
    body: JSON.stringify({ items }),
  });
}

/** 관리자 전용 — 기록 모드 큐에 요청 한 건을 서버 파일에 pending으로 바로 추가(저장 버튼 불필요) */
export function postOpsRecordModeJob(instruction: string) {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsRecordModeEnqueueResponse>("/api/ops/record-mode/jobs", {
    method: "POST",
    headers,
    body: JSON.stringify({ instruction }),
  });
}

export type OpsRecordModeActivityEvent = "start" | "ok" | "error";

export type OpsRecordModeActivityEntry = {
  iso: string;
  source?: string;
  event: OpsRecordModeActivityEvent;
  id: string;
  instruction?: string;
  message?: string | null;
};

export type OpsRecordModeActivityResponse = {
  entries: OpsRecordModeActivityEntry[];
};

/** 관리자 전용 — 기록 모드 활동 로그(JSONL) 최근 건 조회 */
export function fetchOpsRecordModeActivity() {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsRecordModeActivityResponse>("/api/ops/record-mode/activity", {
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

export type OpsFileDevItemStatus = "pending" | "running" | "applied" | "error";

export type OpsFileDevItem = {
  id: string;
  requestJson: string;
  fingerprint?: string;
  status: OpsFileDevItemStatus;
  createdAtMs: number;
  lockedAtMs?: number | null;
  updatedAtMs?: number | null;
  error?: string | null;
  applySummary?: string | null;
};

export type OpsFileDevQueueResponse = {
  items: OpsFileDevItem[];
  appliedFingerprints: string[];
  pollIntervalMs: number;
};

export type OpsFileDevEnqueueResponse = OpsFileDevQueueResponse & {
  ok: true;
  id: string;
};

/** 관리자 전용 — 파일 반영 큐(JSON). 에이전트 없이 순차 디스크 반영 */
export function fetchOpsFileDevQueue() {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsFileDevQueueResponse>("/api/ops/file-dev-queue", {
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

/** 관리자 전용 — 파일 반영 큐 저장(실행 중 행은 보존) */
export function putOpsFileDevQueue(items: OpsFileDevItem[]) {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsFileDevQueueResponse>("/api/ops/file-dev-queue", {
    method: "PUT",
    headers,
    body: JSON.stringify({ items }),
  });
}

/** 관리자 전용 — 파일 반영 큐에 JSON 한 건을 서버 파일에 pending으로 바로 추가 */
export function postOpsFileDevJob(requestJson: string) {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsFileDevEnqueueResponse>("/api/ops/file-dev-queue/jobs", {
    method: "POST",
    headers,
    body: JSON.stringify({ requestJson }),
  });
}

/** 관리자 전용 — 동일 IP에서 진행 중인 SSE 요청(리다이렉트·새 탭 후 복원용) */
export function fetchOpsCursorAgentPending() {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsCursorAgentPendingResponse>("/api/ops/cursor-agent-pending", {
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

/**
 * @deprecated `fetchOpsDevQueueDisplay` 사용(표시 SSOT·100ms 폴링).
 * 레거시 라우트 — 응답은 dev-queue-display 디스크 스냅샷과 동일.
 */
export function fetchOpsCursorAgentQueue() {
  return fetchOpsDevQueueDisplay({ includeViewerIp: true }).then((snap) => ({
    entries: snap.agentEntries,
    viewerIp: snap.viewerIp ?? null,
  }));
}

/** 관리자 전용 — 서버에 저장된 에이전트 실행 이력 */
export function fetchOpsAgentHistory() {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsAgentHistoryResponse>("/api/ops/cursor-agent-history", {
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

/** 관리자 전용 — 서버 실행 이력 전체 삭제 */
export function deleteOpsAgentHistory() {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<{ ok: boolean }>("/api/ops/cursor-agent-history", {
    method: "DELETE",
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

/** 관리자 전용 — 완료·오류·중단·실행 중 포함 실행 이력 한 건 삭제 (실행 중이면 서버에서 중단) */
export function deleteOpsAgentHistoryEntry(id: string) {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<{ ok: boolean }>(
    `/api/ops/cursor-agent-history/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: Object.keys(headers).length ? headers : undefined,
    },
  );
}

/** 관리자 전용 — 실행 이력에「워크스페이스에 반영함」표시(재실행 버튼 비활성화용) */
export function postOpsAgentHistoryWorkspaceApplied(id: string, applied: boolean) {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsAgentHistoryResponse>(
    `/api/ops/cursor-agent-history/${encodeURIComponent(id)}/workspace-applied`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ applied }),
    },
  );
}

/** 관리자 전용 — 서버에서 해당 SSE 실행만 사용자 취소(abort) */
export function postOpsCursorAgentStreamCancel(runId: string) {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<{ ok: boolean }>("/api/ops/cursor-agent-stream/cancel", {
    method: "POST",
    headers,
    body: JSON.stringify({ runId }),
  });
}

/** 관리자 전용 — SSE로 에이전트 진행·델타·결과 수신 */
export async function fetchOpsCursorAgentStream(
  instruction: string,
  onEvent: (ev: OpsAgentSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    Accept: "text/event-stream",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(withApiBase("/api/ops/cursor-agent-stream"), {
    method: "POST",
    headers,
    body: JSON.stringify({ instruction }),
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    let msg: string = ko.errors.request;
    let accessDenied = false;
    try {
      const j = text ? JSON.parse(text) : {};
      if (typeof j.error === "string") msg = j.error;
      if (j.code === "ACCESS_DENIED") accessDenied = true;
      if (j.code === "OPS_QUEUE_FULL") msg = typeof j.error === "string" ? j.error : msg;
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
        clearStockOpsInstructionDraft();
        redirectToAccessGate();
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
  const dispatchSseChunk = (chunk: string) => {
    const lines = chunk.split(/\r?\n/).filter((l) => l.startsWith("data: "));
    for (const line of lines) {
      try {
        const ev = JSON.parse(line.slice(6)) as OpsAgentSseEvent;
        onEvent(ev);
      } catch {
        /* ignore malformed frame */
      }
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const m = /\r?\n\r?\n/.exec(buffer);
      if (!m || m.index === undefined) break;
      const chunk = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      dispatchSseChunk(chunk);
    }
  }
  if (buffer.trim()) {
    dispatchSseChunk(buffer);
  }
}

/** 관리자 전용 — 서버에서 로컬 Cursor 에이전트 실행 (수 분 소요 가능) */
export function postOpsCursorAgent(instruction: string) {
  const t = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<OpsCursorAgentResponse>("/api/ops/cursor-agent", {
    method: "POST",
    headers,
    body: JSON.stringify({ instruction }),
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

export interface TechWeightsResponse {
  weights: Record<string, number>;
  defaults: Record<string, number>;
  maxTechScore: number;
  revision: number;
  updatedAtMs: number | null;
  lastBaselineWinRatePct: number | null;
}

export function fetchTechWeights() {
  return fetchJson<TechWeightsResponse>("/api/picks/tech-weights");
}

export function applyTechWeights(body: {
  weights: Record<string, number>;
  baselineWinRatePct?: number;
}) {
  return fetchJson<{
    ok: boolean;
    weights: Record<string, number>;
    revision: number;
    maxTechScore: number;
    updatedAtMs: number;
  }>("/api/picks/tech-weights/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function resetTechWeights() {
  return fetchJson<TechWeightsResponse>("/api/picks/tech-weights/reset", {
    method: "POST",
  });
}

export interface TechModelRecord {
  id: string;
  name: string;
  weights: Record<string, number>;
  maxTechScore: number;
  createdAtMs: number;
  updatedAtMs?: number;
}

export interface TechModelsResponse {
  models: TechModelRecord[];
  activeModelIds: string[];
}

export function fetchTechModels() {
  return fetchJson<TechModelsResponse>("/api/picks/tech-models");
}

export function setActiveTechModelIds(activeModelIds: string[]) {
  return fetchJson<TechModelsResponse & { ok: boolean }>("/api/picks/tech-models/active", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeModelIds }),
  });
}

export function createTechModel(body: {
  name: string;
  weights?: Record<string, number>;
  copyFromId?: string;
}) {
  return fetchJson<TechModelsResponse & { ok: boolean; model: TechModelRecord }>(
    "/api/picks/tech-models",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function updateTechModel(
  id: string,
  body: { name?: string; weights?: Record<string, number> },
) {
  return fetchJson<TechModelsResponse & { ok: boolean; model: TechModelRecord }>(
    `/api/picks/tech-models/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function deleteTechModel(id: string) {
  return fetchJson<TechModelsResponse & { ok: boolean }>(
    `/api/picks/tech-models/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export type LiveTradeProgramStatus = "draft" | "armed" | "sim" | "paused" | "error";

export interface LiveTradeProgram {
  id: string;
  name: string;
  modelId: string;
  markets: { kr: boolean; us: boolean };
  minScoreRatio: number;
  maxOpenPositions: number;
  orderAmountKrw: number | null;
  orderAmountUsd: number | null;
  status: LiveTradeProgramStatus;
  armedAtMs: number | null;
  lastRunAtMs: number | null;
  lastError: string | null;
  simAutoBuy: boolean;
  autoSellAtTarget: boolean;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface TossTradingStatus {
  phase: "unconfigured" | "configured" | "ready";
  configured: boolean;
  ready: boolean;
  messageKo: string;
  hasSecret: boolean;
  baseUrl: string | null;
  docsHint: string;
}

export interface LiveTradeProgramReturnSummary {
  totalReturnPct: number | null;
  holdingCount: number;
}

export interface LiveTradingStatusResponse {
  toss: TossTradingStatus;
  programs: LiveTradeProgram[];
  programReturns: Record<string, LiveTradeProgramReturnSummary>;
  armedCount: number;
  simCount: number;
  simulatedOrders: boolean;
}

export function fetchLiveTradingStatus() {
  return fetchJson<LiveTradingStatusResponse>("/api/live-trading/status");
}

export interface LiveSimFeedbackApplyItem {
  field: string;
  label: string;
  reason: string;
}

export interface LiveSimFeedbackResponse {
  programId: string;
  programName: string;
  ready: boolean;
  message: string;
  stats: {
    closedCount: number;
    winCount: number;
    lossCount: number;
    winRatePct: number | null;
    avgWinPct?: string;
    avgLossPct?: string;
    targetWinCount?: number;
    stopLossCount?: number;
    openRoundHint?: number;
  };
  winFactors: string[];
  lossFactors: string[];
  suggestedPatch: Partial<{
    minScoreRatio: number;
    maxOpenPositions: number;
    simAutoBuy: boolean;
    autoSellAtTarget: boolean;
    modelId: string;
    markets: { kr?: boolean; us?: boolean };
    orderAmountKrw: number | null;
    orderAmountUsd: number | null;
  }>;
  applyItems: LiveSimFeedbackApplyItem[];
  signalInsights: { id: string; label: string; winRatePct: number; decided: number }[];
  generatedAtMs: number;
}

export function fetchLiveSimFeedback(programId: string) {
  return fetchJson<LiveSimFeedbackResponse>(
    `/api/live-trading/programs/${encodeURIComponent(programId)}/sim-feedback`,
  );
}

export function applyLiveSimFeedback(programId: string) {
  return fetchJson<{
    ok: boolean;
    program: LiveTradeProgram;
    analysis: LiveSimFeedbackResponse;
    programs: LiveTradeProgram[];
  }>(
    `/api/live-trading/programs/${encodeURIComponent(programId)}/sim-feedback/apply`,
    { method: "POST" },
  );
}

export interface LiveSimRecommendationItem {
  id: string;
  title: string;
  reason: string;
  patch: Partial<{
    modelId: string;
    minScoreRatio: number;
    maxOpenPositions: number;
    markets: { kr?: boolean; us?: boolean };
    simAutoBuy: boolean;
    autoSellAtTarget: boolean;
    orderAmountKrw: number | null;
    orderAmountUsd: number | null;
  }>;
  winRatePct?: number;
}

export interface LiveSimRecommendationsResponse {
  items: LiveSimRecommendationItem[];
  programLeaderboard: {
    programId: string;
    name: string;
    winRatePct: number;
    decided: number;
  }[];
  generatedAtMs: number;
}

export function fetchLiveSimRecommendations() {
  return fetchJson<LiveSimRecommendationsResponse>(
    "/api/live-trading/sim-recommendations",
  );
}

export function createLiveTradeProgram(body: {
  name: string;
  modelId: string;
  markets?: { kr?: boolean; us?: boolean };
  minScoreRatio?: number;
  maxOpenPositions?: number;
  orderAmountKrw?: number | null;
  orderAmountUsd?: number | null;
  simAutoBuy?: boolean;
  autoSellAtTarget?: boolean;
  takeProfitPct?: number | null;
  stopLossPct?: number | null;
}) {
  return fetchJson<{
    ok: boolean;
    program: LiveTradeProgram;
    programs: LiveTradeProgram[];
  }>("/api/live-trading/programs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateLiveTradeProgram(
  id: string,
  body: Partial<{
    name: string;
    modelId: string;
    markets: { kr?: boolean; us?: boolean };
    minScoreRatio: number;
    maxOpenPositions: number;
    orderAmountKrw: number | null;
    orderAmountUsd: number | null;
    simAutoBuy: boolean;
    autoSellAtTarget: boolean;
    takeProfitPct: number | null;
    stopLossPct: number | null;
  }>,
) {
  return fetchJson<{
    ok: boolean;
    program: LiveTradeProgram;
    programs: LiveTradeProgram[];
  }>(`/api/live-trading/programs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteLiveTradeProgram(id: string) {
  return fetchJson<{ ok: boolean; programs: LiveTradeProgram[] }>(
    `/api/live-trading/programs/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export function armLiveTradeProgram(id: string) {
  return fetchJson<{
    ok: boolean;
    program: LiveTradeProgram;
    toss: TossTradingStatus;
  }>(`/api/live-trading/programs/${encodeURIComponent(id)}/arm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function disarmLiveTradeProgram(id: string) {
  return fetchJson<{ ok: boolean; program: LiveTradeProgram }>(
    `/api/live-trading/programs/${encodeURIComponent(id)}/disarm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export function startSimLiveTradeProgram(id: string) {
  return fetchJson<{
    ok: boolean;
    program: LiveTradeProgram;
    programs: LiveTradeProgram[];
  }>(`/api/live-trading/programs/${encodeURIComponent(id)}/sim-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function stopSimLiveTradeProgram(id: string) {
  return fetchJson<{
    ok: boolean;
    program: LiveTradeProgram;
    programs: LiveTradeProgram[];
  }>(`/api/live-trading/programs/${encodeURIComponent(id)}/sim-stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export interface LiveTradeHolding {
  programId: string;
  programName?: string;
  symbol: string;
  name: string;
  market: "kr" | "us";
  quantity: number;
  avgEntryPrice: number;
  costBasis: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  changePct: number | null;
  grossChangePct: number | null;
  currency: string;
  openedAtMs: number;
  lastAtMs: number;
  targetSellPrice?: number | null;
  stopLossPrice?: number | null;
  exitScenarioNote?: string | null;
  entryStructureNote?: string | null;
  entryIdeal?: boolean;
  /** 1분봉 시세 시각(ms) */
  quoteQuotedAtMs?: number | null;
  priceSource?: "1m" | "over" | "regular" | null;
}

export interface LiveTradeRecord {
  id: string;
  programId: string;
  programName?: string;
  side: "buy" | "sell";
  symbol: string;
  name: string;
  market: "kr" | "us";
  quantity: number;
  price: number;
  amount: number;
  currency: string;
  feeAmount: number;
  simulated: boolean;
  orderId: string | null;
  note: string | null;
  atMs: number;
}

export interface LiveTradePortfolioSummary {
  holdingCount: number;
  investedOpen: number;
  marketValueOpen: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  totalReturnPct: number | null;
  tradeCount: number;
}

export interface LiveTradePortfolioResponse {
  updatedAtMs: number;
  programId: string | null;
  summary: LiveTradePortfolioSummary;
  holdings: LiveTradeHolding[];
  trades: LiveTradeRecord[];
}

export function fetchLiveTradingPortfolio(programId?: string | null) {
  const q = programId?.trim()
    ? `?programId=${encodeURIComponent(programId.trim())}`
    : "";
  return fetchJson<LiveTradePortfolioResponse>(`/api/live-trading/portfolio${q}`);
}

export function recordLiveTradeSell(body: {
  programId: string;
  symbol: string;
  market?: "kr" | "us";
  quantity?: number;
  price: number;
  note?: string;
  simulated?: boolean;
}) {
  return fetchJson<{
    ok: boolean;
    trade: LiveTradeRecord;
    portfolio: LiveTradePortfolioResponse;
  }>("/api/live-trading/trades/sell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface LiveTradeSimQuote {
  symbol: string;
  price: number;
  atMs: number;
  changePercent?: number;
}

export function simulateLiveTradeBuy(body: {
  programId: string;
  symbol: string;
  market: "kr" | "us";
  name?: string;
}) {
  return fetchJson<{
    ok: boolean;
    trade: LiveTradeRecord & { programName?: string };
    quote: LiveTradeSimQuote;
    portfolio: LiveTradePortfolioResponse;
  }>("/api/live-trading/simulate/buy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function simulateLiveTradeSell(body: {
  programId: string;
  symbol: string;
  market?: "kr" | "us";
  quantity?: number;
  note?: string;
}) {
  return fetchJson<{
    ok: boolean;
    trade: LiveTradeRecord & { programName?: string };
    quote: LiveTradeSimQuote;
    portfolio: LiveTradePortfolioResponse;
  }>("/api/live-trading/simulate/sell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

export function fetchStock(
  symbol: string,
  timeframe: ChartTimeframe,
  live = false,
  signal?: AbortSignal,
) {
  const liveParam = live ? "&live=1" : "";
  return fetchJson<StockData>(
    `/api/stock/${encodeURIComponent(symbol)}?timeframe=${timeframe}${liveParam}`,
    signal ? { signal } : undefined,
  );
}

export function fetchStockTechnical(
  symbol: string,
  opts?: { signal?: AbortSignal; modelId?: string },
) {
  const modelQ = opts?.modelId?.trim()
    ? `?modelId=${encodeURIComponent(opts.modelId.trim())}`
    : "";
  return fetchJson<StockTechnicalResponse>(
    `/api/stock/${encodeURIComponent(symbol)}/technical${modelQ}`,
    opts?.signal ? { signal: opts.signal } : undefined,
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

/** USD/KRW — KST 영업일 09:00 기준(Yahoo KRW=X 1분봉) */
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
  /** 허용 행에 부여된 위임 관리자(접속 IP 일치 시 관리자 API 사용 가능) */
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
  const base: AccessDeviceInfoPayload = { ...(deviceInfo ?? {}) };
  const includeDevice = Object.keys(base).length > 0;
  return fetchJson<{ ok: boolean; message: string }>("/api/access/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(includeDevice ? { deviceInfo: base } : {}),
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

/** 관리자만 — Vite dev 또는 API 프로세스 재기동 (비밀번호 필수) */
export function postAdminServerRestart(password: string) {
  const token = getStoredAccessAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchJson<{ ok: boolean; message?: string; mode?: string }>(
    "/api/admin/server-restart",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ password: String(password ?? "").trim() }),
    },
  );
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

