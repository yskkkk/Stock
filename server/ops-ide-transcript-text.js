/**
 * Cursor IDE agent-transcripts(jsonl) — 턴( user 줄 ) 단위 요청·응답 추출.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  opsIdePromptFingerprint,
  opsIdePromptsMatch,
} from "./ops-ide-prompt-match.js";

function resolveTranscriptRoot() {
  const fromEnv = String(process.env.STOCK_AGENT_TRANSCRIPTS_DIR ?? "").trim();
  if (fromEnv) return fromEnv;
  const cwd = path.resolve(process.cwd());
  const drive = cwd.charAt(0).toLowerCase();
  const tail = cwd.slice(3).replace(/\\/g, "-");
  const slug = tail ? `${drive}-${tail}` : drive;
  return path.join(os.homedir(), ".cursor", "projects", slug, "agent-transcripts");
}

/** @param {string} text */
function extractUserPromptText(text) {
  const t = String(text ?? "");
  if (!t.trim()) return "";
  if (t.includes("<system_notification>")) return "";
  if (/Briefly inform the user about the task result/i.test(t)) return "";
  const m = t.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (m) return m[1].trim();
  return t.trim();
}

/** @param {string} text */
function isNotifyMetaAssistantText(text) {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (t.includes("<system_notification>")) return true;
  if (/Briefly inform the user about the task result/i.test(t)) return true;
  return false;
}

/** @param {unknown} row */
function extractUserPromptFromRow(row) {
  if (!row || typeof row !== "object") return "";
  const r = /** @type {{ role?: string; message?: { content?: unknown } }} */ (row);
  if (r.role !== "user") return "";
  const parts = r.message?.content;
  if (!Array.isArray(parts)) {
    return extractUserPromptText(String(r.message?.content ?? ""));
  }
  let latest = "";
  for (const part of parts) {
    if (part?.type !== "text") continue;
    const p = extractUserPromptText(String(part.text ?? ""));
    if (p) latest = p;
  }
  return latest;
}

