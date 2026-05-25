/**
 * JSON 스토어 — corrupt 읽기 거부, 원자 쓰기
 */
import fs from "node:fs";
import path from "node:path";
import { resolveServerDataDir } from "./data-path.js";

export class StoreCorruptError extends Error {
  /**
   * @param {string} filePath
   * @param {unknown} cause
   */
  constructor(filePath, cause) {
    const msg =
      cause instanceof Error ? cause.message : String(cause ?? "parse error");
    super(`데이터 파일을 읽을 수 없습니다: ${filePath} (${msg})`);
    this.name = "StoreCorruptError";
    this.code = "STORE_CORRUPT";
    this.filePath = filePath;
  }
}

/** @param {string} fileName */
export function dataFilePath(fileName) {
  return path.join(resolveServerDataDir(), fileName);
}

export function ensureDataDirSync() {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * @param {string} fileName
 * @param {(raw: unknown) => T} normalize
 * @param {() => T} empty
 * @returns {T}
 * @template T
 */
export function readJsonStoreSync(fileName, normalize, empty) {
  const file = dataFilePath(fileName);
  try {
    if (!fs.existsSync(file)) return empty();
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalize(raw);
  } catch (e) {
    if (fs.existsSync(file)) {
      const bak = `${file}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(file, bak);
      } catch {
        /* ignore */
      }
    }
    throw new StoreCorruptError(file, e);
  }
}

/**
 * @param {string} fileName
 * @param {unknown} data
 * @param {(data: unknown) => string} [serialize]
 */
export function writeJsonStoreSync(fileName, data, serialize) {
  ensureDataDirSync();
  const file = dataFilePath(fileName);
  const body = serialize ? serialize(data) : JSON.stringify(data, null, 0);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, file);
}
