/**
 * Cursor IDE agent-transcripts(jsonl)에서 마지막 assistant 텍스트 추출.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveTranscriptRoot() {
  const fromEnv = String(process.env.STOCK_AGENT_TRANSCRIPTS_DIR ?? "").trim();
  if (fromEnv) return fromEnv;
  const cwd = path.resolve(process.cwd());
  const drive = cwd.charAt(0).toLowerCase();
  const tail = cwd.slice(3).replace(/\\/g, "-");
  const slug = tail ? `${drive}-${tail}` : drive;
  return path.join(os.homedir(), ".cursor", "projects", slug, "agent-transcripts");
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
    if (row?.role !== "assistant") continue;
    const parts = row?.message?.content;
    if (!Array.isArray(parts)) {
      const t = String(row?.message?.content ?? "").trim();
      if (t) return t;
      continue;
    }
    const text = parts
      .filter((p) => p?.type === "text" && p?.text)
      .map((p) => String(p.text))
      .join("\n")
      .trim();
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
