import { loadEnv } from "vite";
import {
  appendAccessLogVite,
  installViteAccessTraceMiddleware,
} from "./access-log.js";
import { startAutoGitSync } from "./auto-git-sync.js";
import { createApp } from "./create-app.js";
import { loadEnvFile } from "./load-env.js";
import { installProcessGuards } from "./process-guards.js";
import { startScreening } from "./screener.js";
import { installAccessGateHtmlMiddleware } from "./vite-access-gate-html.js";

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

  server.middlewares.use((req, _res, next) => {
    if (!req.url?.startsWith("/api")) appendAccessLogVite(req);
    next();
  });

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

  return {
    name: "stock-api",
    enforce: "pre",
    configureServer(server) {
      mergeStockProcessEnv(server.config.mode);
      installAccessGateHtmlMiddleware(server);
      installViteAccessTraceMiddleware(server);
      attachStockApiMiddlewares(server);
      attachAutoGitSyncWhenListening(server);
      setTimeout(() => {
        startScreening().catch(logScreeningError);
      }, 1500);
    },
    configurePreviewServer(server) {
      mergeStockProcessEnv(server.config.mode);
      installAccessGateHtmlMiddleware(server);
      installViteAccessTraceMiddleware(server);
      attachStockApiMiddlewares(server);
      setTimeout(() => {
        startScreening().catch(logScreeningError);
      }, 1500);
    },
  };
}
