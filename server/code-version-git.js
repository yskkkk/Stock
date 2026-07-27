/**
 * 코드 버전 스냅샷 — git commit SHA 기준
 * 롤백은 히스토리 강제 재작성 없이 해당 트리로 새 커밋을 만들어 복원
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

function gitOut(args) {
  return execFileSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitOk(args) {
  execFileSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** @returns {string} */
export function getCodeHeadSha() {
  try {
    return gitOut(["rev-parse", "HEAD"]);
  } catch {
    return "";
  }
}

/** @returns {string} */
export function getCodeHeadShort() {
  const h = getCodeHeadSha();
  return h ? h.slice(0, 10) : "";
}

/** @returns {string} */
export function getCodeBranch() {
  try {
    return gitOut(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    return "";
  }
}

/** @returns {{ dirty: boolean; summary: string }} */
export function getCodeWorktreeState() {
  try {
    const porcelain = gitOut(["status", "--porcelain"]);
    return {
      dirty: Boolean(porcelain.trim()),
      summary: porcelain.trim().slice(0, 500),
    };
  } catch {
    return { dirty: false, summary: "" };
  }
}

/**
 * 워킹트리가 더러우면 스냅샷 전 커밋 시도(선택)
 * @param {string} message
 * @returns {{ ok: boolean; head: string; committed: boolean; error?: string }}
 */
export function commitDirtyWorktreeIfNeeded(message) {
  const head = getCodeHeadSha();
  const { dirty } = getCodeWorktreeState();
  if (!dirty) return { ok: true, head, committed: false };
  try {
    gitOk(["add", "-A"]);
    const staged = gitOut(["diff", "--cached", "--name-only"]);
    if (!staged.trim()) return { ok: true, head: getCodeHeadSha(), committed: false };
    gitOk(["commit", "-m", message.slice(0, 200)]);
    return { ok: true, head: getCodeHeadSha(), committed: true };
  } catch (e) {
    return {
      ok: false,
      head: getCodeHeadSha() || head,
      committed: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 지정 커밋의 트리로 워킹트리를 맞춘 뒤 새 커밋·푸시
 * @param {string} commitSha
 * @param {string} message
 * @returns {{ ok: boolean; head?: string; error?: string }}
 */
export function restoreCodeTreeFromCommit(commitSha, message) {
  const sha = String(commitSha ?? "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return { ok: false, error: "잘못된 커밋 SHA 입니다." };
  }
  try {
    // 존재 확인
    gitOut(["cat-file", "-e", `${sha}^{commit}`]);
  } catch {
    return { ok: false, error: `커밋을 찾을 수 없습니다: ${sha.slice(0, 10)}` };
  }

  try {
    // 강제 리셋 대신 트리 복원 → 새 커밋 (히스토리 유지)
    gitOk(["restore", "--source", sha, "--worktree", "--staged", "."]);
    const staged = gitOut(["diff", "--cached", "--name-only"]);
    if (!staged.trim()) {
      return {
        ok: true,
        head: getCodeHeadSha(),
        error: undefined,
      };
    }
    gitOk(["commit", "-m", message.slice(0, 200)]);
    try {
      gitOk(["push"]);
    } catch (pushErr) {
      return {
        ok: false,
        head: getCodeHeadSha(),
        error: `복원 커밋은 됐지만 push 실패: ${
          pushErr instanceof Error ? pushErr.message : String(pushErr)
        }`,
      };
    }
    return { ok: true, head: getCodeHeadSha() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {string} tagName
 * @param {string} sha
 * @param {string} message
 */
export function tryCreateGitTag(tagName, sha, message) {
  const name = String(tagName ?? "")
    .trim()
    .replace(/[^\w./-]+/g, "-")
    .slice(0, 80);
  if (!name || !sha) return { ok: false };
  try {
    gitOk(["tag", "-a", name, "-m", message.slice(0, 200), sha]);
    return { ok: true, tag: name };
  } catch {
    return { ok: false };
  }
}
