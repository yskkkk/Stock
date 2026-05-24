/**
 * Stock dev 서버 감시: `npm run dev`가 죽었거나 장시간 응답 없을 때만 자동 재기동.
 *
 * Vite `server.restart()`·짧은 API 끊김에는 프로세스를 건드리지 않는다.
 *
 * [사용]
 *   npm run dev:guard
 *
 * 환경변수(선택):
 *   DEV_GUARD_INTERVAL_MS — 헬스체크 주기(ms). 기본 15000
 *   DEV_GUARD_MAX_FAILURES — 프로세스 없을 때 연속 실패 후 재시작. 기본 3
 *   DEV_GUARD_MAX_FAILURES_ALIVE — dev 살아 있을 때 연속 실패 후 재시작. 기본 12
 *   DEV_GUARD_RESTART_COOLDOWN_MS — 재시작 간 최소 대기(ms). 기본 20000
 *   DEV_GUARD_STARTUP_GRACE_MS — 기동 직후 헬스 생략(ms). 기본 90000
 *   DEV_GUARD_EXIT_PROBE_MS — 종료 후 포트 확인 대기·간격. 기본 4000
 *   DEV_GUARD_EXIT_PROBE_TRIES — 종료 후 확인 횟수. 기본 5
 *   VITE_DEV_PORT — dev 포트. 기본 5173
 */
import { spawn } from "node:child_process";
import http from "node:http";
import process from "node:process";
import treeKill from "tree-kill";
import { killProcessOnPort } from "../server/kill-tcp-port.js";
import { isViteRestartRecent } from "../server/vite-restart-marker.js";

const ROOT = process.cwd();
const INTERVAL_MS = Number(process.env.DEV_GUARD_INTERVAL_MS) || 15_000;
const PORT = Number(process.env.VITE_DEV_PORT) || 5173;
const FAIL_THRESHOLD_DEAD = Math.max(
  1,
  Number(process.env.DEV_GUARD_MAX_FAILURES) || 3,
);
const FAIL_THRESHOLD_ALIVE = Math.max(
  FAIL_THRESHOLD_DEAD,
  Number(process.env.DEV_GUARD_MAX_FAILURES_ALIVE) || 12,
);
const COOLDOWN_MS = Number(process.env.DEV_GUARD_RESTART_COOLDOWN_MS) || 20_000;
const PROBE_TIMEOUT_MS = Number(process.env.DEV_GUARD_PROBE_TIMEOUT_MS) || 8_000;
const STARTUP_GRACE_MS =
  Number(process.env.DEV_GUARD_STARTUP_GRACE_MS) || 90_000;
const EXIT_PROBE_MS = Number(process.env.DEV_GUARD_EXIT_PROBE_MS) || 4_000;
const EXIT_PROBE_TRIES = Math.max(
  1,
  Number(process.env.DEV_GUARD_EXIT_PROBE_TRIES) || 5,
);

let devProc = null;
let shuttingDown = false;
let restarting = false;
let failStreak = 0;
let lastRestartAt = 0;
let devStartedAt = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let exitRestartTimer = null;
let exitRecoveryPending = false;

function stopDev() {
  return new Promise((resolve) => {
    if (!devProc?.pid) {
      devProc = null;
      resolve();
      return;
    }
    const pid = devProc.pid;
    devProc = null;
    treeKill(pid, "SIGTERM", (err) => {
      if (err) console.warn("[dev:guard] 종료 경고:", err.message);
      resolve();
    });
  });
}

function freeDevPort() {
  const { killed } = killProcessOnPort(PORT, {
    exceptPids: [process.pid, devProc?.pid].filter(Boolean),
  });
  if (killed.length) {
    console.log(
      `[dev:guard] 포트 ${PORT} 정리 (pid ${killed.join(", ")}) 후 dev 재시작`,
    );
  }
}

function startDev() {
  freeDevPort();
  devProc = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  devProc.on("exit", (code, signal) => {
    console.log(
      `[dev:guard] npm run dev 종료 code=${code ?? ""} signal=${signal ?? ""}`,
    );
    devProc = null;
    if (shuttingDown || restarting) return;
    scheduleRestartAfterExit(code, signal);
  });
  failStreak = 0;
  exitRecoveryPending = false;
  devStartedAt = Date.now();
  console.log(`[dev:guard] npm run dev 기동 (pid ${devProc.pid})`);
}

function inStartupGrace() {
  return devStartedAt > 0 && Date.now() - devStartedAt < STARTUP_GRACE_MS;
}

function inViteRestartQuietPeriod() {
  return isViteRestartRecent(
    Number(process.env.DEV_GUARD_VITE_RESTART_QUIET_MS) || 120_000,
  );
}

