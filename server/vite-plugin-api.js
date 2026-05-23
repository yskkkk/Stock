import { loadEnv } from "vite";
import { installViteAccessTraceMiddleware } from "./access-log.js";
import { startAutoGitSync } from "./auto-git-sync.js";
import { createApp } from "./create-app.js";
import { loadEnvFile } from "./load-env.js";
import { installProcessGuards } from "./process-guards.js";
import { migrateLegacyServerLogsSync } from "./log-paths.js";
import { appendServerEventLog } from "./access-log.js";
import { startDevQueueDisplaySyncPoller } from "./ops-dev-queue-display-sync.js";
import { startOpsIdeTranscriptPoller } from "./ops-ide-transcript-poller.js";
import { startLiveTradeAutoSellPoller } from "./live-trade-auto-sell.js";
import {
  installOpsServerLifecycleShutdownHooks,
  notifyOpsServerStarted,
} from "./ops-server-lifecycle-notify.js";
import { prewarmAppCaches } from "./prewarm-caches.js";
import { startScreening } from "./screener.js";
import { startServerSelfImprovementWatcher } from "./server-self-improvement-log.js";
import { installAccessGateHtmlMiddleware } from "./vite-access-gate-html.js";
import { registerViteIntegratedRestart } from "./restart-node-process.js";
import { installViteMobileApkMiddleware } from "./mobile-apk-download.js";
import { installViteMobileIosMiddleware } from "./mobile-ios-download.js";

function logScreeningError(err) {
  console.warn(
    "[screener]",
    err instanceof Error ? err.message : err,
  );
}

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
  const app = createApp();

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
      registerViteIntegratedRestart(() => server.restart());
      const port = server.config.server?.port ?? 5173;
      const notifyStart = () =>
        notifyOpsServerStarted({ mode: "dev (Vite)", port });
      if (server.httpServer?.listening) notifyStart();
      else server.httpServer?.once("listening", notifyStart);
      installViteMobileApkMiddleware(server.middlewares);
      installViteMobileIosMiddleware(server.middlewares);
      installAccessGateHtmlMiddleware(server);
      installViteAccessTraceMiddleware(server);
      attachStockApiMiddlewares(server);
      attachAutoGitSyncWhenListening(server);
      migrateLegacyServerLogsSync();
      const g = /** @type {typeof globalThis & { __stockViteDevSidecars?: boolean }} */ (
        globalThis
      );
      if (!g.__stockViteDevSidecars) {
        g.__stockViteDevSidecars = true;
        appendServerEventLog(
          "server",
          "dev 서버 기동 — 로그는 server/.logs 에 append 유지",
        );
        startDevQueueDisplaySyncPoller();
        startOpsIdeTranscriptPoller();
        startLiveTradeAutoSellPoller();
        startServerSelfImprovementWatcher();
        setTimeout(() => prewarmAppCaches(), 400);
        setTimeout(() => {
          startScreening().catch(logScreeningError);
        }, 1500);
      }
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
      installViteAccessTraceMiddleware(server);
      attachStockApiMiddlewares(server);
      migrateLegacyServerLogsSync();
      appendServerEventLog("server", "preview 서버 기동 — 로그는 server/.logs 에 append 유지");
      startDevQueueDisplaySyncPoller();
      startOpsIdeTranscriptPoller();
      startLiveTradeAutoSellPoller();
      startServerSelfImprovementWatcher();
      setTimeout(() => prewarmAppCaches(), 400);
      setTimeout(() => {
        startScreening().catch(logScreeningError);
      }, 1500);
    },
  };
}
