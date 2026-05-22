import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OPS_IDE_QUEUE_REPO_ROOT = path.resolve(__dirname, "..");

/**
 * IDE 큐 차례가 왔을 때 에이전트에 넘길 워크스페이스 스냅샷 메모.
 * @param {{ leaseId: string; waitedMs: number; queueSeq: number }} p
 */
export function buildIdeQueueGrant(p) {
  let gitHead = "";
  let dirty = false;
  try {
    gitHead = execSync("git rev-parse HEAD", {
      cwd: OPS_IDE_QUEUE_REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* not a git repo */
  }
  try {
    const st = execSync("git status --porcelain", {
      cwd: OPS_IDE_QUEUE_REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    dirty = st.length > 0;
  } catch {
    /* ignore */
  }

  const waitedSec = Math.max(0, Math.round(p.waitedMs / 1000));
  const headNote = gitHead ? `HEAD \`${gitHead}\`` : "git HEAD 확인 불가";
  const dirtyNote = dirty ? " (로컬 미커밋 변경 있음)" : "";

  const contextNote =
    `【개발 단일 큐】 지금이 당신의 실행 차례입니다(대기열 #${p.queueSeq}, 대기 약 ${waitedSec}초). ` +
    `앞선 웹 에이전트·다른 IDE 요청이 반영된 **현재 워크스페이스** 기준으로 작업하세요. ` +
    `${headNote}${dirtyNote}. ` +
    `이전 대화·캐시에 남은 파일 내용을 그대로 믿지 말고, 수정·검토가 필요한 파일은 다시 읽은 뒤 진행하세요.`;

  return {
    leaseId: p.leaseId,
    queueSeq: p.queueSeq,
    waitedMs: p.waitedMs,
    gitHead: gitHead || null,
    workspaceDirty: dirty,
    contextNote,
  };
}
