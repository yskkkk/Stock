/**
 * 서버 기동·종료 훅 (텔레그램 ON/OFF 알림은 기본 비활성 — OPS_SERVER_LIFECYCLE_TELEGRAM=1 일 때만)
 */
import {
  isOpsTelegramNotifyEnabled,
  resolveOpsTelegramCreds,
  sendTelegramMessage,
} from "./telegram-notify.js";

const _lcg = /** @type {typeof globalThis & { __stockLifecycleShutdownInstalled?: boolean; __stockLifecycleStartNotified?: boolean; __stockLifecycleStopNotified?: boolean; __stockLifecycleMeta?: { mode?: string; port?: number | string } }} */ (globalThis);

function isShutdownInstalled() { return _lcg.__stockLifecycleShutdownInstalled === true; }
function markShutdownInstalled() { _lcg.__stockLifecycleShutdownInstalled = true; }
function isStartNotified() { return _lcg.__stockLifecycleStartNotified === true; }
function markStartNotified() { _lcg.__stockLifecycleStartNotified = true; }
function isStopNotified() { return _lcg.__stockLifecycleStopNotified === true; }
function markStopNotified() { _lcg.__stockLifecycleStopNotified = true; }
function resetStopNotified() { _lcg.__stockLifecycleStopNotified = false; }

function serverLifecycleTelegramEnabled() {
  const v = String(process.env.OPS_SERVER_LIFECYCLE_TELEGRAM ?? "0")
    .toLowerCase()
    .trim();
  return v === "1" || v === "true" || v === "yes";
}
/** @type {{ mode?: string; port?: number | string }} */
function getLifecycleMeta() { return _lcg.__stockLifecycleMeta ?? { mode: "server" }; }
function setLifecycleMeta(m) { _lcg.__stockLifecycleMeta = m; }

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function kstNowLabel() {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * @param {"on"|"off"} phase
 * @param {{ mode?: string; port?: number | string; reason?: string }} [meta]
 */
export async function notifyOpsServerLifecycle(phase, meta = {}) {
  if (!serverLifecycleTelegramEnabled()) return false;
  if (!isOpsTelegramNotifyEnabled()) return false;

  const mode = String(meta.mode ?? "server").trim() || "server";
  const port =
    meta.port != null && String(meta.port).trim() ? String(meta.port).trim() : null;
  const reason = String(meta.reason ?? "").trim();

  const lines =
    phase === "on"
      ? ["<b>Stock 서버 ON</b>", "", `📌 <b>${escHtml(mode)}</b>`]
      : ["<b>Stock 서버 OFF</b>", "", `📌 <b>${escHtml(mode)}</b>`];

  if (port) lines.push(`🔌 포트 ${escHtml(port)}`);
  if (phase === "off" && reason) lines.push(`⚙️ ${escHtml(reason)}`);
  lines.push("", `<i>🕐 ${kstNowLabel()} KST</i>`);

  return sendTelegramMessage(lines.join("\n"), undefined, resolveOpsTelegramCreds());
}

/**
 * @param {{ mode?: string; port?: number | string }} [meta]
 */
export function notifyOpsServerStarted(meta = {}) {
  if (isStartNotified()) return;
  markStartNotified();
  resetStopNotified();
  setLifecycleMeta({ ...meta });
  void notifyOpsServerLifecycle("on", meta)
    .then((ok) => {
      if (ok) console.info("[ops-lifecycle] telegram ON sent", meta.mode ?? "server");
    })
    .catch((e) => {
      console.warn(
        "[ops-lifecycle] telegram ON failed:",
        e instanceof Error ? e.message : e,
      );
    });
}

/**
 * @param {{ mode?: string; port?: number | string; reason?: string }} [meta]
 */
export async function notifyOpsServerStopped(meta = {}) {
  if (isStopNotified()) return false;
  markStopNotified();
  try {
    const ok = await notifyOpsServerLifecycle("off", meta);
    if (ok) console.info("[ops-lifecycle] telegram OFF sent", meta.mode ?? "server");
    return ok;
  } catch (e) {
    console.warn(
      "[ops-lifecycle] telegram OFF failed:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}

/** 프로세스당 1회 — SIGINT/SIGTERM/SIGBREAK */
export function installOpsServerLifecycleShutdownHooks() {
  if (isShutdownInstalled()) return;
  markShutdownInstalled();

  const run = (reason) => {
    notifyOpsServerStopped({ ...getLifecycleMeta(), reason })
      .catch(() => {})
      .finally(() => process.exit(0));
  };

  process.once("SIGINT", () => run("SIGINT"));
  process.once("SIGTERM", () => run("SIGTERM"));
  if (process.platform === "win32") {
    process.once("SIGBREAK", () => run("SIGBREAK"));
  }

  process.once("beforeExit", () => {
    if (!isStopNotified()) run("beforeExit");
  });
}
