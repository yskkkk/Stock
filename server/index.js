import "./symbol-dispose-polyfill.js";
import { startMacroReminderLoop } from "./macro-telegram-reminders.js";
import { startAutoGitSync } from "./auto-git-sync.js";
import { createApp } from "./create-app.js";
import { loadEnvFile } from "./load-env.js";
import { installProcessGuards } from "./process-guards.js";
import { prewarmAppCaches } from "./prewarm-caches.js";
import { startScreening } from "./screener.js";

installProcessGuards();
loadEnvFile();

const PORT = Number(process.env.PORT) || 3456;
const app = createApp();
prewarmAppCaches();
startScreening().catch((err) => {
  console.warn("[screener]", err instanceof Error ? err.message : err);
});

startMacroReminderLoop();

const server = app.listen(PORT, () => {
  console.log(`API server http://localhost:${PORT}`);
  startAutoGitSync({ httpServer: server });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} in use — stop the old server or set PORT=3457`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
