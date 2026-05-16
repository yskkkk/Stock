import { existsSync, readFileSync } from "fs";
import path from "path";
import { clientIp } from "./access-log.js";
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

/**
 * 허가되지 않은 IP는 `/`·`/index.html` 요청에 React 대신 정적 방어 페이지만 응답.
 * @param {import("vite").ViteDevServer | import("vite").PreviewServer} server
 */
export function installAccessGateHtmlMiddleware(server) {
  server.middlewares.use((req, res, next) => {
    if (req.method !== "GET") return next();
    const raw = String(req.originalUrl ?? req.url ?? "/").split("?")[0] || "/";
    if (raw !== "/" && raw !== "/index.html") return next();

    if (!isAccessControlEnabled()) return next();

    const ip = clientIp(req);
    if (isClientIpOnAllowlist(ip)) return next();

    const html = getGateHtml(server);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(html);
  });
}
