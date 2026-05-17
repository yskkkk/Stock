import { spawn } from "node:child_process";
import { appendServerEventLog } from "./access-log.js";

/** Vite `configureServer`에서 등록. 있으면 http close + process.exit 대신 Vite 재시작만 한다. */
let viteIntegratedRestart = null;

/**
 * @param {null | (() => void | Promise<void>)} fn
 */
export function registerViteIntegratedRestart(fn) {
  viteIntegratedRestart = typeof fn === "function" ? fn : null;
}

export function isViteIntegratedRestartActive() {
  return typeof viteIntegratedRestart === "function";
}

/**
 * Vite 통합 개발 서버면 `server.restart()`, 아니면 기존 프로세스 respawn.
 * Express 미들웨어의 `req.socket?.server`는 Vite와 맞지 않을 때가 있어, 여기서 우선 처리한다.
 *
 * @param {import("http").Server | null | undefined} httpServer
 * @returns {Promise<boolean>}
 */
export async function restartNodeOrViteDev(httpServer) {
  if (isViteIntegratedRestartActive()) {
    try {
      appendServerEventLog(
        "restart",
        "Vite integrated dev — server.restart() (no process exit)",
      );
      await Promise.resolve(viteIntegratedRestart());
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendServerEventLog("restart", `Vite restart failed: ${msg}`, "error");
      return false;
    }
  }
  return respawnNodeProcess(httpServer);
}

/**
 * @param {import("http").Server} server
 * @param {number} port
 * @param {string | undefined} host
 */
function relistenHttpServer(server, port, host) {
  return new Promise((resolve, reject) => {
    const onListen = () => {
      server.removeListener("error", onErr);
      resolve(undefined);
    };
    const onErr = (err) => {
      server.removeListener("listening", onListen);
      reject(err);
    };
    server.once("listening", onListen);
    server.once("error", onErr);
    try {
      if (host && host !== "::") {
        server.listen(port, host);
      } else {
        server.listen(port);
      }
    } catch (e) {
      server.removeListener("listening", onListen);
      server.removeListener("error", onErr);
      reject(e);
    }
  });
}

/**
 * 장기 연결(SSE 등) 때문에 `close()`가 오래 걸릴 때를 대비한다.
 * @param {import("http").Server} server
 * @param {number} timeoutMs
 * @returns {Promise<"closed" | "still_listening" | { kind: "error"; message: string }>}
 */
async function closeHttpServerWithTimeout(server, timeoutMs) {
  try {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    } else if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }
  } catch {
    /* ignore */
  }

  const outcome = await new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      appendServerEventLog(
        "restart",
        `httpServer.close 대기 ${timeoutMs}ms 초과 — closeAllConnections 재시도`,
        "warn",
      );
      try {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
      } catch {
        /* ignore */
      }
      resolve("timeout");
    }, timeoutMs);

    server.close((err) => {
      clearTimeout(timeoutId);
      if (err) resolve({ kind: "error", message: err.message });
      else resolve("closed");
    });
  });

  if (typeof outcome === "object" && outcome?.kind === "error") {
    return outcome;
  }

  if (server.listening) {
    await new Promise((r) => setTimeout(r, 350));
  }
  return server.listening ? "still_listening" : "closed";
}

/**
 * 운영 에이전트·auto-git 등에서 동일한 방식으로 Node를 다시 띄우기 위한 공통 모듈.
 *
 * - 열린 연결을 끊어 `close()`가 막히지 않게 한다.
 * - `close()`에 상한 시간을 두고, 끝까지 닫히지 않으면 **자식 프로세스를 만들지 않고** false를 반환한다(이중 bind 방지).
 * - 닫은 뒤 `spawn`이 실패하면 같은 `http.Server`에 `listen()`을 다시 걸어 서비스를 복구한다.
 *
 * @param {import("http").Server | null | undefined} httpServer
 * @returns {Promise<boolean>} 자식 기동 후 곧 부모가 종료되면 true, 중단·복구면 false
 */
export async function respawnNodeProcess(httpServer) {
  if (!httpServer || typeof httpServer.close !== "function") {
    appendServerEventLog("restart", "no http.Server — skip respawn", "warn");
    return false;
  }

  const savedAddr = httpServer.address();
  const port =
    typeof savedAddr === "object" && savedAddr && "port" in savedAddr
      ? /** @type {{ port: number }} */ (savedAddr).port
      : Number(process.env.PORT) || 3456;
  const host =
    typeof savedAddr === "object" &&
    savedAddr &&
    "address" in savedAddr &&
    typeof /** @type {{ address?: string }} */ (savedAddr).address === "string"
      ? /** @type {{ address: string }} */ (savedAddr).address
      : undefined;

  const closeTimeoutMs = Math.max(
    3000,
    Number(process.env.RESPAWN_CLOSE_TIMEOUT_MS) || 25_000,
  );

  let closeState;
  try {
    closeState = await closeHttpServerWithTimeout(httpServer, closeTimeoutMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendServerEventLog("restart", `httpServer.close error: ${msg}`, "error");
    return false;
  }

  if (typeof closeState === "object" && closeState?.kind === "error") {
    appendServerEventLog(
      "restart",
      `httpServer.close 실패: ${closeState.message}`,
      "error",
    );
    return false;
  }

  if (closeState === "still_listening") {
    appendServerEventLog(
      "restart",
      "http.Server가 닫히지 않아 재시작을 중단했습니다. (장기 SSE 등이 있으면 끊은 뒤 다시 시도하세요.)",
      "error",
    );
    return false;
  }

  const spawnOpts = {
    cwd: process.cwd(),
    detached: true,
    stdio: "inherit",
    env: process.env,
  };
  if (process.platform === "win32") {
    spawnOpts.shell = true;
  }

  let child;
  try {
    child = spawn(process.argv[0], process.argv.slice(1), spawnOpts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendServerEventLog("restart", `spawn threw: ${msg} — relistening`, "error");
    try {
      await relistenHttpServer(httpServer, port, host);
      appendServerEventLog("restart", "listen 복구 완료 — 이전 프로세스가 계속 요청을 받습니다.", "warn");
    } catch (e2) {
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      appendServerEventLog("restart", `listen 복구 실패: ${m2}`, "error");
    }
    return false;
  }

  if (!child.pid) {
    appendServerEventLog("restart", "spawn returned no pid — relistening", "error");
    try {
      await relistenHttpServer(httpServer, port, host);
      appendServerEventLog("restart", "listen 복구 완료", "warn");
    } catch (e2) {
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      appendServerEventLog("restart", `listen 복구 실패: ${m2}`, "error");
    }
    return false;
  }

  appendServerEventLog("restart", `spawn OK pid=${child.pid} — parent exit soon`);

  child.once("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    appendServerEventLog("restart", `spawn child error event: ${msg}`, "error");
  });

  child.unref();
  const exitDelay =
    Number(process.env.RESPAWN_PARENT_EXIT_DELAY_MS) ||
    (process.platform === "win32" ? 900 : 450);
  setTimeout(() => process.exit(0), exitDelay);
  return true;
}

/** 기본: 켜짐. `0` / `false` / `no` / `off` 만 끔. */
export function isOpsAgentPostRestartEnabled() {
  const v = String(process.env.OPS_AGENT_RESTART_SERVER ?? "")
    .trim()
    .toLowerCase();
  if (!v) return true;
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}
