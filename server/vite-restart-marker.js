/**
 * Vite `server.restart()` 구간 — dev:guard가 프로세스 종료·헬스 실패로 오탐 재기동하지 않게.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARKER = path.join(__dirname, ".data", ".vite-restarting");

function ensureDir() {
  const dir = path.dirname(MARKER);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function markViteRestartStarting() {
  try {
    ensureDir();
    fs.writeFileSync(MARKER, String(Date.now()), "utf8");
  } catch {
    /* ignore */
  }
}

export function clearViteRestartMarker() {
  try {
    if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER);
  } catch {
    /* ignore */
  }
}

/**
 * @param {number} [maxAgeMs]
 */
export function isViteRestartRecent(maxAgeMs = 120_000) {
  try {
    if (!fs.existsSync(MARKER)) return false;
    const t = Number(fs.readFileSync(MARKER, "utf8").trim());
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < maxAgeMs;
  } catch {
    return false;
  }
}
