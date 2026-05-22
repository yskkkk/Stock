import fs from "fs";
import { recordServerEventForImprovement } from "./server-self-improvement-log.js";
import { formatLogTimestampKst } from "./log-kst.js";
import {
  dailyServerLogPath,
  ensureServerLogDirSync,
  migrateLegacyServerLogsSync,
} from "./log-paths.js";

let legacyLogsMigrated = false;
function ensureAccessLogReady() {
  ensureServerLogDirSync();
  if (!legacyLogsMigrated) {
    legacyLogsMigrated = true;
    migrateLegacyServerLogsSync();
  }
}

/** KST 일자 기준 — 자정이 지나면 다음 파일로 자연 전환 */
function accessLogPathForToday() {
  return dailyServerLogPath("access");
}

/** @type {unique symbol} */
const ACCESS_EVENT_AT_MS = Symbol("stockAccessEventAtMs");

/**
 * 로그에 찍을 “행위 발생” 시각(ms). 핸들러·게이트에서 호출.
 * @param {import("http").IncomingMessage} req
 * @param {number} [atMs]
 */
export function stampAccessEventNow(req, atMs) {
  if (!req || typeof req !== "object") return;
  const ms =
    typeof atMs === "number" && Number.isFinite(atMs) ? atMs : Date.now();
  /** @type {Record<symbol, number>} */ (req)[ACCESS_EVENT_AT_MS] = ms;
}

/** @param {import("http").IncomingMessage} req @returns {string} KST 로그 시각 */
function accessEventAtLogTs(req) {
  const ms = /** @type {Record<symbol, number>} */ (req)?.[ACCESS_EVENT_AT_MS];
  return typeof ms === "number" && Number.isFinite(ms)
    ? formatLogTimestampKst(ms)
    : formatLogTimestampKst();
}

export function clientIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0]?.trim() || "-";
  const raw = req.socket?.remoteAddress ?? "";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw || "-";
}

/** Express는 `req.path`, Vite Connect는 주로 `url`만 있음 */
function pathnameOnly(req) {
  const p = req.path;
  if (typeof p === "string" && p.startsWith("/")) return p;
  const raw = String(req.originalUrl ?? req.url ?? "/");
  return raw.split("?")[0].split("#")[0] || "/";
}

/** 브라우저·OS가 자동으로 치는 아이콘·매니페스트 — 의미 있는 접근 로그 아님 */
function isNoiseStaticAssetPath(pathname) {
  const p = String(pathname ?? "").toLowerCase();
  if (p === "/favicon.ico" || p === "/robots.txt") return true;
  if (p.includes("apple-touch-icon")) return true;
  if (p.endsWith(".webmanifest") || p === "/manifest.json") return true;
  return false;
}

/** 폴링·반복 조회로 로그가 과다한 경로는 기록 생략 */
function shouldSkipAccessLog(req) {
  const method = String(req.method ?? "GET").toUpperCase();
  const path = pathnameOnly(req);
  if (isNoiseStaticAssetPath(path)) return true;
  if (method === "POST") {
    if (path === "/api/ops/cursor-agent-stream") return true;
    if (path === "/api/ops/cursor-agent") return true;
    return false;
  }
  if (method !== "GET") return false;
  if (path === "/api/picks") return true;
  if (path === "/api/picks/daily-history") return true;
  if (path === "/api/picks/daily-history/quotes") return true;
  if (path === "/api/picks/recommendations-tracker") return true;
  if (path === "/api/crypto-quotes") return true;
  if (path === "/api/crypto-universe") return true;
  if (path === "/api/macro-events") return true;
  if (path === "/api/sector-earnings") return true;
  if (path === "/api/config") return true;
  if (path === "/api/access/status") return true;
  /** 운영 탭 이력·대기열 폴링 — 로그만 과다 */
  if (path === "/api/ops/cursor-agent-history") return true;
  if (path === "/api/ops/cursor-agent-queue") return true;
  if (path === "/api/ops/dev-queue-display") return true;
  if (path === "/api/ops/record-mode") return true;
  if (path === "/api/ops/record-mode/activity") return true;
  if (path === "/api/ops/file-dev-queue") return true;
  if (path === "/api/ops/cursor-agent-pending") return true;
  if (path.startsWith("/api/stock/")) return true;
  if (path.startsWith("/api/news/")) return true;
  /** 실거래·시뮬 탭 폴링 */
  if (path === "/api/live-trading/portfolio") return true;
  if (path === "/api/live-trading/quotes") return true;
  if (path === "/api/live-trading/status") return true;
  if (path === "/api/picks/tech-models") return true;
  if (path.startsWith("/api/live-trading/programs")) return true;
  if (path === "/api/live-trading/sim-recommendations") return true;
  /** FX·텔레그램·기타 주기 폴링 */
  if (path === "/api/fx/usd-krw") return true;
  if (path === "/api/market-indices") return true;
  if (path === "/api/telegram/sent") return true;
  return false;
}

/**
 * 사람이 읽기 쉬운 요약 (IP·메서드와 함께 콘솔/파일에 남김)
 * @param {import("http").IncomingMessage} req
 */
