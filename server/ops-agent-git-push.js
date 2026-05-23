/**
 * 운영 탭 Cursor 에이전트 요청이 끝난 뒤 Git 후처리.
 * - local: 작업 트리가 있으면 add + commit 후 `git push` (매 요청마다 원격 반영 시도)
 * - cloud: 로컬 디스크를 `git fetch` + `pull --ff-only`로 origin에 맞춤 (원격 수정은 에이전트가 GitHub에서 수행)
 */
import { execFileSync } from "node:child_process";
import path from "path";
import { fileURLToPath } from "node:url";
import { appendServerEventLog } from "./access-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

/** @returns {string} */
export function getRepoHeadRev() {
  try {
    return gitOut(["rev-parse", "HEAD"]);
  } catch {
    return "";
  }
}

/**
 * @returns {{ head: string; dirty: boolean; ahead: number }}
 * ahead: @{u}..HEAD 커밋 수. upstream 없으면 status -sb [ahead N] 파싱.
 */
export function getRepoPushSyncState() {
  const head = getRepoHeadRev();
  let dirty = false;
  try {
    dirty = Boolean(gitOut(["status", "--porcelain"]).trim());
  } catch {
    /* ignore */
  }
  let ahead = 0;
  try {
    const n = Number(gitOut(["rev-list", "--count", "@{u}..HEAD"]));
    ahead = Number.isFinite(n) ? Math.max(0, n) : 0;
  } catch {
    try {
      const sb = gitOut(["status", "-sb"]);
      const m = sb.match(/\[ahead (\d+)\]/);
      ahead = m ? Number(m[1]) : 0;
    } catch {
      ahead = 0;
    }
  }
  return { head, dirty, ahead };
}

function gitOut(args) {
  return execFileSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitInherit(args) {
  execFileSync("git", args, { cwd: REPO, stdio: "inherit" });
}

function gitQuiet(args) {
  execFileSync("git", args, { cwd: REPO, stdio: "ignore" });
}

function logPhase(writeSse, message, requestIp) {
  writeSse?.({ type: "phase", message });
  appendServerEventLog("ops-agent", message, "info", requestIp);
}

/**
 * @param {{ writeSse?: (obj: unknown) => void; runtime: "local" | "cloud"; requestIp?: string }} opts
 * @returns {{ cloudPullOk: boolean | null }} cloud일 때만 true/false, local이면 null
 */
export function commitAndPushAfterOpsAgent(opts) {
  const { writeSse, runtime, requestIp: rip } = opts;
  const requestIp = String(rip ?? "").trim() || null;

  const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]);

  if (runtime === "cloud") {
    logPhase(
      writeSse,
      "클라우드 에이전트 후처리: origin에서 최신을 가져와 로컬을 맞춥니다(git fetch + pull --ff-only)…",
      requestIp,
    );
    gitQuiet(["fetch", "origin", branch]);
    let cloudPullOk = false;
    try {
      gitInherit(["pull", "--ff-only", "origin", branch]);
      cloudPullOk = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendServerEventLog(
        "ops-agent",
        `클라우드 실행 후 로컬 동기화 실패(git pull --ff-only): ${msg} — 에이전트 결과는 성공으로 처리`,
        "warn",
        requestIp,
      );
      logPhase(
        writeSse,
        "로컬 클론 자동 동기화(git pull --ff-only)에 실패했습니다. 수동으로 맞추거나 원격/PR에서 확인하세요. 에이전트 작업 자체는 계속 진행됩니다.",
        requestIp,
      );
    }
    if (cloudPullOk) {
      logPhase(
        writeSse,
        "로컬 저장소를 origin과 맞췄습니다. 원격 저장소 푸시는 에이전트가 GitHub에서 완료해야 합니다.",
        requestIp,
      );
    }
    return {
      cloudPullOk,
      committed: null,
      pushed: null,
      branch,
      gitSummary: summarizeGitReflectionForNotify("cloud"),
    };
  }

  logPhase(
    writeSse,
    "운영 에이전트 후처리: 변경이 있으면 커밋한 뒤 origin으로 반드시 푸시합니다…",
    requestIp,
  );

  const porcelain = gitOut(["status", "--porcelain"]);
  let committed = false;
  if (porcelain) {
    committed = true;
    logPhase(writeSse, "변경 파일 스테이징(git add -A)…", requestIp);
    gitInherit(["add", "-A"]);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const cmsg = `chore(ops): web Cursor agent (${stamp})`;
    logPhase(writeSse, `커밋: ${cmsg}`, requestIp);
    try {
      gitInherit(["commit", "-m", cmsg]);
    } catch {
      const still = gitOut(["status", "--porcelain"]);
      if (still) {
        throw new Error(
          "스테이징된 변경이 있는데 git commit에 실패했습니다. 충돌·훅을 확인하세요.",
        );
      }
    }
  }

  logPhase(writeSse, `git push origin ${branch} …`, requestIp);
  try {
    gitInherit(["push", "-u", "origin", branch]);
  } catch {
    try {
      gitInherit(["push"]);
    } catch (e2) {
      throw new Error(
        `git push 실패: ${e2 instanceof Error ? e2.message : String(e2)}`,
      );
    }
  }
  logPhase(writeSse, "원격(origin)으로 푸시를 완료했습니다.", requestIp);
  return {
    cloudPullOk: null,
    committed: Boolean(porcelain),
    pushed: true,
    branch,
    gitSummary: summarizeGitReflectionForNotify("local"),
  };
}

export {
  summarizeGitPullRangeForNotify,
  summarizeGitReflectionForNotify,
} from "./ops-git-reflect-narrative.js";
