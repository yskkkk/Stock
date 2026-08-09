import { ko } from "./i18n/ko";
import { withApiBase, getWebBaseUrl } from "./lib/apiBase";
import type {
  ChartResponse,
  ChartTimeframe,
  CryptoQuotesResponse,
  CryptoUniverseResponse,
  BuffettIntrinsicValueResponse,
  ValueInvestReturnResponse,
  StockFundamentalsResponse,
  FinancialPeriodsResponse,
  FinancialStatementDetailResponse,
  FinancialStatementAnalysisResponse,
  FeedbackInboxResponse,
  MacroEventsResponse,
  MarketIndicesResponse,
  Market,
  NewsResponse,
  PicksDailyHistoryResponse,
  PicksResponse,
  RecommendationsTrackerResponse,
  QuoteResponse,
  RefreshResponse,
  StockSearchResponse,
  StockSearchHotResponse,
  StockTechnicalResponse,
  TelegramSentResponse,
  UsdKrwRateResponse,
} from "./types";

export interface StockData extends ChartResponse {
  quote: QuoteResponse;
}

const RETRYABLE_API_CODES = new Set(["API_NOT_FOUND", "API_UNHANDLED"]);

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms));
}

function isHtmlResponseBody(text: string): boolean {
  const head = text.trimStart().slice(0, 32).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

function isRetryableApiFailure(
  res: Response,
  data: { code?: string },
  parseErr: "html" | "parse" | null,
): boolean {
  if (parseErr === "html") return true;
  if (!res.ok && data.code && RETRYABLE_API_CODES.has(data.code)) return true;
  return res.status === 503 || res.status === 502 || res.status === 504;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const reqInit: RequestInit = {
    credentials: "include",
    ...init,
  };
  const resolved = url.startsWith("/") ? withApiBase(url) : url;
  const isApiPath = (() => {
    if (url.startsWith("/api")) return true;
    try {
      const base =
        typeof window !== "undefined" ? window.location.origin : "http://localhost";
      return new URL(resolved, base).pathname.startsWith("/api");
    } catch {
      return resolved.includes("/api");
    }
  })();
  const maxAttempts = isApiPath ? 3 : 1;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(resolved, reqInit);
    } catch (err) {
      if (err instanceof TypeError) {
        lastErr = new Error(ko.errors.network);
        if (isApiPath && attempt < maxAttempts - 1) {
          await sleep(450 * (attempt + 1));
          continue;
        }
        throw lastErr;
      }
      throw err;
    }

    const text = await res.text();
    let data: { error?: string; message?: string; code?: string } = {};
    let parseErr: "html" | "parse" | null = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      if (isHtmlResponseBody(text)) parseErr = "html";
      else parseErr = "parse";
    }

    if (parseErr) {
      lastErr = new Error(
        parseErr === "html" ? ko.errors.parseHtml : ko.errors.parse,
      );
      if (isApiPath && attempt < maxAttempts - 1) {
        await sleep(450 * (attempt + 1));
        continue;
      }
      throw lastErr;
    }

    if (
      isApiPath &&
      attempt < maxAttempts - 1 &&
      isRetryableApiFailure(res, data, null)
    ) {
      await sleep(450 * (attempt + 1));
      continue;
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

  throw lastErr instanceof Error ? lastErr : new Error(ko.errors.request);
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

export function fetchLiveTradingMinuteQuotes(
  symbols: string[],
  opts?: { signal?: AbortSignal },
) {
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
  }>(`/api/live-trading/quotes?${params}`, {
    signal: opts?.signal,
  });
}

export function fetchMacroEvents() {
  return fetchJson<MacroEventsResponse>("/api/macro-events");
}

export function fetchSectorEarnings() {
  return fetchJson<{ sectorEarnings: MacroEventsResponse["sectorEarnings"]; updatedAt: number }>(
    "/api/sector-earnings",
  );
}

export type UsAnnouncementKind =
  | "guidance"
  | "consensus"
  | "governance"
  | "earnings";

export type UsAnnouncementCard = {
  id: string;
  symbol: string;
  kind: UsAnnouncementKind;
  title: string;
  filedAt: number;
  source: string;
  form?: string | null;
  accession?: string | null;
  metrics: {
    consensusEps?: number | null;
    priorConsensusEps?: number | null;
    guidanceEps?: number | null;
    trailingEps?: number | null;
    yoyPct?: number | null;
    vsConsensusPct?: number | null;
    consensusChangePct?: number | null;
    period?: string | null;
    numAnalysts?: number | null;
  };
  ai: { summary: string; generatedAt: number; engine?: string };
  headline?: string | null;
  detail?: string | null;
  enrichedAt?: number | null;
  links: {
    edgar?: string | null;
    yahooAnalysis?: string | null;
    ir?: string | null;
  };
  notified?: { telegramAt?: number | null; emailAt?: number | null };
  createdAt: number;
};

export type UsAnnouncementsResponse = {
  ok: boolean;
  watchlist: string[];
  cards: UsAnnouncementCard[];
  updatedAt: number;
  cardCount: number;
};

export function fetchUsAnnouncements(opts?: {
  symbol?: string;
  kind?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.symbol) params.set("symbol", opts.symbol);
  if (opts?.kind) params.set("kind", opts.kind);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const q = params.toString();
  return fetchJson<UsAnnouncementsResponse>(
    `/api/us-announcements${q ? `?${q}` : ""}`,
  );
}

export function tickUsAnnouncements(body?: {
  notify?: boolean;
  symbols?: string[];
  historyImport?: boolean;
  historyDays?: number;
  filingLimit?: number;
}) {
  return fetchJson<{
    ok: boolean;
    watched: number;
    inserted: number;
    backfilled?: number;
    historyImport?: boolean;
    historyDays?: number | null;
    cards: UsAnnouncementCard[];
    errors: unknown[];
  }>("/api/us-announcements/tick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function addUsAnnouncementWatch(symbol: string) {
  return fetchJson<{ ok: boolean; watchlist: string[] }>(
    "/api/us-announcements/watchlist/add",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    },
  );
}

