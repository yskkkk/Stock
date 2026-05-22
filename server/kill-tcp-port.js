import { execSync } from "node:child_process";

/**
 * TCP 포트를 LISTEN 중인 프로세스 종료 (Windows·Unix).
 * @param {number} port
 * @param {{ exceptPids?: number[] }} [opts]
 * @returns {{ port: number; killed: number[] }}
 */
export function killProcessOnPort(port, opts = {}) {
  const except = new Set(
    (opts.exceptPids ?? [process.pid]).map((n) => Number(n)).filter((n) => n > 0),
  );
  const pids = findListeningPidsOnPort(port).filter((pid) => !except.has(pid));
  const killed = [];

  for (const pid of pids) {
    if (killPid(pid)) killed.push(pid);
  }

  if (killed.length > 0) {
    sleepBrief(process.platform === "win32" ? 750 : 350);
  }

  return { port, killed };
}

/**
 * @param {number} port
 * @returns {number[]}
 */
export function findListeningPidsOnPort(port) {
  const p = Number(port);
  if (!Number.isFinite(p) || p <= 0 || p > 65535) return [];

  if (process.platform === "win32") {
    return findListeningPidsWindows(p);
  }
  return findListeningPidsUnix(p);
}

/**
 * @param {number} port
 * @returns {number[]}
 */
function findListeningPidsWindows(port) {
  const pids = new Set();
  const portTail = `:${port}`;
  try {
    const out = execSync("netstat -ano -p tcp", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      if (!line.includes(portTail)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (pid > 0) pids.add(pid);
    }
  } catch {
    /* ignore */
  }
  return [...pids];
}

/**
 * @param {number} port
 * @returns {number[]}
 */
function findListeningPidsUnix(port) {
  const pids = new Set();
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`, {
      encoding: "utf8",
      shell: true,
    });
    for (const line of out.split(/\r?\n/)) {
      const pid = parseInt(line.trim(), 10);
      if (pid > 0) pids.add(pid);
    }
  } catch {
    /* ignore */
  }
  return [...pids];
}

/** @param {number} pid */
function killPid(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

function sleepBrief(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}
