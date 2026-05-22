import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");

export const IDE_LEASE_FILE = ".stock-ops-ide-lease.json";
export const IDE_LEASE_PATH = path.join(repoRoot, IDE_LEASE_FILE);
export const IDE_TURN_RULE_PATH = path.join(
  repoRoot,
  ".cursor",
  "rules",
  ".stock-ide-queue-turn.mdc",
);

/** @returns {string[]} */
export function devQueueApiBases() {
  const fromEnv = String(process.env.STOCK_DEV_QUEUE_API ?? "").trim();
  const bases = [];
  if (fromEnv) bases.push(fromEnv.replace(/\/$/, ""));
  bases.push(
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3456",
  );
  return [...new Set(bases)];
}

/**
 * @param {string} pathname
 * @param {RequestInit} init
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function postDevQueueApi(pathname, init, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 46 * 60 * 1000;
  let lastErr = null;
  for (const base of devQueueApiBases()) {
    try {
      const res = await fetch(`${base}${pathname}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) continue;
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("개발 큐 API 서버에 연결할 수 없습니다. npm run dev 를 실행하세요.");
}

/** @param {Record<string, unknown>} lease */
export function writeIdeLeaseFile(lease) {
  fs.writeFileSync(IDE_LEASE_PATH, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
}

export function readIdeLeaseFile() {
  try {
    if (!fs.existsSync(IDE_LEASE_PATH)) return null;
    return JSON.parse(fs.readFileSync(IDE_LEASE_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function clearIdeLeaseFile() {
  try {
    fs.unlinkSync(IDE_LEASE_PATH);
  } catch {
    /* ignore */
  }
}

/** @param {string} contextNote */
export function writeIdeTurnRule(contextNote) {
  const note = String(contextNote ?? "").trim();
  if (!note) return;
  const body =
    `---\nalwaysApply: true\n---\n\n` +
    `${note}\n\n` +
    `(자동 생성 — \`stop\`·세션 종료 시 삭제됩니다.)\n`;
  fs.mkdirSync(path.dirname(IDE_TURN_RULE_PATH), { recursive: true });
  fs.writeFileSync(IDE_TURN_RULE_PATH, body, "utf8");
}

export function clearIdeTurnRule() {
  try {
    fs.unlinkSync(IDE_TURN_RULE_PATH);
  } catch {
    /* ignore */
  }
}

/** @param {unknown} input */
export function hookSessionId(input) {
  const o = input && typeof input === "object" ? input : {};
  return (
    String(
      o.session_id ??
        o.sessionId ??
        o.conversation_id ??
        o.conversationId ??
        "",
    ).trim() || null
  );
}
