/**
 * 파일 반영 큐 전용 — Cursor 에이전트 없이 JSON 페이로드만 디스크에 반영.
 * 페이로드: { "files": [ { "path": "src/…(저장소 상대)", "content": "…" } ] }
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FILE_DEV_REPO_ROOT = path.resolve(__dirname, "..");

const MAX_FILES = 32;
const MAX_FILE_BYTES = 600_000;

/** @param {unknown} x */
function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * @param {string} rawJson
 * @returns {{ rel: string; abs: string; content: string }[]}
 */
export function parseFileDevApplyPayload(rawJson) {
  const trimmed = String(rawJson ?? "").trim();
  if (!trimmed) throw new Error("반영할 JSON이 비어 있습니다.");
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("JSON 파싱에 실패했습니다.");
  }
  if (!isPlainObject(parsed)) throw new Error("최상위는 JSON 객체여야 합니다.");
  const files = parsed.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('`files` 배열이 필요합니다. 예: {"files":[{"path":"src/a.ts","content":"…"}]}');
  }
  if (files.length > MAX_FILES) {
    throw new Error(`한 번에 반영할 파일은 최대 ${MAX_FILES}개까지입니다.`);
  }

  const root = path.resolve(FILE_DEV_REPO_ROOT);
  const out = [];

  for (const f of files) {
    if (!isPlainObject(f)) throw new Error("files 항목은 객체여야 합니다.");
    let rel = String(f.path ?? "").trim().replace(/\\/g, "/");
    if (!rel || rel.startsWith("/") || rel.includes("..")) {
      throw new Error(`허용되지 않는 경로입니다: ${rel || "(비어 있음)"}`);
    }
    const abs = path.resolve(root, rel);
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (abs !== root && !abs.startsWith(rootWithSep)) {
      throw new Error(`저장소 루트 밖 경로입니다: ${rel}`);
    }
    const content = f.content != null ? String(f.content) : "";
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`파일 내용이 너무 큽니다(최대 ${MAX_FILE_BYTES}바이트): ${rel}`);
    }
    out.push({ rel, abs, content });
  }

  return out;
}

/**
 * @param {string} rawJson
 * @returns {{ written: number; paths: string[] }}
 */
export function applyFileDevPayload(rawJson) {
  const list = parseFileDevApplyPayload(rawJson);
  for (const { abs, content } of list) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return { written: list.length, paths: list.map((x) => x.rel) };
}