function failThresholdForCurrentState() {
  return devProc?.pid ? FAIL_THRESHOLD_ALIVE : FAIL_THRESHOLD_DEAD;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function probeDevServer() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/api/access/status",
        timeout: PROBE_TIMEOUT_MS,
        headers: { Accept: "application/json" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 8192) res.destroy();
        });
        res.on("end", () => {
          const statusOk =
            res.statusCode >= 200 && res.statusCode < 500;
          if (!statusOk) {
            resolve(false);
            return;
          }
          try {
            const data = JSON.parse(body);
            resolve(
              typeof data === "object" &&
                data !== null &&
                ("enabled" in data || "state" in data),
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

/** @returns {Promise<boolean>} */
async function probeDevServerWithRetries(tries, gapMs) {
  for (let i = 0; i < tries; i++) {
    if (await probeDevServer()) return true;
    if (i < tries - 1) await sleep(gapMs);
  }
  return false;
}

async function restartDev(reason) {
  if (shuttingDown || restarting) return;
  const since = Date.now() - lastRestartAt;
  if (since < COOLDOWN_MS) {
    console.log(
      `[dev:guard] 재시작 대기 중 (${Math.ceil((COOLDOWN_MS - since) / 1000)}초 남음) — ${reason}`,
    );
    return;
  }
  if (await probeDevServer()) {
    console.log(
      `[dev:guard] 재기동 요청했으나 HTTP 응답 있음 — 생략 (${reason})`,
    );
    failStreak = 0;
    exitRecoveryPending = false;
    return;
  }
  restarting = true;
  lastRestartAt = Date.now();
  console.log(`[dev:guard] dev 재시작 — ${reason}`);
  try {
    await stopDev();
    await sleep(400);
    freeDevPort();
    startDev();
    await sleep(Math.min(12_000, Math.max(4000, STARTUP_GRACE_MS / 6)));
  } finally {
    restarting = false;
  }
}

function scheduleRestart(reason) {
  void restartDev(reason);
}

/** 종료 직후: 여러 번 포트 확인 후에만 전체 재기동 */
function scheduleRestartAfterExit(code, signal) {
  if (exitRestartTimer) clearTimeout(exitRestartTimer);
  exitRecoveryPending = true;
  const waitMs = inStartupGrace()
    ? Math.max(EXIT_PROBE_MS * 2, 12_000)
    : EXIT_PROBE_MS;

  exitRestartTimer = setTimeout(() => {
    exitRestartTimer = null;
    void (async () => {
      if (shuttingDown || restarting) return;
      if (devProc?.pid) {
        exitRecoveryPending = false;
        return;
      }
      const ok = await probeDevServerWithRetries(
        EXIT_PROBE_TRIES,
        EXIT_PROBE_MS,
      );
      exitRecoveryPending = false;
      if (ok) {
        console.log(
          "[dev:guard] 프로세스는 종료됐지만 포트 응답 — 다른 인스턴스·복구로 간주, 재기동 생략",
        );
        failStreak = 0;
        return;
      }
      scheduleRestart(
        `프로세스 종료 code=${code ?? ""} signal=${signal ?? ""}`,
      );
    })();
  }, waitMs);
}

async function main() {
  const shutdown = async () => {
    shuttingDown = true;
    if (exitRestartTimer) clearTimeout(exitRestartTimer);
    console.log("\n[dev:guard] 종료 중…");
    await stopDev();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(
    `[dev:guard] 포트 ${PORT} 감시 · ${INTERVAL_MS / 1000}초마다 확인 · ` +
      `실패 ${FAIL_THRESHOLD_ALIVE}(alive)/${FAIL_THRESHOLD_DEAD}(dead) · Ctrl+C 종료`,
  );
  startDev();

  for (;;) {
    await sleep(INTERVAL_MS);
    if (shuttingDown || restarting) continue;

    if (inViteRestartQuietPeriod()) {
      failStreak = 0;
      continue;
    }

    if (!devProc?.pid) {
      if (exitRecoveryPending) continue;
      const ok = await probeDevServer();
      if (ok) {
        console.log(
          "[dev:guard] child 없음·포트 응답 — 종료 복구 대기 중, 재기동 안 함",
        );
        continue;
      }
      scheduleRestartAfterExit("?", "no-child");
      continue;
    }

    if (inStartupGrace()) {
      failStreak = 0;
      continue;
    }

    const ok = await probeDevServer();
    if (ok) {
      if (failStreak > 0) {
        console.log("[dev:guard] 헬스체크 복구");
      }
      failStreak = 0;
      continue;
    }

    failStreak += 1;
    const threshold = failThresholdForCurrentState();
    console.warn(
      `[dev:guard] 헬스체크 실패 (${failStreak}/${threshold}) ` +
        `http://127.0.0.1:${PORT}/api/access/status` +
        (devProc?.pid ? " · dev 프로세스는 살아 있음" : ""),
    );
    if (failStreak >= threshold) {
      failStreak = 0;
      if (devProc?.pid) {
        console.warn(
          "[dev:guard] 프로세스는 살아 있으나 API 무응답 — 강제 재기동",
        );
      }
      scheduleRestart("연속 헬스체크 실패");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
