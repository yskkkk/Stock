import { loadEnv } from "vite";
import { createApp } from "./create-app.js";
import { loadEnvFile } from "./load-env.js";
import { installProcessGuards } from "./process-guards.js";
import { startScreening } from "./screener.js";

function logScreeningError(err) {
  console.warn(
    "[screener]",
    err instanceof Error ? err.message : err,
  );
}

export function stockApiPlugin() {
  installProcessGuards();
  const app = createApp();
  return {
    name: "stock-api",
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), "");
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
      ]) {
        if (env[key]) process.env[key] = env[key];
      }
      loadEnvFile();

      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();
        app(req, res, (err) => {
          if (err) {
            console.error("[api]", err);
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

      setTimeout(() => {
        startScreening().catch(logScreeningError);
      }, 1500);
    },
  };
}
