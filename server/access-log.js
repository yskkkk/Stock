import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, ".data");
const LOG_FILE = path.join(LOG_DIR, "access.log");

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function clientIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0]?.trim() || "-";
  const raw = req.socket?.remoteAddress ?? "";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw || "-";
}

function lineFromReq(req) {
  const ts = new Date().toISOString();
  const ip = clientIp(req);
  const method = req.method ?? "-";
  const url = req.url ?? "-";
  const ua = String(req.headers?.["user-agent"] ?? "-")
    .replace(/\s+/g, " ")
    .slice(0, 240);
  return `${ts}\t${ip}\t${method}\t${url}\t${ua}\n`;
}

function shouldLogViteUrl(url) {
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
  return true;
}

/** Vite `IncomingMessage` / Express `req` 공통 */
export function appendAccessLog(req) {
  try {
    ensureDir();
    const line = lineFromReq(req);
    console.log("[access]", line.trimEnd());
    fs.appendFile(LOG_FILE, line, (err) => {
      if (err) console.warn("[access-log]", err.message);
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
