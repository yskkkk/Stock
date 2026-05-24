import { loadEnv } from "vite";
import path from "path";
import { installViteAccessTraceMiddleware } from "./access-log.js";
import { startAutoGitSync } from "./auto-git-sync.js";
import { createApp } from "./create-app.js";
import { loadEnvFile } from "./load-env.js";
import { installProcessGuards } from "./process-guards.js";
import { migrateLegacyServerLogsSync } from "./log-paths.js";
import { appendServerEventLog } from "./access-log.js";
import { startStockDevSidecarsOnce } from "./dev-sidecars.js";
import {
  installOpsServerLifecycleShutdownHooks,
  notifyOpsServerStarted,
} from "./ops-server-lifecycle-notify.js";
import { installAccessGateHtmlMiddleware } from "./vite-access-gate-html.js";
import { registerViteIntegratedRestart } from "./restart-node-process.js";
import { clearViteRestartMarker } from "./vite-restart-marker.js";
import { installViteMobileApkMiddleware } from "./mobile-apk-download.js";
import { installViteMobileIosMiddleware } from "./mobile-ios-download.js";
import { installServerOfflineHtmlMiddleware, writeServerOfflineHtmlForBuild } from "./vite-server-offline-html.js";

function mergeStockProcessEnv(mode) {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "development";
  }
  const env = loadEnv(mode, process.cwd(), "");
  if (env.OPENDART_API_KEY) {
    process.env.OPENDART_API_KEY = env.OPENDART_API_KEY;
  }
  for (const key of [
    "YAHOO_MAX_CONCURRENT",
    "YAHOO_REQUEST_GAP_MS",
    "SCREEN_CONCURRENCY",
    "SCREEN_INTERVAL_MS",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "TELEGRAM_OPS_BOT_TOKEN",
    "TELEGRAM_OPS_CHAT_ID",
    "SERVER_OPEN_CLIENT_TELEGRAM",
    "TELEGRAM_MIN_SCORE",
    "TELEGRAM_RESET_ADMIN_IPS",
    "ACCESS_ADMIN_IPS",
    "ACCESS_CONTROL_ENABLED",
    "ACCESS_CONTROL_DISABLED",
    "ACCESS_ADMIN_TOKEN",
    "ACCESS_BOOTSTRAP_IPS",
    "ACCESS_ALLOW_LOCALHOST",
    "FEEDBACK_INBOX_TOKEN",
    "CURSOR_API_KEY",
    "CURSOR_AGENT_MODEL",
    "CURSOR_RIPGREP_PATH",
    "AUTO_GIT_SYNC",
    "AUTO_GIT_SYNC_INTERVAL_MS",
    "AUTO_GIT_REMOTE",
    "AUTO_GIT_BRANCH",
    "AUTO_GIT_SKIP_NPM_REFRESH",
    "AUTO_GIT_POST_PULL_CMD",
    "BITHUMB_API_KEY",
    "BITHUMB_SECRET_KEY",
    "BITHUMB_LIVE_ORDERS_ENABLED",
    "BITHUMB_API_BASE_URL",
    "TOSS_API_KEY",
    "TOSS_API_SECRET",
    "TOSS_ACCOUNT_ID",
    "TOSS_LIVE_ORDERS_ENABLED",
  ]) {
    if (env[key]) process.env[key] = env[key];
  }
  loadEnvFile();
}

/**
 * @param {import("vite").ViteDevServer | import("vite").PreviewServer} server
 */
function attachStockApiMiddlewares(server) {
  const g = /** @type {typeof globalThis & {
    __stockExpressApp?: ReturnType<typeof createApp>;
  }} */ (globalThis);
  if (!g.__stockExpressApp) {
    g.__stockExpressApp = createApp();
  }
  const app = g.__stockExpressApp;

  server.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith("/api")) return next();
    app(req, res, (err) => {
      if (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[api] 요청 처리 오류:", msg);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({ error: "서버 오류가 발생했습니다." }),
          );
        }
        return;
      }
      next();
    });
  });
}

/** Vite 개발 서버만 — `npm run preview`는 보통 `server/index.js`와 동시에 뜨므로 중복 방지 */
function attachAutoGitSyncWhenListening(server) {
  const hs = server.httpServer;
  if (!hs) return;
  const go = () => startAutoGitSync({ httpServer: hs });
  if (hs.listening) go();
  else hs.once("listening", go);
}

export function stockApiPlugin() {
  installProcessGuards();
  installOpsServerLifecycleShutdownHooks();

  return {
    name: "stock-api",
    enforce: "pre",
    configureServer(server) {
      mergeStockProcessEnv(server.config.mode);
      clearViteRestartMarker();
      registerViteIntegratedRestart(async () => {
        const { markViteRestartStarting } = await import("./vite-restart-marker.js");
        markViteRestartStarting();
        await server.restart();
        clearViteRestartMarker();
      });
      const port = server.config.server?.port ?? 5173;
      const notifyStart = () =>
        notifyOpsServerStarted({ mode: "dev (Vite)", port });
      if (server.httpServer?.listening) notifyStart();
      else server.httpServer?.once("listening", notifyStart);
      installViteMobileApkMiddleware(server.middlewares);
      installViteMobileIosMiddleware(server.middlewares);
      installAccessGateHtmlMiddleware(server);
      installServerOfflineHtmlMiddleware(server);
      installViteAccessTraceMiddleware(server);
      attachStockApiMiddlewares(server);
      attachAutoGitSyncWhenListening(server);
      migrateLegacyServerLogsSync();
      startStockDevSidecarsOnce("dev 서버 기동");
    },
    configurePreviewServer(server) {
      mergeStockProcessEnv(server.config.mode);
      const port = server.config.preview?.port ?? server.config.server?.port ?? 4173;
      const notifyStart = () =>
        notifyOpsServerStarted({ mode: "preview (Vite)", port });
      if (server.httpServer?.listening) notifyStart();
      else server.httpServer?.once("listening", notifyStart);
      installViteMobileApkMiddleware(server.middlewares);
      installViteMobileIosMiddleware(server.middlewares);
      installAccessGateHtmlMiddleware(server);
      installServerOfflineHtmlMiddleware(server);
      installViteAccessTraceMiddleware(server);
      attachStockApiMiddlewares(server);
      migrateLegacyServerLogsSync();
      startStockDevSidecarsOnce("preview 서버 기동");
    },
    closeBundle() {
      if (process.env.VITEST) return;
      mergeStockProcessEnv(process.env.NODE_ENV === "production" ? "production" : "development");
      const root = process.cwd();
      const outDir = path.join(root, "dist");
      writeServerOfflineHtmlForBuild(root, outDir);
    },
  };
}
