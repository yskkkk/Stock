/**
 * IDE 턴 — 코드 반영 여부 추적 (stop/sessionEnd 알림용)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./stock-ops-queue-hook-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CHAT_TURN_STATE_PATH = path.join(repoRoot, ".stock-chat-turn-state.json");

const CODE_EDIT_TOOLS = new Set([
  "write",
  "strreplace",
  "search_replace",
  "editnotebook",
  "apply_patch",
  "delete",
]);

/** @param {string} rel */
export function isTrackedCodePath(rel) {
  const p = String(rel ?? "")
    .replace(/^["']|["']$/g, "")
    .trim()
    .replace(/\\/g, "/");
  if (!p || p.startsWith("??")) return false;
  const norm = p.replace(/^(?:\?\?|[ MADRCU!?]{1,3})\s+/, "").trim();
  if (!norm) return false;
  if (
    norm.startsWith("server/.data/") ||
    norm.startsWith("server/.logs/") ||
    norm.startsWith(".cursor/") ||
    norm.startsWith(".git/") ||
    norm.startsWith("node_modules/") ||
    norm.startsWith("dist/") ||
    norm.startsWith("android/") ||
    norm.startsWith("ios/") ||
    norm.endsWith(".png") ||
    norm.endsWith(".jpg")
  ) {
    return false;
  }
  return (
    norm.startsWith("src/") ||
    norm.startsWith("server/") ||
    norm.startsWith("scripts/") ||
    norm.startsWith("docs/") ||
    norm.startsWith("public/") ||
    norm === "package.json" ||
    norm.startsWith("package-lock.json") ||
    norm.startsWith("vite.config") ||
    norm.startsWith("tsconfig") ||
    norm.startsWith("capacitor.config")
  );
}

function gitOut(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function getGitHead() {
  try {
    return gitOut(["rev-parse", "HEAD"]);
  } catch {
    return "";
  }
}

export function getCodeStatusSignature() {
  try {
    const lines = gitOut(["status", "--porcelain"])
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => {
        const pathPart = l.replace(/^(?:\?\?|[ MADRCU!?]{1,3})\s+/, "").trim();
        return isTrackedCodePath(pathPart);
      });
    lines.sort();
    return lines.join("\n");
  } catch {
    return "";
  }
}

/** @returns {Record<string, unknown> | null} */
export function readTurnState() {
  try {
    if (!fs.existsSync(CHAT_TURN_STATE_PATH)) return null;
    const o = JSON.parse(fs.readFileSync(CHAT_TURN_STATE_PATH, "utf8"));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

/** @param {Record<string, unknown>} state */
export function writeTurnState(state) {
  fs.writeFileSync(CHAT_TURN_STATE_PATH, `${JSON.stringify(state, null, 0)}\n`, "utf8");
}

/**
 * @param {string | null} sessionId
 * @param {string} userRequest
 */
export function beginChatTurn(sessionId, userRequest) {
  const sid = String(sessionId ?? "").trim() || "no-session";
  const req = String(userRequest ?? "").trim();
  const prev = readTurnState();
  const sameSession = prev && String(prev.sessionId ?? "") === sid;
  const state = {
    sessionId: sid,
    userRequest: req || String(prev?.userRequest ?? ""),
    gitHeadStart: sameSession
      ? String(prev?.gitHeadStart ?? getGitHead())
      : getGitHead(),
    codeSigStart: sameSession
      ? String(prev?.codeSigStart ?? getCodeStatusSignature())
      : getCodeStatusSignature(),
    hadCodeToolEdit: sameSession ? Boolean(prev?.hadCodeToolEdit) : false,
    notified: false,
    startedAtMs: sameSession
      ? Number(prev?.startedAtMs) || Date.now()
      : Date.now(),
  };
  if (req) state.userRequest = req;
  writeTurnState(state);
}

/** @param {unknown} toolInput */
function pathFromToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  const o = /** @type {Record<string, unknown>} */ (toolInput);
  return String(o.path ?? o.file ?? o.target_notebook ?? "").trim();
}

/**
 * @param {string} toolName
 * @param {unknown} toolInput
 */
export function markCodeToolUse(toolName, toolInput) {
  const name = String(toolName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  const compact = name.replace(/_/g, "");
  const isEdit = [...CODE_EDIT_TOOLS].some(
    (t) => compact === t || compact.includes(t),
  );
  if (!isEdit) return;

  const pathStr = pathFromToolInput(toolInput);
  if (pathStr && !isTrackedCodePath(pathStr)) return;

  const state = readTurnState();
  if (!state) return;
  state.hadCodeToolEdit = true;
  writeTurnState(state);
}

/**
 * @returns {{ shouldNotify: boolean; userRequest: string; sessionId: string } | null}
 */
export function evaluateChatNoCodeEnd() {
  if (process.env.STOCK_CHAT_NO_CODE_TELEGRAM === "0") return null;

  const state = readTurnState();
  if (!state || state.notified) return null;

  const userRequest = String(state.userRequest ?? "").trim();
  if (!userRequest) return null;

  const headNow = getGitHead();
  const sigNow = getCodeStatusSignature();
  const headStart = String(state.gitHeadStart ?? "");
  const sigStart = String(state.codeSigStart ?? "");

  const codeReflected =
    Boolean(state.hadCodeToolEdit) ||
    (headStart && headNow && headStart !== headNow) ||
    sigStart !== sigNow;

  if (codeReflected) {
    state.notified = true;
    writeTurnState(state);
    return null;
  }

  state.notified = true;
  writeTurnState(state);

  return {
    shouldNotify: true,
    userRequest,
    sessionId: String(state.sessionId ?? ""),
  };
}

export function clearChatTurnState() {
  try {
    fs.unlinkSync(CHAT_TURN_STATE_PATH);
  } catch {
    /* ignore */
  }
}
