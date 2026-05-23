/**
 * Stock dev 서버 감시: `npm run dev`가 종료되었거나 HTTP 응답이 없으면 자동 재기동.
 *
 * [사용]
 *   npm run dev:guard
 *   (이 터미널은 닫지 말고 두기 — 별도로 `npm run dev` 를 켤 필요 없음)
 *
 * 환경변수(선택):
 *   DEV_GUARD_INTERVAL_MS — 헬스체크 주기(ms). 기본 15000
 *   DEV_GUARD_MAX_FAILURES — 연속 실패 횟수 후 재시작. 기본 4
 *   DEV_GUARD_RESTART_COOLDOWN_MS — 재시작 간 최소 대기(ms). 기본 15000
 *   DEV_GUARD_STARTUP_GRACE_MS — 기동·Vite server.restart 직후 헬스체크 생략(ms). 기본 90000
 *   VITE_DEV_PORT — dev 포트. 기본 5173
 */
import { spawn } from "node:child_process";
import http from "node:http";
import process from "node:process";
import treeKill from "tree-kill";
import { killProcessOnPort } from "../server/kill-tcp-port.js";

const ROOT = process.cwd();
const INTERVAL_MS = Number(process.env.DEV_GUARD_INTERVAL_MS) || 15_000;
const PORT = Number(process.env.VITE_DEV_PORT) || 5173;
const FAIL_THRESHOLD = Math.max(1, Number(process.env.DEV_GUARD_MAX_FAILURES) || 4);
const COOLDOWN_MS = Number(process.env.DEV_GUARD_RESTART_COOLDOWN_MS) || 15_000;
const PROBE_TIMEOUT_MS = Number(process.env.DEV_GUARD_PROBE_TIMEOUT_MS) || 8_000;
const STARTUP_GRACE_MS =
  Number(process.env.DEV_GUARD_STARTUP_GRACE_MS) || 90_000;

let devProc = null;
let shuttingDown = false;
let restarting = false;
let failStreak = 0;
let lastRestartAt = 0;
let devStartedAt = 0;

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
    scheduleRestart("프로세스 종료");
  });
  failStreak = 0;
  devStartedAt = Date.now();
  console.log(`[dev:guard] npm run dev 기동 (pid ${devProc.pid})`);
}

function inStartupGrace() {
  return devStartedAt > 0 && Date.now() - devStartedAt < STARTUP_GRACE_MS;
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
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
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

async function main() {
  const shutdown = async () => {
    shuttingDown = true;
    console.log("\n[dev:guard] 종료 중…");
    await stopDev();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(
    `[dev:guard] 포트 ${PORT} 감시 · ${INTERVAL_MS / 1000}초마다 확인 · Ctrl+C 로 종료`,
  );
  startDev();

  for (;;) {
    await sleep(INTERVAL_MS);
    if (shuttingDown || restarting) continue;

    if (!devProc?.pid) {
      scheduleRestart("dev 프로세스 없음");
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
    console.warn(
      `[dev:guard] 헬스체크 실패 (${failStreak}/${FAIL_THRESHOLD}) http://127.0.0.1:${PORT}/api/access/status`,
    );
    if (failStreak >= FAIL_THRESHOLD) {
      failStreak = 0;
      scheduleRestart("연속 헬스체크 실패");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
