/**
 * 서버 로그 전용 디렉터리 — 운영 JSON·큐 상태(server/.data)와 분리.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {string} */
export const SERVER_LOG_DIR = path.join(__dirname, ".logs");

export function ensureServerLogDirSync() {
  if (!fs.existsSync(SERVER_LOG_DIR)) {
    fs.mkdirSync(SERVER_LOG_DIR, { recursive: true });
  }
}

/**
 * 일별 로그 파일 경로 (로컬 날짜 기준 자정 전환).
 * @param {string} prefix 예: access, record-mode-activity
 */
/** 기록 모드 활동 JSONL — 일별이 아닌 단일 파일(조회 API가 끝에서 읽음) */
export const RECORD_MODE_ACTIVITY_LOG_FILE = path.join(
  SERVER_LOG_DIR,
  "record-mode-activity.log",
);

export function dailyServerLogPath(prefix) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const safe = String(prefix ?? "server")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 48);
  return path.join(SERVER_LOG_DIR, `${safe}-${y}-${m}-${day}.log`);
}
