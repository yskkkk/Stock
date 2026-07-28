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
 *   AUTO_GIT_STASH_BEFORE_PULL=1 — pull 전에 로컬 변경이 있으면 `git stash push` 후 pull, 성공 시 `stash apply`+`drop` (충돌 시 stash 유지·수동 처리)
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
import {
  notifyOpsAutoGitFailed,
  notifyOpsAutoGitPulled,
} from "./ops-dev-git-telegram.js";
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

/** @param {string[]} args @returns {{ ok: true } | { ok: false; message: string; stderr: string }} */
function execGitTry(args) {
  try {
    execFileSync("git", args, {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
    return { ok: true };
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException & { stderr?: Buffer | string }} */ (
      e
    );
    const stderr =
      err.stderr != null ? String(err.stderr).trim() : "";
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message, stderr };
  }
}

function gitErrorDetail(result) {
  return [result.stderr, result.message].filter(Boolean).join(" — ");
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gitDirPath() {
  return path.join(repoRoot, ".git");
}

/** @returns {string | null} */
function gitOperationInProgressLabel() {
  const gitDir = gitDirPath();
  if (existsSync(path.join(gitDir, "MERGE_HEAD"))) return "merge";
  if (existsSync(path.join(gitDir, "REBASE_HEAD"))) return "rebase";
  if (existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"))) return "cherry-pick";
  if (
    existsSync(path.join(gitDir, "rebase-merge")) ||
    existsSync(path.join(gitDir, "rebase-apply"))
  ) {
    return "rebase";
  }
  return null;
}

/**
 * @param {string} porcelain
 */
function parsePorcelainStatus(porcelain) {
  const lines = porcelain.split("\n").filter(Boolean);
  /** @type {string[]} */
  const conflicts = [];
  /** @type {string[]} */
  const trackedDirty = [];
  /** @type {string[]} */
  const untracked = [];
  for (const line of lines) {
    const xy = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (/^(UU|AA|DD|AU|UA|DU|UD)/.test(xy)) {
      conflicts.push(file);
    } else if (xy === "??") {
      untracked.push(file);
    } else {
      trackedDirty.push(file);
    }
  }
  return { conflicts, trackedDirty, untracked, lines };
}

function isTransientGitLockError(detail) {
  return /index\.lock|locked by another|cannot lock ref|permission denied/i.test(
    detail,
  );
}

function isNoLocalChangesToStash(detail) {
  return /no local changes to save/i.test(detail);
}

function isUnmergedStashError(detail) {
  return /needs merge|unmerged|merge conflict|cannot stash/i.test(detail);
}

/**
 * @param {string} fromRev
 * @param {string} toRev
 * @returns {string[]}
 */
function listFilesChangedBetweenRevs(fromRev, toRev) {
  try {
    return execGitOut(["diff", "--name-only", fromRev, toRev])
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * pull로 바뀔 파일과 로컬 수정 파일이 겹치면 stash→pull→apply 충돌이 잦다.
 * @param {string} remoteRef
 * @param {string[]} trackedDirty
 * @returns {string[]}
 */
function remotePullOverlapsDirtyFiles(remoteRef, trackedDirty) {
  if (!trackedDirty.length) return [];
  const pullFiles = listFilesChangedBetweenRevs("HEAD", remoteRef);
  if (!pullFiles.length) return [];
  const dirtySet = new Set(trackedDirty);
  return pullFiles.filter((f) => dirtySet.has(f));
}

/** @returns {string} */
function describeGitWorktree() {
  try {
    const branch = execGitOut(["rev-parse", "--abbrev-ref", "HEAD"]);
    const op = gitOperationInProgressLabel();
    const porcelain = execGitOut(["status", "--porcelain"]);
    const { conflicts, trackedDirty, untracked } =
      parsePorcelainStatus(porcelain);
    const parts = [`branch=${branch}`];
    if (op) parts.push(`${op}=in-progress`);
    if (conflicts.length) {
      parts.push(`conflicts=${conflicts.join(", ")}`);
    } else if (trackedDirty.length) {
      parts.push(`dirty=${trackedDirty.length} tracked`);
    }
    if (untracked.length) {
      parts.push(`untracked=${untracked.length}`);
    }
    return parts.join(" · ");
  } catch {
    return "(git status unavailable)";
  }
}

/**
 * @returns {Promise<{ ok: true; stashed: boolean } | { ok: false; detail: string; blocking?: boolean }>}
 */
async function gitStashBeforePullWithRetry() {
  const porcelain = execGitOut(["status", "--porcelain"]);
  if (!porcelain) {
    return { ok: true, stashed: false };
  }

  const op = gitOperationInProgressLabel();
  if (op) {
    return {
      ok: false,
      detail: `${op} in progress — resolve or abort before auto-git pull`,
      blocking: true,
    };
  }

  const { conflicts, trackedDirty, untracked } = parsePorcelainStatus(porcelain);
  if (conflicts.length) {
    return {
      ok: false,
      detail: `unmerged paths: ${conflicts.join(", ")}`,
      blocking: true,
    };
  }

  if (!trackedDirty.length) {
    if (untracked.length) {
      appendServerEventLog(
        "auto-git",
        `untracked-only dirty (${untracked.length} files) — skip stash, ff-only pull`,
      );
    }
    return { ok: true, stashed: false };
  }

  const maxAttempts = 3;
  const baseDelayMs = 1000;
  /** @type {{ message: string; stderr: string } | null} */
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = execGitTry(["stash", "push", "-m", "auto-git-sync pre-pull"]);
    if (result.ok) {
      if (attempt > 1) {
        appendServerEventLog(
          "auto-git",
          `stash OK (attempt ${attempt}/${maxAttempts})`,
        );
      }
      return { ok: true, stashed: true };
    }

    const detail = gitErrorDetail(result);
    lastErr = result;

    if (isNoLocalChangesToStash(detail)) {
      return { ok: true, stashed: false };
    }
    if (isUnmergedStashError(detail)) {
      return { ok: false, detail, blocking: true };
    }

    if (attempt < maxAttempts && isTransientGitLockError(detail)) {
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      appendServerEventLog(
        "auto-git",
        `stash failed (attempt ${attempt}/${maxAttempts}): ${detail} — retry in ${delayMs / 1000}s`,
        "warn",
      );
      await sleepMs(delayMs);
      continue;
    }
    break;
  }

  const detail = gitErrorDetail(
    /** @type {{ message: string; stderr: string }} */ (lastErr),
  );
  return { ok: false, detail };
}

/**
 * @param {string} remote
 * @param {string} branch
 * @returns {Promise<{ ok: true } | { ok: false; detail: string }>}
 */
async function gitPullFfOnlyWithRetry(remote, branch) {
  const maxAttempts = 3;
  const baseDelayMs = 2000;
  /** @type {{ message: string; stderr: string } | null} */
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = execGitTry(["pull", "--ff-only", remote, branch]);
    if (result.ok) {
      if (attempt > 1) {
        appendServerEventLog(
          "auto-git",
          `pull ${remote} ${branch} OK (attempt ${attempt}/${maxAttempts})`,
        );
      }
      return { ok: true };
    }
    lastErr = result;
    const detail = gitErrorDetail(result);
    if (attempt < maxAttempts && isTransientGitLockError(detail)) {
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      appendServerEventLog(
        "auto-git",
        `pull ${remote} ${branch} failed (attempt ${attempt}/${maxAttempts}): ${detail} — retry in ${delayMs / 1000}s`,
        "warn",
      );
      await sleepMs(delayMs);
      continue;
    }
    break;
  }
  return {
    ok: false,
    detail: gitErrorDetail(
      /** @type {{ message: string; stderr: string }} */ (lastErr),
    ),
  };
}

function isStashApply3wayUnsupported(detail) {
  return /--3way.*unknown|unknown option.*3way|unrecognized.*3way/i.test(
    detail,
  );
}

/**
 * stash 복원. apply(--3way)→drop 으로 pop 대신 stash 유지·수동 복구 가능.
 * @param {{ context: "after-pull" | "after-pull-failed" }} opts
 * @returns {boolean}
 */
function restoreStashedChanges(opts) {
  const { context } = opts;
  const label =
    context === "after-pull"
      ? "pull OK — restoring stashed local changes (stash apply --3way)…"
      : "pull failed — restoring stashed local changes (stash apply --3way)…";
  appendServerEventLog("auto-git", label);

  let apply = execGitTry(["stash", "apply", "--3way"]);
  if (
    !apply.ok &&
    isStashApply3wayUnsupported(gitErrorDetail(apply))
  ) {
    apply = execGitTry(["stash", "apply"]);
  }
  if (!apply.ok) {
    const detail = gitErrorDetail(apply);
    const prefix =
      context === "after-pull"
        ? "stash apply failed after pull (resolve conflicts manually)"
        : "pull failed and stash apply also failed";
    appendServerEventLog("auto-git", `${prefix}: ${detail}`, "error");
    appendServerEventLog("auto-git", `worktree: ${describeGitWorktree()}`, "error");
    appendServerEventLog(
      "auto-git",
      "stash kept — resolve conflicts then run git stash drop",
      "error",
    );
    return false;
  }
  const drop = execGitTry(["stash", "drop"]);
  if (!drop.ok) {
    appendServerEventLog(
      "auto-git",
      `stash apply OK but drop failed: ${gitErrorDetail(drop)}`,
      "warn",
    );
  }
  appendServerEventLog("auto-git", "restored stashed changes");
  return true;
}

/**
 * @param {string} remote
 * @param {string} branch
 * @returns {Promise<boolean>}
 */
async function gitFetchWithRetry(remote, branch) {
  const maxAttempts = 3;
  const baseDelayMs = 2000;
  /** @type {{ ok: false; message: string; stderr: string } | null} */
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = execGitTry(["fetch", remote, branch]);
    if (result.ok) {
      if (attempt > 1) {
        appendServerEventLog(
          "auto-git",
          `fetch ${remote} ${branch} OK (attempt ${attempt}/${maxAttempts})`,
        );
      }
      return true;
    }
    lastErr = result;
    const detail = gitErrorDetail(result);
    if (attempt < maxAttempts) {
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      appendServerEventLog(
        "auto-git",
        `fetch ${remote} ${branch} failed (attempt ${attempt}/${maxAttempts}): ${detail} — retry in ${delayMs / 1000}s`,
        "warn",
      );
      await sleepMs(delayMs);
    }
  }
  const detail = gitErrorDetail(/** @type {{ message: string; stderr: string }} */ (lastErr));
  appendServerEventLog(
    "auto-git",
    `fetch ${remote} ${branch} failed after ${maxAttempts} attempts: ${detail}`,
    "error",
  );
  notifyOpsAutoGitFailed({
    phase: `fetch ${remote}/${branch}`,
    detail: describeGitWorktree(),
    errorText: detail,
  });
  return false;
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

    if (branch === "HEAD") {
      appendServerEventLog(
        "auto-git",
        "detached HEAD — skip pull (checkout a branch first)",
        "warn",
      );
      return;
    }

    const remoteRef = `${remote}/${branch}`;

    if (existsSync(PAUSE_FILE)) {
      return;
    }

    const fetched = await gitFetchWithRetry(remote, branch);
    if (!fetched) {
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

    const opInProgress = gitOperationInProgressLabel();
    if (opInProgress) {
      appendServerEventLog(
        "auto-git",
        `${opInProgress} in progress — skip pull (resolve or abort first) · ${describeGitWorktree()}`,
        "warn",
      );
      return;
    }

    const prePullPorcelain = execGitOut(["status", "--porcelain"]);
    const { conflicts: prePullConflicts } = parsePorcelainStatus(prePullPorcelain);
    if (prePullConflicts.length) {
      appendServerEventLog(
        "auto-git",
        `unmerged paths — skip pull: ${prePullConflicts.join(", ")} · ${describeGitWorktree()}`,
        "warn",
      );
      return;
    }

    let stashed = false;
    if (truthy(process.env.AUTO_GIT_STASH_BEFORE_PULL)) {
      if (prePullPorcelain) {
        const { trackedDirty } = parsePorcelainStatus(prePullPorcelain);
        if (trackedDirty.length) {
          const overlapping = remotePullOverlapsDirtyFiles(remoteRef, trackedDirty);
          if (overlapping.length) {
            const detail = `remote ${remoteRef} touches locally modified files — skip pull to avoid stash conflict: ${overlapping.join(", ")} · ${describeGitWorktree()}`;
            appendServerEventLog("auto-git", detail, "warn");
            notifyOpsAutoGitFailed({
              phase: `pull ${remote}/${branch} blocked (local/remote overlap)`,
              detail: describeGitWorktree(),
              errorText: overlapping.join(", "),
            });
            return;
          }
          appendServerEventLog(
            "auto-git",
            "stashing local changes before pull…",
          );
        }
        const stashResult = await gitStashBeforePullWithRetry();
        if (!stashResult.ok) {
          appendServerEventLog(
            "auto-git",
            `stash failed: ${stashResult.detail}`,
            "error",
          );
          appendServerEventLog("auto-git", `worktree: ${describeGitWorktree()}`, "error");
          notifyOpsAutoGitFailed({
            phase: `stash before pull ${remote}/${branch}`,
            detail: describeGitWorktree(),
            errorText: stashResult.detail,
          });
          return;
        }
        stashed = stashResult.stashed;
        if (stashed) {
          appendServerEventLog("auto-git", "stashed local changes before pull");
        }
      }
    }

    const pullResult = await gitPullFfOnlyWithRetry(remote, branch);
    if (!pullResult.ok) {
      appendServerEventLog("auto-git", `pull failed: ${pullResult.detail}`, "error");
      appendServerEventLog("auto-git", `worktree: ${describeGitWorktree()}`, "error");
      if (stashed) {
        const restored = restoreStashedChanges({ context: "after-pull-failed" });
        if (!restored) {
          notifyOpsAutoGitFailed({
            phase: `stash restore after failed pull ${remote}/${branch}`,
            detail: describeGitWorktree(),
            errorText:
              "pull failed and stash apply also failed — resolve conflicts manually (stash kept)",
          });
        }
      }
      notifyOpsAutoGitFailed({
        phase: `pull ${remote}/${branch}`,
        detail: describeGitWorktree(),
        errorText: pullResult.detail,
      });
      return;
    }
    appendServerEventLog("auto-git", `pulled ${remote} ${branch}`);

    if (stashed) {
      const restored = restoreStashedChanges({ context: "after-pull" });
      if (!restored) {
        notifyOpsAutoGitFailed({
          phase: `stash restore after pull ${remote}/${branch}`,
          detail: describeGitWorktree(),
          errorText:
            "stash apply failed after pull — resolve conflicts manually (stash kept)",
        });
        return;
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
        void tick().catch((e) => {
          appendServerEventLog(
            "auto-git",
            `tick error: ${e instanceof Error ? e.message : String(e)}`,
            "error",
          );
        });
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
    void tick().catch((e) => {
      appendServerEventLog(
        "auto-git",
        `tick error: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  appendServerEventLog(
    "auto-git",
    `enabled · every ${intervalMs / 1000}s · tracking ${remote}/${
      branchFromEnv || "(current branch)"
    } · on update: pull → npm ci/install → npm run build → restart`,
  );
}
