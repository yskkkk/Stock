import "./symbol-dispose-polyfill.js";
import { startMacroReminderLoop } from "./macro-telegram-reminders.js";
import { startAutoGitSync } from "./auto-git-sync.js";
import { createApp } from "./create-app.js";
import { loadEnvFile } from "./load-env.js";
import { installProcessGuards } from "./process-guards.js";
import { prewarmAppCaches } from "./prewarm-caches.js";
import {
  installOpsServerLifecycleShutdownHooks,
  notifyOpsServerStarted,
} from "./ops-server-lifecycle-notify.js";
import { startScreening } from "./screener.js";
import { startServerSelfImprovementWatcher } from "./server-self-improvement-log.js";
import { maybeStartHttpsServer } from "./https-listen.js";

installProcessGuards();
loadEnvFile();
installOpsServerLifecycleShutdownHooks();

const PORT = Number(process.env.PORT) || 3456;
const app = createApp();
prewarmAppCaches();
startScreening().catch((err) => {
  console.warn("[screener]", err instanceof Error ? err.message : err);
});

startMacroReminderLoop();
startServerSelfImprovementWatcher();

const server = app.listen(PORT, () => {
  console.log(`API server http://localhost:${PORT}`);
  notifyOpsServerStarted({ mode: "API", port: PORT });
  startAutoGitSync({ httpServer: server });
});

maybeStartHttpsServer(app, { httpPort: PORT });

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} in use — stop the old server or set PORT=3457`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
