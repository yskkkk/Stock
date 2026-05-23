import "./symbol-dispose-polyfill.js";
import { loadEnvFile } from "./load-env.js";
import { installProcessGuards } from "./process-guards.js";
import {
  installOpsServerLifecycleShutdownHooks,
  notifyOpsServerStarted,
} from "./ops-server-lifecycle-notify.js";

installProcessGuards();
loadEnvFile();
installOpsServerLifecycleShutdownHooks();

const { startMacroReminderLoop } = await import("./macro-telegram-reminders.js");
const { startAutoGitSync } = await import("./auto-git-sync.js");
const { createApp } = await import("./create-app.js");
const { prewarmAppCaches } = await import("./prewarm-caches.js");
const { startScreening } = await import("./screener.js");
const { startServerSelfImprovementWatcher } = await import(
  "./server-self-improvement-log.js"
);
const { maybeStartHttpsServer } = await import("./https-listen.js");

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
