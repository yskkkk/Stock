import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { resolveServerOpenClientTelegramCreds } from "./server-open-request-notify.js";

let cachedHtml = null;
let cachedFromPath = null;
let cachedInject = null;

function resolveOfflineHtmlPath(root) {
  const pub = path.join(root, "public", "server-offline.html");
  if (existsSync(pub)) return pub;
  return null;
}

function buildInjectScript() {
  const creds = resolveServerOpenClientTelegramCreds();
  if (!creds) return "<!-- server-open: client telegram disabled -->";
  const payload = JSON.stringify({
    token: creds.token,
    chatId: creds.chatId,
  });
  return `<script>window.__STOCK_SERVER_OPEN__=${payload};</script>`;
}

/**
 * @param {string} filePath
 */
function loadOfflineHtml(filePath) {
  const inject = buildInjectScript();
  if (cachedHtml && cachedFromPath === filePath && cachedInject === inject) {
    return cachedHtml;
  }
  const raw = readFileSync(filePath, "utf8");
  const html = raw.includes("<!--STOCK_SERVER_OPEN_CONFIG-->")
    ? raw.replace("<!--STOCK_SERVER_OPEN_CONFIG-->", inject)
    : raw.replace("</head>", `${inject}\n</head>`);
  cachedHtml = html;
  cachedFromPath = filePath;
  cachedInject = inject;
  return html;
}

/**
 * @param {import("vite").ViteDevServer | import("vite").PreviewServer} server
 */
export function installServerOfflineHtmlMiddleware(server) {
  const root = server.config.root;
  const filePath = resolveOfflineHtmlPath(root);
  if (!filePath) return;

  const offlineHtmlMiddleware = (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const raw = String(req.originalUrl ?? req.url ?? "/");
    const pathname = raw.split("?")[0].split("#")[0] || "/";
    if (pathname !== "/server-offline.html") return next();

    const html = loadOfflineHtml(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(html);
  };

  const stack = server.middlewares?.stack;
  if (Array.isArray(stack)) {
    stack.unshift({ route: "", handle: offlineHtmlMiddleware });
  } else {
    server.middlewares.use(offlineHtmlMiddleware);
  }
}

/**
 * dist에 server-offline.html 복사(텔레그램 폴백 설정 주입)
 * @param {string} root
 * @param {string} outDir
 */
export function writeServerOfflineHtmlForBuild(root, outDir) {
  const src = resolveOfflineHtmlPath(root);
  if (!src) return;
  const dest = path.join(outDir, "server-offline.html");
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, loadOfflineHtml(src), "utf8");
}
