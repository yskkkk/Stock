/**
 * IDE 턴 종료 — 코드 반영 없을 때 ops 텔레그램.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRepoHeadRev } from "./ops-agent-git-push.js";
import { opsIdePromptFingerprint } from "./ops-ide-prompt-match.js";
import {
  escHtml,
  isOpsTelegramNotifyEnabled,
  resolveOpsTelegramCreds,
  sendTelegramMessage,
} from "./telegram-notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TURN_STATE_PATH = path.join(REPO_ROOT, ".stock-chat-turn-state.json");

/** @param {string} rel */
function isTrackedCodePath(rel) {
  const norm = String(rel ?? "")
    .trim()
    .replace(/\\/g, "/");
  if (!norm) return false;
  if (
    norm.startsWith("server/.data/") ||
    norm.startsWith("server/.logs/") ||
    norm.startsWith(".cursor/") ||
    norm.startsWith("node_modules/") ||
    norm.startsWith("dist/") ||
    norm.startsWith("android/") ||
    norm.startsWith("ios/")
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
    norm.startsWith("tsconfig")
  );
}

function getCodeStatusSignature() {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const lines = out
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
export function loadChatTurnStateSync() {
  try {
    if (!fs.existsSync(TURN_STATE_PATH)) return null;
    const o = JSON.parse(fs.readFileSync(TURN_STATE_PATH, "utf8"));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown> | null} state
 */
export function isCodeReflectedInChatTurn(state) {
  if (!state) return false;
  if (state.hadCodeToolEdit) return true;
  const headNow = getRepoHeadRev();
  const headStart = String(state.gitHeadStart ?? "");
  if (headStart && headNow && headStart !== headNow) return true;
  const sigStart = String(state.codeSigStart ?? "");
  const sigNow = getCodeStatusSignature();
  return sigStart !== sigNow;
}

/**
 * 개발 완료 알림 생략 여부 — 동일 턴·무코드면 chat-no-code 훅만 사용.
 * @param {string | null | undefined} userRequest
 */
export function shouldSkipIdeCompletionForChatTurn(userRequest) {
  if (process.env.STOCK_CHAT_NO_CODE_TELEGRAM === "0") return false;
  const state = loadChatTurnStateSync();
  if (!state) return false;
  const req = opsIdePromptFingerprint(userRequest);
  const turnReq = opsIdePromptFingerprint(String(state.userRequest ?? ""));
  if (!req || !turnReq || req !== turnReq) return false;
  return !isCodeReflectedInChatTurn(state);
}

/**
 * @param {{ userRequest: string; sessionId?: string | null }} opts
 */
export async function sendChatNoCodeTelegram(opts) {
  if (process.env.STOCK_CHAT_NO_CODE_TELEGRAM === "0") return false;
  if (!isOpsTelegramNotifyEnabled()) return false;

  const userRequest = String(opts.userRequest ?? "").trim();
  if (!userRequest) return false;

  const state = loadChatTurnStateSync();
  if (state && isCodeReflectedInChatTurn(state)) return false;

  const sid = String(opts.sessionId ?? "").trim();
  const reqBlock =
    userRequest.length > 900
      ? `${userRequest.slice(0, 899)}…`
      : userRequest;

  const lines = [
    "<b>💬 코드 변경 없이 대화 종료</b>",
    "",
    escHtml(reqBlock),
  ];
  if (sid) {
    lines.push("", `<i>세션 ${escHtml(sid.slice(0, 12))}…</i>`);
  }

  const ok = await sendTelegramMessage(
    lines.join("\n"),
    undefined,
    resolveOpsTelegramCreds(),
  );
  if (ok) {
    console.info("[telegram:ops] chat ended without code changes");
  }
  return ok;
}
