import { existsSync, readFileSync } from "fs";
import path from "path";
import { appendAccessLog, clientIp } from "./access-log.js";
import {
  isAccessControlEnabled,
  isClientIpOnAllowlist,
} from "./access-control.js";

let cachedGateHtml = null;
let cachedFromPath = null;

/**
 * @param {import("vite").ViteDevServer | import("vite").PreviewServer} server
 */
function resolveGateHtmlPath(server) {
  const root = server.config.root;
  const outDir = server.config.build?.outDir ?? "dist";
  const pub = path.join(root, "public", "access-gate.html");
  const dist = path.join(root, outDir, "access-gate.html");
  if (existsSync(pub)) return pub;
  if (existsSync(dist)) return dist;
  return null;
}

function getGateHtml(server) {
  const filePath = resolveGateHtmlPath(server);
  if (!filePath) {
    return "<!DOCTYPE html><html lang=\"ko\"><meta charset=\"utf-8\"><title>오류</title><body><p>access-gate.html 파일이 없습니다.</p></body></html>";
  }
  if (cachedGateHtml && cachedFromPath === filePath) return cachedGateHtml;
  cachedGateHtml = readFileSync(filePath, "utf8");
  cachedFromPath = filePath;
  return cachedGateHtml;
}

function requestPathname(req) {
  const raw = String(req.originalUrl ?? req.url ?? "/");
  const pathPart = raw.split("?")[0].split("#")[0] || "/";
  if (pathPart.startsWith("/")) return pathPart;
  return `/${pathPart}`.replace(/\/{2,}/g, "/");
}

/** Vite·정적 자산 — 게이트 대상이 아님 */
function isPassThroughPath(p) {
  if (p.startsWith("/api")) return true;
  if (p === "/access-gate.html") return true;
  if (p.startsWith("/@")) return true;
  if (p.startsWith("/node_modules/")) return true;
  if (p.startsWith("/src/")) return true;
  if (p.startsWith("/.well-known/")) return true;
  const last = p.split("/").pop() ?? "";
  if (/\.[a-z0-9]+$/i.test(last)) {
    if (/\.html?$/i.test(last)) return false;
    return true;
  }
  return false;
}

/** 브라우저 문서 내비게이션(SPA 직링크 등) — index.html로 떨어지기 전에 막아야 함 */
function wantsHtmlDocument(req) {
  const accept = String(req.headers?.accept ?? "");
  return /\btext\/html\b/i.test(accept);
}

/**
 * 허가되지 않은 IP는 React SPA 대신 정적 등록·접근 확인 페이지만 응답.
 * Connect 스택 **맨 앞**에 넣어 Vite `index.html` 미들웨어보다 먼저 실행한다.
 * @param {import("vite").ViteDevServer | import("vite").PreviewServer} server
 */
export function installAccessGateHtmlMiddleware(server) {
  const stack = server.middlewares?.stack;
  if (!Array.isArray(stack)) return;

  const accessGateHtmlMiddleware = (req, res, next) => {
    if (req.method !== "GET") return next();

    const pathname = requestPathname(req);
    if (isPassThroughPath(pathname)) return next();

    if (!isAccessControlEnabled()) return next();

    const ip = clientIp(req);
    if (isClientIpOnAllowlist(ip)) return next();

    const isRoot =
      pathname === "/" || pathname === "/index.html" || pathname === "";
    const blockSpaShell = isRoot || wantsHtmlDocument(req);
    if (!blockSpaShell) return next();

    const html = getGateHtml(server);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    /** Vite 필터(`shouldLogViteUrl`) 없이 기록 — 게이트가 `res.end`로 끊어 뒤쪽 미들웨어가 안 타던 경우 대비 */
    appendAccessLog(req);
    res.end(html);
  };

  stack.unshift({
    route: "",
    handle: accessGateHtmlMiddleware,
  });
}
