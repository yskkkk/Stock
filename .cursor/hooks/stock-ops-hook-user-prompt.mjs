/**
 * Cursor 훅 stdin·transcript(jsonl)에서 사용자 프롬프트 추출.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./stock-ops-queue-hook-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} text */
export function extractUserPromptText(text) {
  const t = String(text ?? "");
  if (!t.trim()) return "";
  if (t.includes("<system_notification>")) return "";
  if (/Briefly inform the user about the task result/i.test(t)) return "";
  const m = t.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (m) return m[1].trim();
  return t.trim();
}

/** @param {unknown} input */
export function hookUserPromptFromInput(input) {
  const o = input && typeof input === "object" ? input : {};
  const direct = extractUserPromptText(
    o.prompt ??
      o.user_message ??
      o.user_query ??
      o.text ??
      o.message ??
      "",
  );
  if (direct) return direct;

  const conv = o.conversation ?? o.messages;
  if (Array.isArray(conv)) {
    for (let i = conv.length - 1; i >= 0; i--) {
      const msg = conv[i];
      if (!msg || typeof msg !== "object") continue;
      if (msg.role !== "user" && msg.type !== "user") continue;
      const text =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((p) => p?.type === "text")
                .map((p) => String(p.text ?? ""))
                .join("\n")
            : "";
      const p = extractUserPromptText(text);
      if (p) return p;
    }
  }

  return "";
}

function resolveTranscriptRoot() {
  const fromEnv = String(process.env.STOCK_AGENT_TRANSCRIPTS_DIR ?? "").trim();
  if (fromEnv) return fromEnv;
  const cwd = path.resolve(repoRoot);
  const drive = cwd.charAt(0).toLowerCase();
  const tail = cwd.slice(3).replace(/\\/g, "-");
  const slug = tail ? `${drive}-${tail}` : drive;
  return path.join(os.homedir(), ".cursor", "projects", slug, "agent-transcripts");
}

/** @param {string} root */
function findNewestTranscriptFile(root) {
  if (!fs.existsSync(root)) return null;
  let best = null;
  let bestMtime = 0;
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
        if (ent.name === "subagents") continue;
        walk(full);
        continue;
      }
      if (!ent.name.endsWith(".jsonl")) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.mtimeMs >= bestMtime) {
        bestMtime = st.mtimeMs;
        best = full;
      }
    }
  }
  walk(root);
  return best;
}

/** transcript에 user 줄이 있으면 최신 프롬프트(훅 stdin에 prompt 없을 때) */
export function readLatestUserPromptFromTranscriptsSync() {
  const file = findNewestTranscriptFile(resolveTranscriptRoot());
  if (!file) return "";
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const lines = raw.split(/\n/).filter((l) => l.trim().length > 0);
  let latest = "";
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.role !== "user") continue;
    const parts = row?.message?.content;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part?.type !== "text") continue;
      const p = extractUserPromptText(String(part.text ?? ""));
      if (p) latest = p;
    }
  }
  return latest;
}
