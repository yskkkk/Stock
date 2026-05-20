/**
 * 서버 로그 전용 디렉터리 — 운영 JSON·큐 상태(server/.data)와 분리.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatLogTimestampKst, kstYmd } from "./log-kst.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {string} */
export const SERVER_LOG_DIR = path.join(__dirname, ".logs");

export function ensureServerLogDirSync() {
  if (!fs.existsSync(SERVER_LOG_DIR)) {
    fs.mkdirSync(SERVER_LOG_DIR, { recursive: true });
  }
}

/**
 * 일별 로그 파일 경로 (KST 자정 기준 전환).
 * @param {string} prefix 예: access, record-mode-activity
 */
/** 기록 모드 활동 JSONL — 일별이 아닌 단일 파일(조회 API가 끝에서 읽음) */
export const RECORD_MODE_ACTIVITY_LOG_FILE = path.join(
  SERVER_LOG_DIR,
  "record-mode-activity.log",
);

export function dailyServerLogPath(prefix) {
  const ymd = kstYmd();
  const safe = String(prefix ?? "server")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 48);
  return path.join(SERVER_LOG_DIR, `${safe}-${ymd}.log`);
}

const LEGACY_LOG_MIGRATE_MARKER = path.join(SERVER_LOG_DIR, ".legacy-data-logs-migrated");
const LEGACY_DATA_DIR = path.join(__dirname, ".data");

/**
 * 예전 server/.data/*.log → server/.logs/ (1회). 재시작해도 append만 하므로 로그는 유지됨.
 */
export function migrateLegacyServerLogsSync() {
  ensureServerLogDirSync();
  try {
    if (fs.existsSync(LEGACY_LOG_MIGRATE_MARKER)) return;
  } catch {
    return;
  }

  /** @param {string} legacyPath @param {string} targetPath @param {string} label */
  function appendLegacyFile(legacyPath, targetPath, label) {
    try {
      if (!fs.existsSync(legacyPath)) return;
      const content = fs.readFileSync(legacyPath, "utf8");
      if (!content.trim()) return;
      const header = `\n# migrated from ${label} at ${formatLogTimestampKst()}\n`;
      fs.appendFileSync(targetPath, header + content, "utf8");
    } catch {
      /* ignore */
    }
  }

  appendLegacyFile(
    path.join(LEGACY_DATA_DIR, "access.log"),
    dailyServerLogPath("access"),
    "server/.data/access.log",
  );
  appendLegacyFile(
    path.join(LEGACY_DATA_DIR, "ops-record-mode-activity.log"),
    RECORD_MODE_ACTIVITY_LOG_FILE,
    "server/.data/ops-record-mode-activity.log",
  );

  try {
    fs.writeFileSync(LEGACY_LOG_MIGRATE_MARKER, `${Date.now()}\n`, "utf8");
  } catch {
    /* ignore */
  }
}