export function seedUsAnnouncement(body: {
  symbol?: string;
  kind?: UsAnnouncementKind;
  title?: string;
  metrics?: UsAnnouncementCard["metrics"];
  notify?: boolean;
}) {
  return fetchJson<{
    ok: boolean;
    inserted: boolean;
    card: UsAnnouncementCard | null;
  }>("/api/us-announcements/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchSp500Sectors() {
  return fetchJson<import("./lib/sp500SectorChart").Sp500SectorsPayload>(
    "/api/sp500-sectors",
  );
}

export type NasdaqEtfRow = {
  symbol: string;
  name: string;
  nameKo: string | null;
  description: string | null;
  categoryKo: string | null;
  exchange: string | null;
  exchangeDisp: string | null;
  price: number | null;
  changePercent: number | null;
  netAssets: number | null;
};

export type NasdaqEtfsPayload = {
  etfs: NasdaqEtfRow[];
  count: number;
  updatedAt: number;
  source: string;
  /** 거래소 스크리너 수집 중 — 목록이 계속 늘어날 수 있음 */
  building?: boolean;
  /** 한글·분류 보강 중 */
  enriching?: boolean;
};

export function fetchNasdaqEtfs(opts?: { refresh?: boolean }) {
  const q = opts?.refresh ? "?refresh=1" : "";
  return fetchJson<NasdaqEtfsPayload>(`/api/nasdaq-etfs${q}`);
}

export type NasdaqEtfHoldingRow = {
  symbol: string;
  name: string;
  nameKo: string | null;
  weight: number | null;
};

export type NasdaqEtfHoldingsPayload = {
  symbol: string;
  name: string;
  description?: string | null;
  family: string | null;
  category: string | null;
  holdings: NasdaqEtfHoldingRow[];
  /** 표시된 상위 보유 비중 합(0~1). Yahoo는 보통 상위 10개만 줌 → 100% 미만 */
  holdingsWeightSum?: number;
  /** 1 - holdingsWeightSum (미표시 나머지) */
  holdingsOtherWeight?: number;
  sectors: Array<{ key: string; label: string; weight: number }>;
  allocation: {
    stock: number | null;
    bond: number | null;
    cash: number | null;
    other: number | null;
    preferred: number | null;
    convertible: number | null;
  } | null;
  proxyOf?: string | null;
  updatedAt: number;
  source: string;
  note: string | null;
};

export function fetchNasdaqEtfHoldings(symbol: string) {
  const sym = encodeURIComponent(String(symbol ?? "").trim());
  return fetchJson<NasdaqEtfHoldingsPayload>(
    `/api/nasdaq-etfs/${sym}/holdings`,
  );
}

export type RedditMentionRow = {
  rank: number;
  symbol: string;
  name: string;
  nameKo?: string | null;
  mentions: number;
  upvotes: number;
  rank24hAgo: number | null;
  mentions24hAgo: number | null;
  mentionsDelta: number;
  rankDelta: number | null;
};

export type RedditMentionsPayload = {
  filter: string;
  filterLabelKo: string;
  page: number;
  pages: number;
  count: number;
  results: RedditMentionRow[];
  updatedAt: number;
  source: string;
  sourceNote: string;
  filters: Array<{ id: string; labelKo: string }>;
};

export function fetchRedditMentions(opts?: {
  filter?: string;
  page?: number;
  pages?: number;
}) {
  const q = new URLSearchParams();
  if (opts?.filter) q.set("filter", opts.filter);
  if (opts?.page) q.set("page", String(opts.page));
  if (opts?.pages) q.set("pages", String(opts.pages));
  const qs = q.toString();
  return fetchJson<RedditMentionsPayload>(
    `/api/reddit-mentions${qs ? `?${qs}` : ""}`,
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
  | { type: "cursor_status"; status: string; detail: string; message?: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; toolStatus: string; detail?: string }
  | {
      type: "done";
      ok: true;
      status: string;
      message?: string;
      result: string;
      durationMs?: number;
      runtime?: string;
      runtimeLabel?: string;
    }
  | { type: "error"; message: string };

export type OpsCursorAgentPendingResponse = {
  instruction: string;
  startedAtMs: number | null;
};

export type OpsAgentQueueSource = "web" | "ide" | "claude-code";

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

/** 실매매 프로그램 등록 — 로그인 사용자, 박스권 가상 모델 포함 */
export function fetchLiveTradeTechModels() {
  return fetchJson<TechModelsResponse>("/api/live-trading/tech-models");
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

export interface AuthUser {
  id: string;
  email: string;
  emailVerified?: boolean;
}

export interface AuthMeResponse {
  user: AuthUser;
  registrationOpen?: boolean;
  emailVerificationRequired?: boolean;
}

const AUTH_ME_TTL_MS = 8_000;
/** @type {{ at: number; data: AuthMeResponse } | null} */
let authMeCache: { at: number; data: AuthMeResponse } | null = null;
/** @type {Promise<AuthMeResponse> | null} */
let authMeInflight: Promise<AuthMeResponse> | null = null;

export function fetchAuthMe() {
  const now = Date.now();
  if (authMeCache && now - authMeCache.at < AUTH_ME_TTL_MS) {
    return Promise.resolve(authMeCache.data);
  }
  if (authMeInflight) return authMeInflight;
  authMeInflight = fetchJson<AuthMeResponse>("/api/auth/me")
    .then((data) => {
      authMeCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      authMeInflight = null;
    });
  return authMeInflight;
}

/** 로그인·로그아웃 직후 캐시 무효화 */
export function invalidateAuthMeCache() {
  authMeCache = null;
  authMeInflight = null;
}

export function loginAuth(
  email: string,
  password: string,
  verificationCode: string,
) {
  invalidateAuthMeCache();
  return fetchJson<{ ok: boolean; user: AuthUser }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, verificationCode }),
  }).then((data) => {
    if (data?.user) {
      authMeCache = {
        at: Date.now(),
        data: { user: data.user },
      };
    }
    return data;
  });
}

export function sendAuthEmailVerificationCode(
  email: string,
  purpose: "register" | "login" = "register",
) {
  return fetchJson<{
    ok: boolean;
    purpose?: "register" | "login";
    expiresInSec: number;
    devCode?: string;
  }>("/api/auth/email/send-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, purpose }),
  });
}

export function verifyAuthEmailCode(
  email: string,
  verificationCode: string,
  purpose: "register" | "login" = "register",
) {
  return fetchJson<{ ok: boolean; purpose?: "register" | "login" }>(
    "/api/auth/email/verify-code",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, verificationCode, purpose }),
    },
  );
}

export function registerAuth(
  email: string,
  password: string,
  verificationCode: string,
) {
  return fetchJson<{ ok: boolean; user: AuthUser }>("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, verificationCode }),
  });
}

export function logoutAuth() {
  invalidateAuthMeCache();
  return fetchJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export function verifyAccountPassword(password: string) {
  return fetchJson<{ ok: boolean }>("/api/auth/verify-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export interface UserCredentialMeta {
  exchange: "bithumb" | "toss";
  configured: boolean;
  ready: boolean;
  liveOrdersEnabled: boolean;
  hasSecret: boolean;
  hasAccount?: boolean;
  messageKo: string;
  source?: "user" | "env" | "none";
  updatedAtMs?: number | null;
}

export interface UserCredentialsResponse {
  ok: boolean;
  cryptoReady: boolean;
  bithumb: UserCredentialMeta;
  toss: UserCredentialMeta;
}

export function fetchUserCredentials() {
  return fetchJson<UserCredentialsResponse>("/api/user/credentials");
}

export function fetchBithumbAccountSnapshot(opts?: { refresh?: boolean }) {
  const q =
    opts?.refresh === true
      ? "?refresh=1"
      : "";
  return fetchJson<{
    ok: boolean;
    ready: boolean;
    snapshot?: BithumbTestSnapshot;
    feeLabelKo?: string | null;
    messageKo?: string;
    error?: string;
    fromCache?: boolean;
    syncedAtMs?: number | null;
    stale?: boolean;
  }>(`/api/user/bithumb/account-snapshot${q}`);
}

export function fetchTossAccountSnapshot(opts?: { refresh?: boolean }) {
  const q =
    opts?.refresh === true
      ? "?refresh=1"
      : "";
  return fetchJson<{
    ok: boolean;
    ready: boolean;
    snapshot?: TossTestSnapshot;
    feeLabelKo?: string | null;
    tossRoundTripFeeRate?: number | null;
    tossFeeRatesByMarket?: TossFeeRatesByMarket | null;
    messageKo?: string;
    error?: string;
    fromCache?: boolean;
    syncedAtMs?: number | null;
    stale?: boolean;
  }>(`/api/user/toss/account-snapshot${q}`);
}

export type AccountHoldingStyleOverride = "growth" | "value";

export type AccountHoldingStyleSnapshot = {
  ok: boolean;
  policy?: {
    version: number;
    priority: string[];
    growthGics: string[];
    valueGics: string[];
    seedTickers: Record<string, AccountHoldingStyleOverride>;
  };
  overrides: Record<string, AccountHoldingStyleOverride>;
  seededAtMs?: number | null;
  updatedAtMs?: number | null;
  error?: string;
};

export function fetchAccountHoldingStyle() {
  return fetchJson<AccountHoldingStyleSnapshot>(
    "/api/user/account-holding-style",
  );
}

export function putAccountHoldingStyleOverride(
  symbol: string,
  style: AccountHoldingStyleOverride | null,
) {
  return fetchJson<AccountHoldingStyleSnapshot & { ticker?: string }>(
    "/api/user/account-holding-style/override",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, style }),
    },
  );
}

export function saveUserCredential(
  exchange: "bithumb" | "toss",
  body: {
    apiKey?: string;
    secretKey?: string;
    /** 토스 — TOSS_ACCOUNT_ID */
    accountId?: string;
    liveOrdersEnabled?: boolean;
    /** 기존 API 변경 시 로그인 계정 비밀번호 */
    accountPassword?: string;
  },
) {
  return fetchJson<{ ok: boolean; credential: UserCredentialMeta }>(
    `/api/user/credentials/${encodeURIComponent(exchange)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function deleteUserCredential(
  exchange: "bithumb" | "toss",
  accountPassword: string,
) {
  return fetchJson<{ ok: boolean }>(
    `/api/user/credentials/${encodeURIComponent(exchange)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountPassword }),
    },
  );
}

