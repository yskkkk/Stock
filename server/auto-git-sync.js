/**
 * 서버 프로세스 안에서 주기적으로 원격과 HEAD를 비교하고,
 * 원격이 앞서 있으면 `git pull --ff-only` 후 의존성·전체 빌드를 갱신하고 같은 Node 명령으로 재시작합니다.
 *
 * 켜기: 환경변수 `AUTO_GIT_SYNC=1` (또는 true/yes/on)
 *
 * pull 직후 (Vite `npm run dev` 통합 서버가 아닐 때):
 *   1) `package.json` / lock 변경 시에만 `npm ci` 또는 `npm install`
 *   2) `npm run build` (verify + tsc + Vite 번들)
 * Vite dev(`registerViteIntegratedRestart`)에서는 esbuild.exe 잠금(EPERM) 방지를 위해 npm·build 생략 후 `server.restart()`만.
 *
 * 선택:
 *   AUTO_GIT_SYNC_INTERVAL_MS — 기본 60000 (1분), 최소 10000
 *   AUTO_GIT_REMOTE — 기본 origin
 *   AUTO_GIT_BRANCH — 비우면 현재 체크아웃 브랜치명 사용
 *   AUTO_GIT_STASH_BEFORE_PULL=1 — pull 전에 로컬 변경이 있으면 `git stash push` 후 pull, 성공 시 `stash pop` (pop 충돌 시 수동 처리)
 *   AUTO_GIT_POST_PULL_CMD — pull 이후 추가 셸. 실패 시 기본은 재시작 진행(경고). `AUTO_GIT_RESTART_ONLY_IF_BUILD_OK=1`이면 빌드·후크 실패 시 재시작 안 함
 *   AUTO_GIT_SKIP_NPM_REFRESH=1 — 긴급 시에만: npm ci/install·build 생략하고 바로 재시작
 *
 * pull 성공 후에는 npm ci/install·build가 실패해도 서버는 재시작합니다(로그에 경고만 남김).
 * 예전 동작(빌드·후크까지 성공해야만 재시작): `AUTO_GIT_RESTART_ONLY_IF_BUILD_OK=1`
 * 미커밋 변경·fast-forward 불가면 `git pull --ff-only`가 실패하고 재시작하지 않습니다.
 *
 * 재시작은 `server/restart-node-process.js`의 `respawnNodeProcess`를 사용합니다.
 * 장기 SSE 등으로 `httpServer.close()`가 멈추면 재시작을 중단하고 서버·auto-git 폴링을 유지합니다.
 * (닫기 상한: `RESPAWN_CLOSE_TIMEOUT_MS`, 기본 25000)
 */
import { existsSync } from "node:fs";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendServerEventLog } from "./access-log.js";
import { formatLogTimestampKst } from "./log-kst.js";
import { summarizeGitPullRangeForNotify } from "./ops-agent-git-push.js";
import { notifyOpsAutoGitPulled } from "./ops-dev-git-telegram.js";
import {
  isViteIntegratedRestartActive,
  restartNodeOrViteDev,
  respawnNodeProcess,
} from "./restart-node-process.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const PAUSE_FILE = path.join(repoRoot, ".auto-git-sync.pause");

function truthy(v) {
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function execGitOut(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function execGitQuiet(args) {
  execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
}

function execGitInherit(args) {
  execFileSync("git", args, { cwd: repoRoot, stdio: "inherit" });
}

/** @param {string} remoteRef */
function commitsBehindRemote(remoteRef) {
  try {
    const n = Number(
      execGitOut(["rev-list", "--count", `HEAD..${remoteRef}`]),
    );
    return Number.isFinite(n) && n > 0;
  } catch {
    return false;
  }
}

function npmShell() {
  return process.platform === "win32";
}

/** @returns {boolean} */
function runNpmInstallRefresh() {
  const shell = npmShell();
  const lockPath = path.join(repoRoot, "package-lock.json");
  if (existsSync(lockPath)) {
    const ci = spawnSync("npm", ["ci"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell,
    });
    if (ci.status === 0) return true;
    appendServerEventLog(
      "auto-git",
      "npm ci failed, falling back to npm install",
      "warn",
    );
  }
  const inst = spawnSync("npm", ["install"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell,
  });
  return inst.status === 0;
}

/** @returns {boolean} */
function runNpmBuild() {
  const r = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: npmShell(),
  });
  return r.status === 0;
}

