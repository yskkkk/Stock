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

function logPhase(writeSse, message) {
  writeSse?.({ type: "phase", message });
  appendServerEventLog("ops-agent", message);
}

/**
 * @param {{ writeSse?: (obj: unknown) => void; runtime: "local" | "cloud" }} opts
 */
export function commitAndPushAfterOpsAgent(opts) {
  const { writeSse, runtime } = opts;

  const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]);

  if (runtime === "cloud") {
    logPhase(
      writeSse,
      "클라우드 에이전트 후처리: origin에서 최신을 가져와 로컬을 맞춥니다(git fetch + pull --ff-only)…",
    );
    gitQuiet(["fetch", "origin", branch]);
    try {
      gitInherit(["pull", "--ff-only", "origin", branch]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `클라우드 실행 후 로컬 동기화 실패(git pull --ff-only): ${msg}`,
      );
    }
    logPhase(
      writeSse,
      "로컬 저장소를 origin과 맞췄습니다. 원격 저장소 푸시는 에이전트가 GitHub에서 완료해야 합니다.",
    );
    return;
  }

  logPhase(
    writeSse,
    "운영 에이전트 후처리: 변경이 있으면 커밋한 뒤 origin으로 반드시 푸시합니다…",
  );

  const porcelain = gitOut(["status", "--porcelain"]);
  if (porcelain) {
    logPhase(writeSse, "변경 파일 스테이징(git add -A)…");
    gitInherit(["add", "-A"]);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const cmsg = `chore(ops): web Cursor agent (${stamp})`;
    logPhase(writeSse, `커밋: ${cmsg}`);
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

  logPhase(writeSse, `git push origin ${branch} …`);
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
  logPhase(writeSse, "원격(origin)으로 푸시를 완료했습니다.");
}