function humanAction(req) {
  const method = String(req.method ?? "GET").toUpperCase();
  const path = pathnameOnly(req);

  if (method === "POST" && path === "/api/picks/refresh") return "스크리너 전체 재분석";
  if (method === "GET" && path === "/api/macro-events") return "경제 지표 일정 조회";
  if (method === "GET" && path === "/api/sector-earnings") return "섹터 실적 스포트라이트 조회";
  if (method === "GET" && path === "/api/config") return "앱 설정 조회";
  if (method === "GET" && path === "/api/telegram/sent") return "텔레그램 오늘 발송 목록";
  if (method === "POST" && path === "/api/telegram/reset-sent") return "텔레그램 발송 이력 초기화";
  if (method === "GET" && path.startsWith("/api/news/")) {
    const sym = path.slice("/api/news/".length) || "?";
    return `뉴스 조회 (${sym})`;
  }
  if (method === "GET" && path === "/api/crypto-universe") return "코인 유니버스 조회";
  if (method === "GET" && path === "/api/crypto-quotes") return "코인 시세 조회";
  if (method === "POST" && path === "/api/feedback") return "불편 접수 제출";
  if (method === "GET" && path === "/api/feedback/inbox") return "불편 접수함 열람";
  if (method === "GET" && path.startsWith("/api/stock/")) {
    const sym = path.slice("/api/stock/".length) || "?";
    return `종목 시세·차트 (${sym})`;
  }

  if (method === "GET" && path === "/api/access/status") return "IP 접근 상태 조회";
  if (method === "POST" && path === "/api/access/request") return "IP 접근 신청";
  if (method === "GET" && path === "/api/access/admin/requests") return "접근 관리 목록 조회";
  if (method === "POST" && path === "/api/access/admin/approve") return "접근 신청 승인";
  if (method === "POST" && path === "/api/access/admin/reject") return "접근 신청 거절";
  if (method === "POST" && path === "/api/access/admin/revoke") return "허용 IP 취소";
  if (method === "POST" && path === "/api/access/admin/allowed-memo") return "허용 IP 메모 저장";

  if (method === "GET" && path === "/api/ops/dev-queue-display")
    return "개발 대기열 표시 스냅샷 조회";
  if (method === "GET" && path === "/api/ops/record-mode") return "운영 기록 모드 큐 조회";
  if (method === "GET" && path === "/api/ops/record-mode/activity")
    return "운영 기록 모드 활동 이력 조회";
  if (method === "PUT" && path === "/api/ops/record-mode") return "운영 기록 모드 큐 저장";
  if (method === "GET" && path === "/api/ops/file-dev-queue") return "운영 파일 반영 큐 조회";
  if (method === "PUT" && path === "/api/ops/file-dev-queue") return "운영 파일 반영 큐 저장";
  if (
    method === "POST" &&
    path.startsWith("/api/ops/cursor-agent-history/") &&
    path.endsWith("/workspace-applied")
  ) {
    return "에이전트 실행 이력 작업 반영 표시";
  }
  if (method === "POST" && path === "/api/ops/dev-queue/ide/release")
    return "IDE 개발 큐 해제";
  if (method === "POST" && path === "/api/ops/dev-queue/ide/release-active")
    return "IDE 개발 큐 실행 중 해제";
  if (method === "POST" && path === "/api/ops/dev-queue/ide/enqueue")
    return "IDE 개발 큐 등록";
  if (method === "POST" && path === "/api/ops/dev-queue/ide/acquire")
    return "IDE 개발 큐 슬롯 획득";

  if (method === "GET" && path === "/api/live-trading/portfolio")
    return "실거래 포트폴리오 조회";
  if (method === "GET" && path === "/api/live-trading/status")
    return "실거래 프로그램 상태 조회";
  if (method === "GET" && path === "/api/picks/tech-models")
    return "기술 모델 목록 조회";
  if (method === "GET" && path.startsWith("/api/live-trading/programs"))
    return "실거래 프로그램 조회";

  if (path === "/" || path === "/index.html") return "메인 페이지";
  if (path === "/access-gate.html" || path.endsWith("/access-gate.html")) return "접근 게이트 페이지";

  if (method === "GET") return `조회 ${path}`;
  if (method === "POST") return `요청 ${path}`;
  if (method === "PUT" || method === "PATCH") return `변경 ${path}`;
  if (method === "DELETE") return `삭제 ${path}`;
  return `${method} ${path}`;
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {string} [atTs] 기록 시각 KST 문자열(미지정 시 호출 시점)
 */
function lineFromReq(req, atTs) {
  const ts = atTs ?? formatLogTimestampKst();
  const ip = clientIp(req);
  const method = String(req.method ?? "GET").toUpperCase();
  const action = humanAction(req);
  return {
    file: `${ts}\tip=${ip}\t${method}\t${action}\n`,
    console: `${ts} ip=${ip} ${action}`,
  };
}

export function shouldLogViteUrl(url) {
  if (!url) return true;
  const p = url.split("?")[0] ?? url;
  if (isNoiseStaticAssetPath(p)) return false;
  if (
    p.startsWith("/@") ||
    p.startsWith("/node_modules/") ||
    p.startsWith("/src/") ||
    p.endsWith(".tsx") ||
    p.endsWith(".ts") ||
    p.endsWith(".css") ||
    p.endsWith(".js.map")
  ) {
    return false;
  }
  /** preview 빌드 청크 — 문서 한 번에 수십 줄 나오는 것 방지 */
  if (p.includes("/assets/") && /\.js($|\?)/i.test(p)) return false;
  return true;
}

/** Vite `IncomingMessage` / Express `req` 공통 */
export function appendAccessLog(req, atTs) {
  if (shouldSkipAccessLog(req)) return;
  try {
    ensureAccessLogReady();
    const ts = atTs ?? accessEventAtLogTs(req);
    const { file, console: consoleLine } = lineFromReq(req, ts);
    const method = String(req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      console.log("[access]", consoleLine);
    }
    fs.appendFile(accessLogPathForToday(), file, (err) => {
      if (err) console.warn("[access-log] 파일 기록 실패:", err.message);
    });
  } catch (e) {
    console.warn("[access-log]", e instanceof Error ? e.message : e);
  }
}

/**
 * HTTP 요청이 아닌 서버 내부 이벤트 — `appendAccessLog`와 같은 일일 파일·콘솔 `[access]` 패턴
 * @param {string} category 짧은 태그 (예: auto-git)
 * @param {string} message 한 줄
 * @param {"info"|"warn"|"error"} [level]
 * @param {string | null | undefined} [eventClientIp] 에이전트 등 요청자 IP (없으면 `-`)
 * @param {number} [eventAtMs] 행위 발생 시각(ms). 없으면 호출 시점
 */
export function appendServerEventLog(
  category,
  message,
  level = "info",
  eventClientIp = null,
  eventAtMs = null,
) {
  try {
    ensureAccessLogReady();
    const ts =
      typeof eventAtMs === "number" && Number.isFinite(eventAtMs)
        ? formatLogTimestampKst(eventAtMs)
        : formatLogTimestampKst();
    const safeCat = String(category ?? "server")
      .replace(/[\t\r\n]/g, "_")
      .slice(0, 32);
    const safeMsg = String(message).replace(/\r|\n/g, " ").slice(0, 800);
    const rawIp = String(eventClientIp ?? "").trim();
    const ipField =
      rawIp && rawIp !== "-"
        ? rawIp.replace(/[\t\r\n]/g, "_").slice(0, 120)
        : "-";
    const file = `${ts}\tip=${ipField}\tINTERNAL\t${safeCat}\t${safeMsg}\n`;
    const consoleLine = `${ts} ip=${ipField} INTERNAL ${safeCat} ${safeMsg}`;
    if (level === "error") console.error("[access]", consoleLine);
    else if (level === "warn") console.warn("[access]", consoleLine);
    fs.appendFile(accessLogPathForToday(), file, (err) => {
      if (err) console.warn("[access-log] 파일 기록 실패:", err.message);
    });
    if (level === "warn" || level === "error") {
      recordServerEventForImprovement(safeCat, safeMsg, level);
    }
  } catch (e) {
    console.warn("[access-log]", e instanceof Error ? e.message : e);
  }
}

/** Vite 전용: 페이지·API·주요 요청만 (HMR·소스맵 제외) */
export function appendAccessLogVite(req) {
  if (!shouldLogViteUrl(req.url)) return;
  appendAccessLog(req);
}

/** Express 미들웨어 — GET은 요청 시각, POST는 핸들러 `stampAccessEventNow` 또는 응답 직전 시각 */
export function expressAccessLogger(req, res, next) {
  const skip = shouldSkipAccessLog(req);
  if (!skip) {
    const method = String(req.method ?? "GET").toUpperCase();
    if (method === "GET") stampAccessEventNow(req);
  }
  res.once("finish", () => {
    if (skip) return;
    if (
      /** @type {Record<symbol, number>} */ (req)[ACCESS_EVENT_AT_MS] == null
    ) {
      stampAccessEventNow(req);
    }
    appendAccessLog(req, accessEventAtLogTs(req));
  });
  next();
}

/**
 * Vite Connect 스택 **최상단**에 삽입.
 * 외부에서 `/` 등으로 들어와도 게이트·문서 요청 시각이 행위 시각으로 남는다.
 * `/api`는 Express `expressAccessLogger`가 기록하므로 여기서는 생략한다.
 * @param {import("vite").ViteDevServer | import("vite").PreviewServer} server
 */
export function installViteAccessTraceMiddleware(server) {
  const stack = server.middlewares?.stack;
  if (!Array.isArray(stack)) return;
  stack.unshift({
    route: "",
    handle(req, res, next) {
      if (String(req.url ?? "").startsWith("/api")) return next();
      if (!shouldLogViteUrl(req.url)) return next();
      if (shouldSkipAccessLog(req)) return next();
      stampAccessEventNow(req);
      res.once("finish", () => {
        appendAccessLog(req, accessEventAtLogTs(req));
      });
      next();
    },
  });
}