/** @param {string} baseRev pull 직전 HEAD */
function packageManifestChangedSince(baseRev) {
  try {
    const names = execGitOut([
      "diff",
      "--name-only",
      baseRev,
      "HEAD",
      "--",
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
    ]);
    return Boolean(names.trim());
  } catch {
    return true;
  }
}

/**
 * @param {{ httpServer: import("http").Server }} opts
 */
export function startAutoGitSync({ httpServer }) {
  if (!truthy(process.env.AUTO_GIT_SYNC)) return;

  if (!httpServer || typeof httpServer.close !== "function") {
    appendServerEventLog("auto-git", "invalid http server, skip", "warn");
    return;
  }

  const intervalMs = Math.max(
    10_000,
    Number(process.env.AUTO_GIT_SYNC_INTERVAL_MS) || 60_000,
  );
  const remote = String(process.env.AUTO_GIT_REMOTE || "origin").trim() || "origin";
  const branchFromEnv = String(process.env.AUTO_GIT_BRANCH || "").trim();

  let timer = null;
  let stopping = false;
  let tickBusy = false;

  const tick = async () => {
    if (stopping) return;
    if (tickBusy) return;
    tickBusy = true;
    try {
      try {
        execGitOut(["rev-parse", "--is-inside-work-tree"]);
      } catch {
        return;
      }

      let branch = branchFromEnv;
    if (!branch) {
      try {
        branch = execGitOut(["rev-parse", "--abbrev-ref", "HEAD"]);
      } catch {
        return;
      }
    }

    const remoteRef = `${remote}/${branch}`;

    if (existsSync(PAUSE_FILE)) {
      return;
    }

    try {
      execGitQuiet(["fetch", remote, branch]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendServerEventLog(
        "auto-git",
        `fetch ${remote} ${branch} failed: ${msg}`,
        "warn",
      );
      return;
    }

    let localRev;
    let remoteRev;
    try {
      localRev = execGitOut(["rev-parse", "HEAD"]);
      remoteRev = execGitOut(["rev-parse", remoteRef]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendServerEventLog(
        "auto-git",
        `cannot compare to ${remoteRef}: ${msg}`,
        "warn",
      );
      return;
    }

    if (localRev === remoteRev) {
      return;
    }

    if (!commitsBehindRemote(remoteRef)) {
      return;
    }

    appendServerEventLog(
      "auto-git",
      `${formatLogTimestampKst()} ${remoteRef} ahead of HEAD → pull --ff-only`,
    );

    let stashed = false;
    if (truthy(process.env.AUTO_GIT_STASH_BEFORE_PULL)) {
      const dirty = execGitOut(["status", "--porcelain"]);
      if (dirty) {
        appendServerEventLog(
          "auto-git",
          "stashing local changes before pull…",
        );
        try {
          execGitQuiet(["stash", "push", "-m", "auto-git-sync pre-pull"]);
          stashed = true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          appendServerEventLog("auto-git", `stash failed: ${msg}`, "error");
          return;
        }
      }
    }

    try {
      execGitQuiet(["pull", "--ff-only", remote, branch]);
      appendServerEventLog("auto-git", `pulled ${remote} ${branch}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendServerEventLog("auto-git", `pull failed: ${msg}`, "error");
      if (stashed) {
        try {
          execGitQuiet(["stash", "pop"]);
        } catch {
          appendServerEventLog(
            "auto-git",
            "pull failed and stash pop also failed — check repo manually",
            "error",
          );
        }
      }
      return;
    }

    if (stashed) {
      try {
        appendServerEventLog(
          "auto-git",
          "pull OK — restoring stashed local changes (stash pop)…",
        );
        execGitQuiet(["stash", "pop"]);
        appendServerEventLog("auto-git", "restored stashed changes after pull");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        appendServerEventLog(
          "auto-git",
          `stash pop failed after pull (resolve conflicts manually): ${msg}`,
          "error",
        );
      }
    }

    appendServerEventLog("auto-git", "git pull --ff-only completed OK");

    let headAfterPull = localRev;
    try {
      headAfterPull = execGitOut(["rev-parse", "HEAD"]);
    } catch {
      /* ignore */
    }
    notifyOpsAutoGitPulled({
      remote,
      branch,
      newRev: headAfterPull,
      gitSummary: summarizeGitPullRangeForNotify(localRev, headAfterPull),
    });

    const restartOnlyIfBuildOk = truthy(
      process.env.AUTO_GIT_RESTART_ONLY_IF_BUILD_OK,
    );
    const viteDev = isViteIntegratedRestartActive();
    const depsChanged = packageManifestChangedSince(localRev);

    if (viteDev) {
      appendServerEventLog(
        "auto-git",
        "Vite dev — skipping npm ci/install/build (esbuild in use, EPERM 방지)",
      );
    } else if (!truthy(process.env.AUTO_GIT_SKIP_NPM_REFRESH)) {
      if (depsChanged) {
        appendServerEventLog(
          "auto-git",
          "refreshing dependencies (npm ci / npm install)…",
        );
        if (!runNpmInstallRefresh()) {
          appendServerEventLog(
            "auto-git",
            "npm install refresh failed — will still restart after pull",
            "warn",
          );
          if (restartOnlyIfBuildOk) return;
        }
      } else {
        appendServerEventLog(
          "auto-git",
          "package.json/lock unchanged — skipping npm ci/install",
        );
      }
      appendServerEventLog("auto-git", "npm run build (verify + tsc + Vite)…");
      if (!runNpmBuild()) {
        appendServerEventLog(
          "auto-git",
          "npm run build failed — will still restart after pull",
          "warn",
        );
        if (restartOnlyIfBuildOk) return;
      }
    } else {
      appendServerEventLog(
        "auto-git",
        "AUTO_GIT_SKIP_NPM_REFRESH=1 — skipping npm ci/install and build",
        "warn",
      );
    }

    // AUTO_GIT_POST_PULL_CMD is a trusted operator-controlled env var (e.g., "npm run build").
    // Do not source this value from user input.
    const hook = String(process.env.AUTO_GIT_POST_PULL_CMD || "").trim();
    if (hook) {
      try {
        execSync(hook, { cwd: repoRoot, stdio: "inherit" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        appendServerEventLog(
          "auto-git",
          `AUTO_GIT_POST_PULL_CMD failed: ${msg}`,
          "error",
        );
        if (restartOnlyIfBuildOk) return;
        appendServerEventLog(
          "auto-git",
          "post-pull hook failed — continuing to restart after pull",
          "warn",
        );
      }
    }

    stopping = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    appendServerEventLog("auto-git", "restarting dev server…");

    const restarted = (await restartNodeOrViteDev(httpServer))
      ? true
      : await respawnNodeProcess(httpServer);
    if (!restarted) {
      appendServerEventLog(
        "auto-git",
        "재시작이 완료되지 않았습니다. 서버는 계속 동작하며 auto-git 폴링을 재개합니다.",
        "warn",
      );
      stopping = false;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (typeof timer.unref === "function") timer.unref();
    }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendServerEventLog("auto-git", `tick error: ${msg}`, "error");
    } finally {
      tickBusy = false;
    }
  };

  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  appendServerEventLog(
    "auto-git",
    `enabled · every ${intervalMs / 1000}s · tracking ${remote}/${
      branchFromEnv || "(current branch)"
    } · on update: pull → npm ci/install → npm run build → restart`,
  );
}