export interface BithumbTestHolding {
  currency: string;
  symbol: string;
  name: string;
  quantity: number;
  available: number;
  locked: number;
  avgBuyPrice: number | null;
  currentPrice?: number | null;
  marketValue?: number | null;
  changePercent?: number | null;
  /** 평단 대비 수익률(%) */
  returnPercent?: number | null;
}

export interface BithumbTestSnapshot {
  krw: { available: number; locked: number; total: number };
  holdings: BithumbTestHolding[];
}

export interface TossTestHolding {
  symbol: string;
  rawSymbol?: string;
  name: string;
  market: "kr" | "us";
  currency: "KRW" | "USD";
  quantity: number;
  /** 매수 평균가(거래 통화). 미국=달러 평단 */
  avgBuyPrice: number | null;
  currentPrice?: number | null;
  marketValue?: number | null;
  /** 토스 매입금액(거래 통화) */
  purchaseAmount?: number | null;
  /** 토스 손익금액(거래 통화) */
  profitLossAmount?: number | null;
  returnPercent?: number | null;
  dailyChangePercent?: number | null;
}

export interface TossTestSnapshot {
  cash: { krw: number; usd: number };
  summary?: {
    profitLossKrw?: number | null;
    profitLossUsd?: number | null;
    marketValueKrw?: number | null;
    marketValueUsd?: number | null;
    purchaseAmountKrw?: number | null;
    purchaseAmountUsd?: number | null;
    /** 보유 매입 대비 총수익률(%) — 토스 overview(현재 환율 원화 환산) */
    totalReturnPct?: number | null;
  };
  holdings: TossTestHolding[];
}

export interface BithumbTradingFees {
  bidFee: number;
  askFee: number;
  roundTripFeeRate: number;
  market?: string;
}

export interface UserCredentialTestResult {
  ok: boolean;
  messageKo: string;
  exchange?: string;
  accountCount?: number;
  bithumbSnapshot?: BithumbTestSnapshot;
  tossSnapshot?: TossTestSnapshot;
  tradingFees?: BithumbTradingFees | null;
}

