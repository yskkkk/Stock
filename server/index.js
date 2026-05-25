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
const { startStockDevSidecarsOnce } = await import("./dev-sidecars.js");
const { maybeStartHttpsServer } = await import("./https-listen.js");
const {
  ensureLiveTradeSellSettingsMigratedOnce,
  ensureLiveTradeExitScenarioMigratedOnce,
} = await import("./live-trade-settings-migrate.js");

const PORT = Number(process.env.PORT) || 3456;
ensureLiveTradeSellSettingsMigratedOnce().catch((e) => {
  console.warn(
    "[live-trade:migrate] startup apply failed:",
    e instanceof Error ? e.message : e,
  );
});
ensureLiveTradeExitScenarioMigratedOnce().catch((e) => {
  console.warn(
    "[live-trade:migrate] exit scenario v3 failed:",
    e instanceof Error ? e.message : e,
  );
});
const { ensureBoxRangeScenarioRolloutOnce } = await import(
  "./box-range/migrate-active-programs.js"
);
if (process.env.STOCK_BOX_RANGE_ROLLOUT_FORCE === "1") {
  ensureBoxRangeScenarioRolloutOnce({
    force: true,
    sendEmail: process.env.STOCK_BOX_RANGE_ROLLOUT_EMAIL === "1",
    emailForce: process.env.STOCK_BOX_RANGE_ROLLOUT_EMAIL_FORCE === "1",
  }).catch((e) => {
    console.warn(
      "[box-range:rollout] scenario v2 failed:",
      e instanceof Error ? e.message : e,
    );
  });
}
const app = createApp();
startStockDevSidecarsOnce("API 서버 기동");

startMacroReminderLoop();

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