/** @param {unknown} row */
function extractAssistantTextFromRow(row) {
  if (!row || typeof row !== "object") return "";
  const r = /** @type {{ role?: string; message?: { content?: unknown } }} */ (row);
  if (r.role !== "assistant") return "";
  const parts = r.message?.content;
  if (!Array.isArray(parts)) {
    const t = String(r.message?.content ?? "").trim();
    return isNotifyMetaAssistantText(t) ? "" : t;
  }
  const text = parts
    .filter((p) => p?.type === "text" && p?.text)
    .map((p) => String(p.text))
    .join("\n")
    .trim();
  return isNotifyMetaAssistantText(text) ? "" : text;
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
export function readTranscriptLines(filePath) {
  const fp = String(filePath ?? "").trim();
  if (!fp) return [];
  try {
    const raw = fs.readFileSync(fp, "utf8");
    return raw.split(/\n/).filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * @param {string[]} lines
 * @param {number} lineIndex
 * @returns {string}
 */
export function extractUserPromptAtLine(lines, lineIndex) {
  const idx = Number(lineIndex);
  if (!Array.isArray(lines) || !Number.isFinite(idx) || idx < 0 || idx >= lines.length) {
    return "";
  }
  try {
    return extractUserPromptFromRow(JSON.parse(lines[idx]));
  } catch {
    return "";
  }
}

/**
 * 해당 user 줄 다음 ~ 다음 user 줄 전까지 마지막 assistant 텍스트.
 * @param {string[]} lines
 * @param {number} userLineIndex
 * @returns {string}
 */
export function extractAssistantResponseForUserTurn(lines, userLineIndex) {
  const idx = Number(userLineIndex);
  if (!Array.isArray(lines) || !Number.isFinite(idx) || idx < 0 || idx >= lines.length) {
    return "";
  }
  let last = "";
  for (let i = idx + 1; i < lines.length; i++) {
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (row?.role === "user") break;
    if (row?.role !== "assistant") continue;
    const text = extractAssistantTextFromRow(row);
    if (text) last = text;
  }
  return last;
}

/**
 * @param {string[]} lines
 * @param {string | null | undefined} userRequest
 * @returns {number} lines 배열 인덱스, 없으면 -1
 */
export function findUserLineIndexForPrompt(lines, userRequest) {
  const fp = opsIdePromptFingerprint(userRequest);
  if (!fp || !Array.isArray(lines)) return -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const p = extractUserPromptAtLine(lines, i);
    if (!p) continue;
    if (opsIdePromptsMatch(p, userRequest)) return i;
  }
  return -1;
}

/**
 * @param {string} filePath
 * @param {string | null | undefined} userRequest
 * @param {number} [userLineIndex]
 * @returns {{ userRequest: string; agentResponse: string; userLineIndex: number }}
 */
export function readIdeTurnNotifyPair(filePath, userRequest, userLineIndex) {
  const lines = readTranscriptLines(filePath);
  let idx =
    typeof userLineIndex === "number" && userLineIndex >= 0 ? userLineIndex : -1;
  if (idx < 0 || !extractUserPromptAtLine(lines, idx)) {
    idx = findUserLineIndexForPrompt(lines, userRequest);
  }
  const reqAt =
    idx >= 0 ? extractUserPromptAtLine(lines, idx) : extractLastUserPromptFromLines(lines);
  const req = String(userRequest ?? "").trim() || reqAt;
  const agentResponse =
    idx >= 0
      ? extractAssistantResponseForUserTurn(lines, idx)
      : extractLastAssistantTextFromLines(lines);
  return {
    userRequest: req,
    agentResponse,
    userLineIndex: idx,
  };
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
export function extractLastUserPromptFromLines(lines) {
  let latest = "";
  for (let i = 0; i < lines.length; i++) {
    const p = extractUserPromptAtLine(lines, i);
    if (p) latest = p;
  }
  return latest;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function readUserPromptFromTranscriptFile(filePath) {
  const fp = String(filePath ?? "").trim();
  if (!fp) return "";
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const lines = raw.split(/\n/).filter((l) => l.trim().length > 0);
    return extractLastUserPromptFromLines(lines);
  } catch {
    return "";
  }
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
export function extractLastAssistantTextFromLines(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const text = extractAssistantTextFromRow(row);
    if (text) return text;
  }
  return "";
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function readAgentResponseFromTranscriptFile(filePath) {
  const fp = String(filePath ?? "").trim();
  if (!fp) return "";
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const lines = raw.split(/\n/).filter((l) => l.trim().length > 0);
    return extractLastAssistantTextFromLines(lines);
  } catch {
    return "";
  }
}

/**
 * @param {string | null | undefined} sessionId
 * @returns {string}
 */
export function readAgentResponseForIdeSession(sessionId) {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return "";
  const root = resolveTranscriptRoot();
  const direct = path.join(root, sid, `${sid}.jsonl`);
  if (fs.existsSync(direct)) {
    return readAgentResponseFromTranscriptFile(direct);
  }
  if (!fs.existsSync(root)) return "";
  /** @type {string | null} */
  let newest = null;
  let newestMtime = 0;
  /** @param {string} dir */
  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.name.endsWith(".jsonl")) continue;
      if (path.basename(ent.name, ".jsonl") !== sid) continue;
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs >= newestMtime) {
          newestMtime = st.mtimeMs;
          newest = full;
        }
      } catch {
        /* ignore */
      }
    }
  }
  walk(root);
  return newest ? readAgentResponseFromTranscriptFile(newest) : "";
}

/**
 * @param {string | null | undefined} sessionId
 * @returns {string}
 */
export function readUserPromptForIdeSession(sessionId) {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return "";
  const root = resolveTranscriptRoot();
  const direct = path.join(root, sid, `${sid}.jsonl`);
  if (fs.existsSync(direct)) {
    return readUserPromptFromTranscriptFile(direct);
  }
  if (!fs.existsSync(root)) return "";
  /** @type {string | null} */
  let newest = null;
  let newestMtime = 0;
  /** @param {string} dir */
  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.name.endsWith(".jsonl")) continue;
      if (path.basename(ent.name, ".jsonl") !== sid) continue;
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs >= newestMtime) {
          newestMtime = st.mtimeMs;
          newest = full;
        }
      } catch {
        /* ignore */
      }
    }
  }
  walk(root);
  return newest ? readUserPromptFromTranscriptFile(newest) : "";
}