export function testUserCredential(
  exchange: "bithumb" | "toss",
  body?: { apiKey?: string; secretKey?: string; accountId?: string },
) {
  return fetchJson<UserCredentialTestResult>(
    `/api/user/credentials/${encodeURIComponent(exchange)}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
  );
}

export type LiveTradeProgramStatus = "draft" | "armed" | "sim" | "paused" | "error";

export interface LiveTradeProgram {
  id: string;
  name: string;
  modelId: string;
  markets: { kr: boolean; us: boolean; crypto: boolean };
  minScoreRatio: number;
  maxOpenPositions: number;
  orderAmountKrw: number | null;
  orderAmountUsd: number | null;
  /** 시뮬 전용 투자원금(현금 한도) */
  simInitialCapitalKrw?: number | null;
  /** 시뮬 전용 투자원금(현금 한도) */
  simInitialCapitalUsd?: number | null;
  status: LiveTradeProgramStatus;
  armedAtMs: number | null;
  lastRunAtMs: number | null;
  lastError: string | null;
  simAutoBuy: boolean;
  autoSellAtTarget: boolean;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  sellHorizon?: "short" | "medium" | "long";
  armedMarkets?: { kr: boolean; crypto: boolean };
  userId?: string | null;
  ownerEmail?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export type LiveTradeArmLane = "bithumb" | "toss";

export interface TossTradingStatus {
  phase: "unconfigured" | "configured" | "ready";
  configured: boolean;
  ready: boolean;
  messageKo: string;
  hasSecret: boolean;
  baseUrl: string | null;
  docsHint: string;
}

export interface BithumbTradingStatus {
  phase: "unconfigured" | "configured" | "ready";
  configured: boolean;
  ready: boolean;
  messageKo: string;
  liveOrdersEnabled: boolean;
  docsHint: string;
}

export interface LiveTradeProgramReturnSummary {
  totalReturnPct: number | null;
  holdingCount: number;
  tradeCount?: number;
  realizedPnl?: number;
  totalPnl?: number;
}

export interface ExchangeTradingFeeRateInfo {
  roundTripFeeRate: number;
  krRoundTripFeeRate?: number;
  usRoundTripFeeRate?: number;
  bidFee: number | null;
  askFee: number | null;
  source: "api" | "default" | "env";
  labelKo: string;
  market: string | null;
  updatedAtMs: number | null;
}

export type TossFeeRatesByMarket = {
  kr?: number | null;
  us?: number | null;
  source?: "api" | "default" | "env";
};

export interface LiveTradingFeeRates {
  defaultRoundTripFeeRate: number;
  bithumb: ExchangeTradingFeeRateInfo | null;
  toss: ExchangeTradingFeeRateInfo;
}

export interface LiveTradingStatusResponse {
  toss: TossTradingStatus;
  bithumb: BithumbTradingStatus;
  programs: LiveTradeProgram[];
  programReturns: Record<string, LiveTradeProgramReturnSummary>;
  armedCount: number;
  simCount: number;
  simulatedOrders: boolean;
  tossSimulatedOrders?: boolean;
  bithumbSimulatedOrders?: boolean;
  credentialsCryptoReady?: boolean;
  feeRates?: LiveTradingFeeRates;
}

export interface BoxRangeOverlayBox {
  boxId: string;
  top: number;
  bottom: number;
  mid: number;
  timeframe: string;
  state: string;
  leftTime: number;
  rightTime: number;
}

export type BoxRangeOverlayScan = Partial<
  Record<"1h" | "4h" | "1d", "found" | "none" | "error">
>;

export function fetchBoxRangeOverlay(symbol: string, chartTimeframe?: string) {
  const q = new URLSearchParams({ symbol: symbol.trim().toUpperCase() });
  const tf = String(chartTimeframe ?? "").trim();
  if (tf) q.set("timeframe", tf);
  return fetchJson<{
    symbol: string;
    timeframe?: string;
    boxes: BoxRangeOverlayBox[];
    scan?: BoxRangeOverlayScan;
  }>(`/api/box-range/overlay?${q}`);
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
    markets: { kr?: boolean; us?: boolean; crypto?: boolean };
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
    markets: { kr?: boolean; us?: boolean; crypto?: boolean };
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
  markets?: { kr?: boolean; us?: boolean; crypto?: boolean };
  minScoreRatio?: number;
  maxOpenPositions?: number;
  orderAmountKrw?: number | null;
  orderAmountUsd?: number | null;
  simInitialCapitalKrw?: number | null;
  simInitialCapitalUsd?: number | null;
  simAutoBuy?: boolean;
  autoSellAtTarget?: boolean;
  takeProfitPct?: number | null;
  stopLossPct?: number | null;
  sellHorizon?: "short" | "medium" | "long";
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
    markets: { kr?: boolean; us?: boolean; crypto?: boolean };
    minScoreRatio: number;
    maxOpenPositions: number;
    orderAmountKrw: number | null;
    orderAmountUsd: number | null;
    simInitialCapitalKrw: number | null;
    simInitialCapitalUsd: number | null;
    simAutoBuy: boolean;
    autoSellAtTarget: boolean;
    takeProfitPct: number | null;
    stopLossPct: number | null;
    sellHorizon?: "short" | "medium" | "long";
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
  return fetchJson<{
    ok: boolean;
    deletedId: string;
    purgedTrades?: number;
    programs: LiveTradeProgram[];
  }>(
    `/api/live-trading/programs/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export function armLiveTradeProgram(id: string, lane: LiveTradeArmLane) {
  return fetchJson<{
    ok: boolean;
    program: LiveTradeProgram;
    lane: LiveTradeArmLane;
    toss: TossTradingStatus;
    bithumb: BithumbTradingStatus;
  }>(`/api/live-trading/programs/${encodeURIComponent(id)}/arm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lane }),
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
  market: "kr" | "us" | "crypto";
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
  /** 실매매 — 빗썸 잔고 API 기준 행(클라 시세 덮어쓰기 제외) */
  exchangeSource?: "bithumb" | null;
  /** 텔레그램 첫 알림 시각·가격 대비 수익률(코인) */
  notifyBaselineAtMs?: number | null;
  notifyBaselinePrice?: number | null;
  sinceNotifyReturnPct?: number | null;
}

export interface LiveTradeRecord {
  id: string;
  programId: string;
  programName?: string;
  side: "buy" | "sell";
  symbol: string;
  name: string;
  market: "kr" | "us" | "crypto";
  quantity: number;
  price: number;
  amount: number;
  currency: string;
  feeAmount: number;
  simulated: boolean;
  orderId: string | null;
  note: string | null;
  /** 매도 체결 시점 평균 매입 단가 */
  entryPrice?: number | null;
  boxId?: string | null;
  boxTimeframe?: string | null;
  atMs: number;
  /** 빗썸 체결·텔레그램 첫 알림 이후 가져온 거래 */
  exchangeImport?: boolean;
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
  /** 실매매 — 빗썸 GET /v1/accounts 원화 합계 */
  bithumbKrwTotal?: number | null;
}

export interface LiveTradePortfolioResponse {
  updatedAtMs: number;
  programId: string | null;
  summary: LiveTradePortfolioSummary;
  holdings: LiveTradeHolding[];
  trades: LiveTradeRecord[];
}

export interface LiveTradeHistoryResponse {
  trades: LiveTradeRecord[];
  rangeStartDay: string;
  rangeEndDay: string;
  hasOlder: boolean;
  nextOlderEndDay: string | null;
  fetchedAtMs: number;
}

export function fetchLiveTradingTradeHistory(opts?: {
  endDay?: string | null;
  days?: number;
  /** true — 전체 일자·최신순(도크 거래내역) */
  all?: boolean;
  programId?: string | null;
  /** @deprecated scenario 우선 */
  exchange?: "bithumb" | "toss" | null;
  /** sim — 앱 시뮬만 · live-bithumb — 빗썸 실매매 · live-toss — 토스 실매매 */
  scenario?: "sim" | "live-bithumb" | "live-toss" | null;
}) {
  const params = new URLSearchParams();
  const endDay = String(opts?.endDay ?? "").trim();
  if (endDay) params.set("endDay", endDay);
  if (opts?.all) params.set("all", "1");
  else if (opts?.days != null) params.set("days", String(opts.days));
  const programId = String(opts?.programId ?? "").trim();
  if (programId) params.set("programId", programId);
  const scenario = String(opts?.scenario ?? "").trim();
  if (
    scenario === "sim" ||
    scenario === "live-bithumb" ||
    scenario === "live-toss"
  ) {
    params.set("scenario", scenario);
  } else {
    const exchange = String(opts?.exchange ?? "").trim();
    if (exchange === "bithumb" || exchange === "toss") {
      params.set("exchange", exchange);
    }
  }
  const q = params.toString() ? `?${params}` : "";
  return fetchJson<LiveTradeHistoryResponse>(
    `/api/live-trading/trades/history${q}`,
    { cache: "no-store" },
  );
}

export interface LiveTradeBoxRangePublicBox {
  boxId: string;
  symbol: string;
  timeframe: "1h" | "4h" | "1d";
  top: number;
  bottom: number;
  mid: number;
  state: "idle" | "armed" | "in_position" | "closed";
  entryPrice: number | null;
  takeProfitPrice: number;
  stopLossPrice: number;
  lotQty: number | null;
  buyAtMs: number | null;
}

export interface LiveTradeBoxRangeStatusResponse {
  programs: Record<
    string,
    {
      programId: string;
      programName: string;
      status: string;
      boxes: LiveTradeBoxRangePublicBox[];
    }
  >;
  fetchedAtMs: number;
}

export function fetchLiveTradingBoxRangeStatus() {
  return fetchJson<LiveTradeBoxRangeStatusResponse>(
    "/api/live-trading/box-range/status",
    { cache: "no-store" },
  );
}

export interface BoxRangeCatalogIndexRow {
  symbol: string;
  name: string;
  /** 미국 — names-ko 맵 */
  nameKo?: string;
  updatedAtMs: number;
  eligibleCount: number;
  boxCount: number;
}

export type BoxRangeCatalogMarket = "us" | "kr" | "crypto";

export interface BoxRangeCatalogIndex {
  market?: BoxRangeCatalogMarket;
  updatedAtMs: number;
  count: number;
  symbols: BoxRangeCatalogIndexRow[];
}

export interface BoxRangeCatalogBox {
  catalogBoxId: string;
  timeframe: "1h" | "4h" | "1d";
  top: number;
  bottom: number;
  mid: number;
  leftTime: number;
  rightTime: number;
  validBars: number;
  detectedAtMs: number;
  tradeEligible: boolean;
  consumedAtMs: number | null;
  consumedReason: string | null;
}

export interface BoxRangeSymbolCatalog {
  symbol: string;
  name: string;
  updatedAtMs: number;
  scanError: string | null;
  boxes: BoxRangeCatalogBox[];
}

function boxRangeCatalogQuery(opts: {
  market: BoxRangeCatalogMarket;
  strategy?: string | null;
}): string {
  const params = new URLSearchParams();
  if (opts.market !== "us") params.set("market", opts.market);
  const strategy = String(opts.strategy ?? "").trim();
  if (strategy) params.set("strategy", strategy);
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function fetchBoxRangeCatalog(
  market: BoxRangeCatalogMarket = "us",
  opts?: { strategy?: string | null },
) {
  const q = boxRangeCatalogQuery({ market, strategy: opts?.strategy });
  return fetchJson<BoxRangeCatalogIndex>(`/api/box-range/catalog${q}`, {
    cache: "no-store",
  });
}

export function fetchBoxRangeCatalogSymbol(
  symbol: string,
  market: BoxRangeCatalogMarket = "us",
  opts?: { strategy?: string | null },
) {
  const sym = symbol.trim().toUpperCase();
  const q = boxRangeCatalogQuery({ market, strategy: opts?.strategy });
  return fetchJson<BoxRangeSymbolCatalog>(
    `/api/box-range/catalog/${encodeURIComponent(sym)}${q}`,
    { cache: "no-store" },
  );
}

export function patchBoxRangeCatalogBox(
  symbol: string,
  catalogBoxId: string,
  body: { tradeEligible: boolean; consumedReason?: string; strategy?: string },
  market: BoxRangeCatalogMarket = "us",
) {
  const sym = symbol.trim().toUpperCase();
  const id = catalogBoxId.trim();
  const q = boxRangeCatalogQuery({ market, strategy: body.strategy });
  return fetchJson<{ ok: boolean; box: BoxRangeCatalogBox }>(
    `/api/box-range/catalog/${encodeURIComponent(sym)}/boxes/${encodeURIComponent(id)}${q}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function fetchAccessAdminLiveTradingTradeHistory(
  adminToken: string,
  userId: string,
  opts?: { endDay?: string | null; days?: number; all?: boolean },
) {
  const params = new URLSearchParams();
  params.set("userId", userId.trim());
  const endDay = String(opts?.endDay ?? "").trim();
  if (endDay) params.set("endDay", endDay);
  if (opts?.all) params.set("all", "1");
  else if (opts?.days != null) params.set("days", String(opts.days));
  const headers: Record<string, string> = {};
  const t = adminToken.trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<LiveTradeHistoryResponse>(
    `/api/access/admin/live-trading/trades/history?${params}`,
    {
      headers: Object.keys(headers).length ? headers : undefined,
      cache: "no-store",
    },
  );
}

export function fetchLiveTradingPortfolio(
  programId?: string | null,
  opts?: { exchangeSync?: boolean },
) {
  const params = new URLSearchParams();
  if (programId?.trim()) params.set("programId", programId.trim());
  if (opts?.exchangeSync) params.set("exchangeSync", "1");
  const q = params.toString() ? `?${params}` : "";
  return fetchJson<LiveTradePortfolioResponse>(`/api/live-trading/portfolio${q}`);
}

export function recordLiveTradeSell(body: {
  programId: string;
  symbol: string;
  market?: "kr" | "us" | "crypto";
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
  market: "kr" | "us" | "crypto";
  name?: string;
  /** 미입력 시 서버가 1분봉 시세로 체결 */
  price?: number;
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
  market?: "kr" | "us" | "crypto";
  quantity?: number;
  /** 미입력 시 서버가 1분봉 시세로 체결 */
  price?: number;
  note?: string;
  /** UI 필터와 동일한 포트폴리오 스냅샷(빈 값=전체 프로그램) */
  portfolioProgramId?: string | null;
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

export interface BithumbOpenOrder {
  orderId: string;
  market: string;
  symbol: string;
  name: string;
  side: "buy" | "sell" | string;
  ordType: string;
  state: string;
  price: number | null;
  volume: number | null;
  remainingVolume: number | null;
  executedVolume: number | null;
  createdAtMs: number;
  currentPrice: number | null;
  changePercent: number | null;
  currency: string;
}

export interface BithumbOpenOrdersResponse {
  ok: boolean;
  ready: boolean;
  configured?: boolean;
  liveOrdersEnabled: boolean;
  messageKo?: string;
  fetchError?: string;
  orders: BithumbOpenOrder[];
  updatedAtMs: number;
}

export function fetchBithumbOpenOrders() {
  return fetchJson<BithumbOpenOrdersResponse>("/api/live-trading/bithumb/open-orders");
}

export function cancelBithumbOpenOrder(orderId: string) {
  return fetchJson<BithumbOpenOrdersResponse & { ok: boolean }>(
    `/api/live-trading/bithumb/orders/${encodeURIComponent(orderId)}`,
    { method: "DELETE" },
  );
}

export interface TossOpenOrder {
  orderId: string;
  symbol: string;
  rawSymbol: string;
  name: string;
  market: "kr" | "us" | string;
  side: "buy" | "sell" | string;
  ordType: string;
  state: string;
  price: number | null;
  amount: number | null;
  volume: number | null;
  remainingVolume: number | null;
  executedVolume: number | null;
  createdAtMs: number;
  currency: string;
}

export interface TossOpenOrdersResponse {
  ok: boolean;
  ready: boolean;
  configured?: boolean;
  liveOrdersEnabled: boolean;
  serverLiveOrdersEnabled?: boolean;
  messageKo?: string;
  fetchError?: string;
  orders: TossOpenOrder[];
  updatedAtMs: number;
}

export interface TossPlaceOrderBody {
  symbol: string;
  market?: "kr" | "us" | string;
  side: "buy" | "sell";
  orderType?: "market" | "limit";
  amount?: number;
  quantity?: number;
  price?: number;
}

export interface TossPlaceOrderResponse {
  ok: boolean;
  simulated?: boolean;
  orderId?: string;
  fillPrice?: number;
  messageKo?: string;
  openOrders?: TossOpenOrdersResponse;
  error?: string;
}

export function fetchTossOpenOrders() {
  return fetchJson<TossOpenOrdersResponse>("/api/live-trading/toss/open-orders");
}

export function cancelTossOpenOrder(orderId: string) {
  return fetchJson<TossOpenOrdersResponse & { ok: boolean }>(
    `/api/live-trading/toss/orders/${encodeURIComponent(orderId)}`,
    { method: "DELETE" },
  );
}

export function placeTossOrder(body: TossPlaceOrderBody) {
  const timeoutMs = 1_000;
  return fetchJson<TossPlaceOrderResponse>("/api/live-trading/toss/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((err: unknown) => {
    if (
      err instanceof DOMException &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      throw new Error(ko.app.liveTradeTossOrderErrTimeout);
    }
    throw err;
  });
}

export interface TossHoldingPlan {
  symbol: string;
  targetBuyPrice: number | null;
  targetBuyAmountKrw: number | null;
  targetBuyAmountUsd: number | null;
  targetSellPrice: number | null;
  stopLossPrice: number | null;
  notes: string | null;
  updatedAtMs: number | null;
}

export interface TossHoldingAiReport {
  summary: string;
  bullets: string[];
  disclaimer: string;
}

export interface TossHoldingManageSummary extends TossTestHolding {
  industry?: string | null;
  per?: number | null;
  pbr?: number | null;
  roe?: number | null;
  plan?: TossHoldingPlan | null;
}

export interface TossHoldingsManageResponse {
  ok: boolean;
  ready: boolean;
  messageKo?: string;
  holdings: TossHoldingManageSummary[];
  plans: Record<string, TossHoldingPlan>;
  updatedAtMs: number;
}

export interface TossHoldingReportResponse {
  ok: boolean;
  symbol: string;
  market: "kr" | "us";
  industry: string | null;
  holding: TossTestHolding | null;
  plan: TossHoldingPlan | null;
  fundamentals: import("./types").StockFundamentalsResponse | null;
  financialPeriods: import("./types").FinancialPeriodRow[];
  financialAnalysis: import("./types").FinancialStatementAnalysisResponse | null;
  technical: import("./types").StockTechnicalResponse | null;
  aiReport: TossHoldingAiReport;
  updatedAtMs: number;
}

export function fetchTossHoldingsManage() {
  return fetchJson<TossHoldingsManageResponse>("/api/live-trading/toss/holdings/manage");
}

export function fetchTossHoldingReport(symbol: string, market: "kr" | "us" | string) {
  const q = new URLSearchParams({ market: String(market ?? "kr") });
  return fetchJson<TossHoldingReportResponse>(
    `/api/live-trading/toss/holdings/${encodeURIComponent(symbol)}/report?${q}`,
  );
}

export function saveTossHoldingPlan(
  symbol: string,
  body: Partial<TossHoldingPlan> & { market?: "kr" | "us" },
) {
  return fetchJson<{ ok: boolean; plan: TossHoldingPlan }>(
    `/api/live-trading/toss/holdings/${encodeURIComponent(symbol)}/plan`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export type TossRebalanceSchedule = {
  enabled: boolean;
  dayOfMonth: number;
  mode: "proportional_buy";
  markets: Array<"kr" | "us">;
  cashUsePct: number;
  lastRunYmd: string | null;
  lastRunAtMs: number | null;
  lastResult: {
    ok?: boolean;
    placedCount?: number;
    errorCount?: number;
    errors?: Array<{ symbol?: string; error?: string }>;
    placed?: Array<{ symbol?: string; amount?: number; orderId?: string }>;
  } | null;
  updatedAtMs: number | null;
};

export type TossRebalanceBuyPlan = {
  market: "kr" | "us";
  currency: "KRW" | "USD";
  cashAvailable: number;
  cashToSpend: number;
  holdingsCount?: number;
  orders: Array<{
    symbol: string;
    name: string;
    market: string;
    amount: number;
    weightPct: number;
  }>;
};

export type TossRebalanceScheduleResponse = {
  ok: boolean;
  schedule: TossRebalanceSchedule | null;
  preview?: {
    ok: boolean;
    ready: boolean;
    syncedAtMs?: number | null;
    plans: TossRebalanceBuyPlan[];
    regularOpen?: { kr: boolean; us: boolean };
    regularOpenMarkets?: Array<"kr" | "us">;
    regularClosedMarkets?: Array<"kr" | "us">;
  };
  error?: string;
};

export function fetchTossRebalanceSchedule() {
  return fetchJson<TossRebalanceScheduleResponse>(
    "/api/live-trading/toss/rebalance-schedule",
  );
}

export function saveTossRebalanceSchedule(
  body: Partial<TossRebalanceSchedule> & {
    enabled?: boolean;
    dayOfMonth?: number;
    markets?: Array<"kr" | "us">;
    cashUsePct?: number;
  },
) {
  return fetchJson<TossRebalanceScheduleResponse>(
    "/api/live-trading/toss/rebalance-schedule",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function runTossRebalanceSchedule(body?: {
  dryRun?: boolean;
  force?: boolean;
}) {
  return fetchJson<{
    ok: boolean;
    dryRun?: boolean;
    skipped?: boolean;
    reason?: string;
    error?: string;
    placed?: Array<{ symbol: string; amount: number; orderId?: string }>;
    errors?: Array<{ symbol: string; error?: string }>;
    plans?: TossRebalanceBuyPlan[];
  }>("/api/live-trading/toss/rebalance-schedule/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function runTossRebalanceNow(body?: {
  dryRun?: boolean;
  markets?: Array<"kr" | "us">;
  cashUsePct?: number;
}) {
  return fetchJson<{
    ok: boolean;
    dryRun?: boolean;
    immediate?: boolean;
    error?: string;
    reason?: string;
    placed?: Array<{ symbol: string; amount: number; orderId?: string }>;
    errors?: Array<{ symbol: string; error?: string }>;
    plans?: TossRebalanceBuyPlan[];
    skippedMarkets?: Array<"kr" | "us">;
    closedMarkets?: Array<"kr" | "us">;
    regularOpen?: { kr: boolean; us: boolean };
  }>("/api/live-trading/toss/rebalance-now", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function executeTossHoldingPlanOrder(
  symbol: string,
  body: {
    action: "buy" | "sell" | "stop";
    market?: "kr" | "us";
    price?: number;
    amount?: number;
    quantity?: number;
  },
) {
  return fetchJson<{ ok: boolean; action: string; orderId?: string; simulated?: boolean }>(
    `/api/live-trading/toss/holdings/${encodeURIComponent(symbol)}/execute`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    },
  );
}

export function fetchTossSellableQuantity(symbol: string, market: "kr" | "us" | string) {
  const q = new URLSearchParams({
    symbol: symbol.trim(),
    market: String(market ?? "kr"),
  });
  return fetchJson<{ ok: boolean; symbol: string; market: string; quantity: number }>(
    `/api/live-trading/toss/sellable-quantity?${q}`,
  );
}

export function fetchStockFundamentals(symbol: string, signal?: AbortSignal) {
  return fetchJson<StockFundamentalsResponse>(
    `/api/stock/${encodeURIComponent(symbol)}/fundamentals`,
    signal ? { signal } : undefined,
  );
}

export function fetchBuffettIntrinsicValue(symbol: string, signal?: AbortSignal) {
  return fetchJson<BuffettIntrinsicValueResponse>(
    `/api/stock/${encodeURIComponent(symbol)}/intrinsic-value`,
    signal ? { signal } : undefined,
  );
}

export function fetchValueInvestReturn(
  symbol: string,
  opts?: { price?: number; signal?: AbortSignal },
) {
  const signal = opts?.signal;
  const q =
    opts?.price != null && Number.isFinite(opts.price) && opts.price > 0
      ? `?price=${encodeURIComponent(String(opts.price))}`
      : "";
  return fetchJson<ValueInvestReturnResponse>(
    `/api/stock/${encodeURIComponent(symbol)}/value-invest-return${q}`,
    signal ? { signal } : undefined,
  );
}

export function fetchStockShareStructure(
  symbol: string,
  opts?: { market?: "kr" | "us"; signal?: AbortSignal },
) {
  const params = new URLSearchParams();
  if (opts?.market) params.set("market", opts.market);
  const q = params.toString() ? `?${params.toString()}` : "";
  return fetchJson<import("./types").StockShareStructureResponse>(
    `/api/stock/${encodeURIComponent(symbol)}/share-structure${q}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
}

export function fetchFinancialPeriods(symbol: string, signal?: AbortSignal) {
  return fetchJson<FinancialPeriodsResponse>(
    `/api/stock/${encodeURIComponent(symbol)}/financials/periods`,
    signal ? { signal } : undefined,
  );
}

export function fetchFinancialStatementDetail(
  symbol: string,
  periodId: string,
  signal?: AbortSignal,
) {
  return fetchJson<FinancialStatementDetailResponse>(
    `/api/stock/${encodeURIComponent(symbol)}/financials/periods/${encodeURIComponent(periodId)}`,
    signal ? { signal } : undefined,
  );
}

export function fetchFinancialStatementAnalysis(
  symbol: string,
  periodId: string,
  signal?: AbortSignal,
) {
  return fetchJson<FinancialStatementAnalysisResponse>(
    `/api/stock/${encodeURIComponent(symbol)}/financials/periods/${encodeURIComponent(periodId)}/analysis`,
    signal ? { signal } : undefined,
  );
}

export function fetchStockVault(opts?: { lite?: boolean; signal?: AbortSignal }) {
  const q = opts?.lite ? "?lite=1" : "";
  return fetchJson<import("./types").StockVaultResponse>(
    `/api/stock-vault${q}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
}

export function fetchStockVaultFavorites(signal?: AbortSignal) {
  return fetchJson<{
    authenticated?: boolean;
    favoriteSymbols?: string[];
    favoriteMeta?: Record<string, import("./types").StockVaultFavoriteMeta>;
  }>("/api/stock-vault/favorites", signal ? { signal } : undefined);
}

export function fetchStockVaultIndustryFinancials(
  symbols: string[],
  signal?: AbortSignal,
) {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!uniq.length) {
    return Promise.resolve({
      industryFinancials: {} as import("./types").StockVaultResponse["industryFinancials"],
      updatedAtMs: Date.now(),
    });
  }
  const params = new URLSearchParams({ symbols: uniq.join(",") });
  return fetchJson<{
    industryFinancials: NonNullable<
      import("./types").StockVaultResponse["industryFinancials"]
    >;
    updatedAtMs: number;
  }>(`/api/stock-vault/industry-financials?${params}`, signal ? { signal } : undefined);
}

export function fetchKrInvestorFlow(opts?: {
  refresh?: boolean;
  signal?: AbortSignal;
}) {
  const q = opts?.refresh ? "?refresh=1" : "";
  return fetchJson<import("./types").KrInvestorFlowResponse>(
    `/api/kr-investor-flow${q}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
}

export function fetchKrInvestorFlowHoldings(
  symbol: string,
  signal?: AbortSignal,
) {
  return fetchJson<import("./types").KrInvestorFlowHoldingsDetail>(
    `/api/kr-investor-flow/${encodeURIComponent(symbol)}/holdings`,
    signal ? { signal } : undefined,
  );
}

export function fetchStockVaultQuotes(
  symbols: string[],
  signal?: AbortSignal,
) {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!uniq.length) {
    return Promise.resolve({
      quotes: {} as PicksDailyHistoryQuotesMap,
      updatedAtMs: Date.now(),
    });
  }
  const params = new URLSearchParams({ symbols: uniq.join(",") });
  return fetchJson<{
    quotes: PicksDailyHistoryQuotesMap;
    updatedAtMs: number;
  }>(`/api/stock-vault/quotes?${params}`, signal ? { signal } : undefined);
}

export function fetchStockVaultChartInsights(opts?: {
  refresh?: boolean;
  symbols?: string[];
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (opts?.refresh) params.set("refresh", "1");
  if (opts?.symbols?.length) {
    params.set(
      "symbols",
      [...new Set(opts.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].join(","),
    );
  }
  const q = params.toString() ? `?${params}` : "";
  return fetchJson<{
    chartInsights: import("./types").StockVaultResponse["chartInsights"];
    updatedAtMs: number;
  }>(
    `/api/stock-vault/chart-insights${q}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
}

export function addStockVaultItem(body: {
  symbol: string;
  market: "kr" | "us";
  name?: string;
  favoritePrice?: number | null;
}) {
  return fetchJson<{ item: import("./types").StockVaultItem }>("/api/stock-vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function removeStockVaultItem(symbol: string) {
  return fetchJson<{ ok: boolean }>(
    `/api/stock-vault/${encodeURIComponent(symbol)}`,
    { method: "DELETE" },
  );
}

export function setStockVaultFavorite(
  symbol: string,
  favorited: boolean,
  opts?: {
    favoritePrice?: number | null;
    name?: string;
    market?: "kr" | "us";
  },
) {
  return fetchJson<{
    ok: boolean;
    favorited: boolean;
    meta: import("./types").StockVaultFavoriteMeta | null;
  }>(`/api/stock-vault/${encodeURIComponent(symbol)}/favorite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorited, ...opts }),
  });
}

export function patchStockVaultFavoriteMeta(
  symbol: string,
  body: { favoritePrice?: number | null },
) {
  return fetchJson<{
    ok: boolean;
    meta: import("./types").StockVaultFavoriteMeta;
  }>(`/api/stock-vault/${encodeURIComponent(symbol)}/favorite-meta`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchGoldenCrossStatus(signal?: AbortSignal) {
  return fetchJson<import("./types").StockVaultScanStatus>(
    "/api/golden-cross/status",
    signal ? { signal } : undefined,
  );
}

export function fetchStockVaultScanCoverage(
  days = 45,
  signal?: AbortSignal,
) {
  return fetchJson<import("./types").ScanCoverageResponse>(
    `/api/stock-vault/scan-coverage?days=${encodeURIComponent(String(days))}`,
    signal ? { signal } : undefined,
  );
}

export function triggerGoldenCrossScan() {
  return fetchJson<{ started: boolean; reason?: string; error?: string }>(
    "/api/golden-cross/scan",
    { method: "POST" },
  );
}

export function fetchGoldenCrossHistory(opts?: {
  scanDate?: string;
  detail?: boolean;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (opts?.scanDate) params.set("date", opts.scanDate);
  if (opts?.detail) params.set("detail", "1");
  const q = params.toString();
  return fetchJson<import("./types").GoldenCrossHistoryResponse>(
    `/api/golden-cross/history${q ? `?${q}` : ""}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
}

export function fetchMaAlignHistory(opts?: {
  scanDate?: string;
  detail?: boolean;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (opts?.scanDate) params.set("date", opts.scanDate);
  if (opts?.detail) params.set("detail", "1");
  const q = params.toString();
  return fetchJson<import("./types").MaAlignHistoryResponse>(
    `/api/ma-align/history${q ? `?${q}` : ""}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
}

export function fetchMa120NearHistory(opts?: {
  scanDate?: string;
  detail?: boolean;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (opts?.scanDate) params.set("date", opts.scanDate);
  if (opts?.detail) params.set("detail", "1");
  const q = params.toString();
  return fetchJson<import("./types").Ma120NearHistoryResponse>(
    `/api/ma120-near/history${q ? `?${q}` : ""}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
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
  market: Market | "crypto",
  signal?: AbortSignal,
  options?: { lite?: boolean },
) {
  const q = query.trim();
  const liteQ = options?.lite ? "&lite=1" : "";
  return fetchJson<StockSearchResponse>(
    `/api/stock-search?q=${encodeURIComponent(q)}&market=${market}${liteQ}`,
    signal ? { signal } : undefined,
  );
}

export function fetchStockSearchHot(market: Market, signal?: AbortSignal) {
  return fetchJson<StockSearchHotResponse>(
    `/api/stock-search/hot?market=${market}`,
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

/** 주요 지수(코스피·나스닥·환율 등) — 약 20초마다 갱신 */
export function fetchMarketIndices(signal?: AbortSignal) {
  return fetchJson<MarketIndicesResponse>(
    "/api/market-indices",
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

export interface AccessAdminLiveTradeProgram {
  id: string;
  name: string;
  status: "armed" | "sim";
  userId: string | null;
  modelId: string;
  markets: { kr: boolean; us: boolean; crypto: boolean };
  armedMarkets: { kr: boolean; crypto: boolean };
  minScoreRatio: number;
  maxOpenPositions: number;
  orderAmountKrw: number | null;
  orderAmountUsd: number | null;
  armedAtMs: number | null;
  lastRunAtMs: number | null;
  lastError: string | null;
  updatedAtMs: number;
}

export interface AccessAdminLiveTradingRunningResponse {
  programs: AccessAdminLiveTradeProgram[];
  armedCount: number;
  simCount: number;
  totalPrograms: number;
  fetchedAtMs: number;
}

export function fetchAccessAdminLiveTradingRunning(adminToken: string) {
  const headers: Record<string, string> = {};
  const t = adminToken.trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<AccessAdminLiveTradingRunningResponse>(
    "/api/access/admin/live-trading/running",
    {
      headers: Object.keys(headers).length ? headers : undefined,
      cache: "no-store",
    },
  );
}

export interface AccessAdminLiveTradingUserStatusResponse {
  programs: LiveTradeProgram[];
  programReturns: LiveTradingStatusResponse["programReturns"];
  armedCount: number;
  simCount: number;
  userId: string;
  fetchedAtMs: number;
}

export function fetchAccessAdminLiveTradingUserStatus(
  adminToken: string,
  userId: string,
) {
  const params = new URLSearchParams();
  params.set("userId", userId.trim());
  const headers: Record<string, string> = {};
  const t = adminToken.trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<AccessAdminLiveTradingUserStatusResponse>(
    `/api/access/admin/live-trading/user-status?${params}`,
    {
      headers: Object.keys(headers).length ? headers : undefined,
      cache: "no-store",
    },
  );
}

export function fetchAccessAdminLiveTradingPortfolio(
  adminToken: string,
  userId: string,
  programId?: string | null,
) {
  const params = new URLSearchParams();
  params.set("userId", userId.trim());
  const pid = String(programId ?? "").trim();
  if (pid) params.set("programId", pid);
  const headers: Record<string, string> = {};
  const t = adminToken.trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<LiveTradePortfolioResponse>(
    `/api/access/admin/live-trading/portfolio?${params}`,
    {
      headers: Object.keys(headers).length ? headers : undefined,
      cache: "no-store",
    },
  );
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

export type VirtualPersona = {
  id: string;
  name: string;
  enabled: boolean;
  skill: "beginner" | "intermediate" | "power";
  device: "desktop" | "mobile";
  goals: string[];
  focusAreas: string[];
  traits: string;
  satisfactionLevel?: number;
  lastEscalatedAtMs?: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type VirtualUserContinuous = {
  enabled: boolean;
  intervalMs: number;
  useBrowser: boolean;
  notifyTelegram: boolean;
  autoImplement?: boolean;
  autoImplementMinSeverity?: "blocker" | "major" | "minor" | "nit";
  pausedByApiExhaustion?: boolean;
  pausedAtMs?: number | null;
  pausedReason?: string | null;
  lastTickAtMs: number | null;
  lastSessionId: string | null;
  lastError: string | null;
  lastCreatedCount: number;
  lastManagerAtMs?: number | null;
  lastManagerDecision?: string | null;
  lastManagerScore?: number | null;
  managerReviewCount?: number;
};

export type CodeVersion = {
  id: string;
  label: string;
  kind: "baseline" | "pre-feedback" | "post-agent" | "manual" | "rollback";
  commitSha: string;
  commitShort: string;
  branch: string;
  feedbackId: string | null;
  jobId: string | null;
  createdAtMs: number;
  note: string;
};

export type VirtualFeedbackStatus =
  | "new"
  | "pending_review"
  | "approved"
  | "queued"
  | "done"
  | "dismissed";
export type VirtualFeedbackSeverity = "blocker" | "major" | "minor" | "nit";

export type VirtualFeedback = {
  id: string;
  personaId: string;
  personaName: string;
  sessionId: string;
  at: string;
  createdAtMs: number;
  status: VirtualFeedbackStatus;
  severity: VirtualFeedbackSeverity;
  area: string;
  title: string;
  detail: string;
  suggestion: string;
  discomfort?: string;
  improvementSummary?: string;
  implementResult?: string;
  prompt: string;
  /** 목록 API에서 전체 prompt 생략 시 */
  hasPrompt?: boolean;
  promptChars?: number;
  implementJobId: string | null;
  implementQueuedAtMs: number | null;
  implementDoneAtMs?: number | null;
  preVersionId?: string | null;
  postVersionId?: string | null;
  telegramSentAtMs: number | null;
  backupCount: number;
  lastBackupId: string | null;
  managerScore?: number | null;
  managerDecision?: string | null;
  managerNotes?: string;
  managerReviewedAtMs?: number | null;
};

function virtualUserHeaders(adminToken?: string): Record<string, string> {
  const t = (adminToken ?? getStoredAccessAdminToken()).trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

export function fetchVirtualUsers(
  adminToken?: string,
  signal?: AbortSignal,
) {
  return fetchJson<{
    ok: boolean;
    personas: VirtualPersona[];
    feedback: VirtualFeedback[];
    sessions: Array<{
      id: string;
      startedAtMs: number;
      finishedAtMs: number | null;
      personaIds: string[];
      feedbackIds: string[];
      ok: boolean;
    }>;
    continuous?: VirtualUserContinuous;
    busy?: boolean;
    codeVersions?: {
      baselineId: string | null;
      lockedBaselineSha?: string | null;
      versions: CodeVersion[];
    };
    narrative?: {
      discomfortCount: number;
      waitingCount?: number;
      runningCount?: number;
      queuedCount: number;
      improvedCount: number;
      total: number;
    };
    satisfactionLabels?: Record<string, string>;
  }>("/api/virtual-users", {
    headers: virtualUserHeaders(adminToken),
    signal,
  });
}

export function fetchVirtualFeedbackDetail(
  id: string,
  adminToken?: string,
  signal?: AbortSignal,
) {
  return fetchJson<{ ok: boolean; item: VirtualFeedback; error?: string }>(
    `/api/virtual-users/feedback/${encodeURIComponent(id)}`,
    {
      headers: virtualUserHeaders(adminToken),
      signal,
    },
  );
}

export function patchVirtualUserContinuous(
  patch: Partial<
    Pick<
      VirtualUserContinuous,
      | "enabled"
      | "intervalMs"
      | "useBrowser"
      | "notifyTelegram"
      | "autoImplement"
      | "autoImplementMinSeverity"
    >
  >,
  adminToken?: string,
) {
  return fetchJson<{
    ok: boolean;
    continuous?: VirtualUserContinuous;
    busy?: boolean;
    draining?: boolean;
  }>("/api/virtual-users/continuous", {
    method: "PATCH",
    headers: virtualUserHeaders(adminToken),
    body: JSON.stringify(patch),
  });
}

export function fetchCodeVersions(adminToken?: string) {
  return fetchJson<{
    ok: boolean;
    baselineId: string | null;
    versions: CodeVersion[];
    headShort?: string;
    branch?: string;
    dirty?: boolean;
  }>("/api/code-versions", {
    headers: virtualUserHeaders(adminToken),
  });
}

export function rollbackCodeVersion(id: string, adminToken?: string) {
  return fetchJson<{
    ok: boolean;
    error?: string;
    target?: CodeVersion;
    resultVersion?: CodeVersion | null;
    head?: string;
    versions?: CodeVersion[];
    warning?: string | null;
  }>(`/api/code-versions/${encodeURIComponent(id)}/rollback`, {
    method: "POST",
    headers: virtualUserHeaders(adminToken),
    body: "{}",
  });
}

export function runVirtualUsers(
  body?: {
    personaId?: string;
    maxPerPersona?: number;
    notifyTelegram?: boolean;
    useBrowser?: boolean;
  },
  adminToken?: string,
) {
  return fetchJson<{
    ok: boolean;
    sessionId?: string;
    createdCount?: number;
    feedback?: VirtualFeedback[];
    warnings?: string[];
    mode?: string;
    error?: string;
    escalations?: Array<{ personaId: string; from: number; to: number }>;
  }>("/api/virtual-users/run", {
    method: "POST",
    headers: virtualUserHeaders(adminToken),
    body: JSON.stringify(body ?? {}),
  });
}

export function patchVirtualPersona(
  id: string,
  patch: Partial<Pick<VirtualPersona, "enabled" | "name" | "traits">>,
  adminToken?: string,
) {
  return fetchJson<{ ok: boolean; persona?: VirtualPersona; personas?: VirtualPersona[] }>(
    `/api/virtual-users/personas/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: virtualUserHeaders(adminToken),
      body: JSON.stringify(patch),
    },
  );
}

export function implementVirtualFeedback(id: string, adminToken?: string) {
  return fetchJson<{
    ok: boolean;
    jobId?: string;
    item?: VirtualFeedback;
    backup?: { backupId?: string; dir?: string } | null;
    message?: string;
    error?: string;
  }>(`/api/virtual-users/feedback/${encodeURIComponent(id)}/implement`, {
    method: "POST",
    headers: virtualUserHeaders(adminToken),
    body: "{}",
  });
}

export function backupVirtualFeedback(id: string, adminToken?: string) {
  return fetchJson<{
    ok: boolean;
    backupId?: string;
    dir?: string;
    item?: VirtualFeedback;
    error?: string;
  }>(`/api/virtual-users/feedback/${encodeURIComponent(id)}/backup`, {
    method: "POST",
    headers: virtualUserHeaders(adminToken),
    body: "{}",
  });
}

export function setVirtualFeedbackStatus(
  id: string,
  status: VirtualFeedbackStatus,
  adminToken?: string,
) {
  return fetchJson<{ ok: boolean; item?: VirtualFeedback }>(
    `/api/virtual-users/feedback/${encodeURIComponent(id)}/status`,
    {
      method: "POST",
      headers: virtualUserHeaders(adminToken),
      body: JSON.stringify({ status }),
    },
  );
}

export function reviewVirtualFeedbackManager(
  id: string,
  adminToken?: string,
  force = false,
) {
  return fetchJson<{
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    review?: {
      score: number;
      decision: string;
      notes: string[];
    };
    item?: VirtualFeedback;
    error?: string;
  }>(`/api/virtual-users/feedback/${encodeURIComponent(id)}/manager-review`, {
    method: "POST",
    headers: virtualUserHeaders(adminToken),
    body: JSON.stringify({ force }),
  });
}

export function reviewVirtualFeedbackManagerBatch(
  adminToken?: string,
  limit = 8,
) {
  return fetchJson<{
    ok: boolean;
    reviewed: number;
    results?: Array<{ id: string; decision: string; score: number }>;
    continuous?: VirtualUserContinuous;
  }>("/api/virtual-users/manager/review-batch", {
    method: "POST",
    headers: virtualUserHeaders(adminToken),
    body: JSON.stringify({ limit }),
  });
}

export function deleteVirtualFeedback(id: string, adminToken?: string) {
  return fetchJson<{ ok: boolean }>(
    `/api/virtual-users/feedback/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: virtualUserHeaders(adminToken),
    },
  );
}

export interface PollerStatusRow {
  id: string;
  labelKo: string;
  groupKo: string;
  summaryKo: string;
  descriptionKo: string;
  intervalMs: number;
  envDisable: string;
  bootEnabled: boolean;
  bootStarted: boolean;
  runtimeEnabled: boolean;
  effectiveEnabled: boolean;
  runtimeToggleable: boolean;
  running: boolean;
  lastTickAtMs: number | null;
  lastError: string | null;
  tickCount: number;
}

export function fetchPollerStatus() {
  return fetchJson<{ ok: boolean; pollers: PollerStatusRow[] }>(
    "/api/pollers/status",
  );
}

export function togglePollerRuntime(id: string, enabled: boolean, password: string) {
  return fetchJson<{ ok: boolean; pollers: PollerStatusRow[]; error?: string }>(
    `/api/admin/pollers/${encodeURIComponent(id)}/toggle`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, password }),
    },
  );
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

export type UiFeaturesPublicSnapshot = {
  features: Record<string, boolean>;
  updatedAtMs: number;
};

export type UiFeatureAdminItem = {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
  hasOverride: boolean;
  updatedAtMs: number | null;
};

export type UiFeaturesAdminSnapshot = {
  items: UiFeatureAdminItem[];
  updatedAtMs: number;
};

export function fetchUiFeatures() {
  return fetchJson<UiFeaturesPublicSnapshot>("/api/ui-features");
}

export function fetchAccessAdminUiFeatures(adminToken: string) {
  const headers: Record<string, string> = {};
  const t = adminToken.trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return fetchJson<UiFeaturesAdminSnapshot>("/api/access/admin/ui-features", {
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

export function postAccessAdminUiFeatureSet(
  adminToken: string,
  id: string,
  enabled: boolean,
) {
  return fetchJson<UiFeaturesAdminSnapshot & { ok: boolean }>(
    "/api/access/admin/ui-features/set",
    {
      method: "POST",
      headers: accessAdminPostHeaders(adminToken),
      body: JSON.stringify({ id, enabled }),
    },
  );
}

