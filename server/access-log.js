import fs from "fs";
import { dailyServerLogPath, ensureServerLogDirSync } from "./log-paths.js";

/** 서버 로컬 날짜 기준 — 자정이 지나면 다음 파일로 자연 전환 */
function accessLogPathForToday() {
  return dailyServerLogPath("access");
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

/** 폴링·반복 조회로 로그가 과다한 GET 경로는 기록 생략 */
function shouldSkipAccessLog(req) {
  const method = String(req.method ?? "GET").toUpperCase();
  if (method !== "GET") return false;
  const path = pathnameOnly(req);
  if (path === "/api/picks") return true;
  if (path === "/api/picks/daily-history") return true;
  if (path === "/api/crypto-quotes") return true;
  if (path === "/api/crypto-universe") return true;
  if (path === "/api/macro-events") return true;
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

  if (path === "/" || path === "/index.html") return "메인 페이지";
  if (path === "/access-gate.html" || path.endsWith("/access-gate.html")) return "접근 게이트 페이지";

  return `${method} ${path}`;
}

function lineFromReq(req) {
  const ts = new Date().toISOString();
  const ip = clientIp(req);
  const method = String(req.method ?? "GET").toUpperCase();
  const action = humanAction(req);
  return {
    file: `${ts}\tip=${ip}\t${method}\t${action}\n`,
    console: `${ts} ip=${ip} ${method} ${action}`,
  };
}

export function shouldLogViteUrl(url) {
  if (!url) return true;
  const p = url.split("?")[0] ?? url;
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
export function appendAccessLog(req) {
  if (shouldSkipAccessLog(req)) return;
  try {
    ensureServerLogDirSync();
    const { file, console: consoleLine } = lineFromReq(req);
    console.log("[access]", consoleLine);
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
 */
export function appendServerEventLog(
  category,
  message,
  level = "info",
  eventClientIp = null,
) {
  try {
    ensureServerLogDirSync();
    const ts = new Date().toISOString();
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
    const logFn =
      level === "error"
        ? console.error.bind(console)
        : level === "warn"
          ? console.warn.bind(console)
          : console.log.bind(console);
    logFn("[access]", consoleLine);
    fs.appendFile(accessLogPathForToday(), file, (err) => {
      if (err) console.warn("[access-log] 파일 기록 실패:", err.message);
    });
  } catch (e) {
    console.warn("[access-log]", e instanceof Error ? e.message : e);
  }
}

/** Vite 전용: 페이지·API·주요 요청만 (HMR·소스맵 제외) */
export function appendAccessLogVite(req) {
  if (!shouldLogViteUrl(req.url)) return;
  appendAccessLog(req);
}

/** Express 미들웨어 */
export function expressAccessLogger(req, _res, next) {
  appendAccessLog(req);
  next();
}

/**
 * Vite Connect 스택 **최상단**에 삽입.
 * 외부에서 `/` 등으로 들어와도 게이트가 `res.end`로 끊기기 전에 `[access]`가 남는다.
 * `/api`는 Express `expressAccessLogger`가 기록하므로 여기서는 생략한다.
 * @param {import("vite").ViteDevServer | import("vite").PreviewServer} server
 */
export function installViteAccessTraceMiddleware(server) {
  const stack = server.middlewares?.stack;
  if (!Array.isArray(stack)) return;
  stack.unshift({
    route: "",
    handle(req, _res, next) {
      if (String(req.url ?? "").startsWith("/api")) return next();
      appendAccessLogVite(req);
      next();
    },
  });
}
