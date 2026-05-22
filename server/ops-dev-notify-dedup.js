/**
 * ops 개발 완료 텔레그램 — 동일 턴·프로세스 재기동(Vite) 중복 발송 방지.
 * 메모리 + server/.data/ops-dev-notify-dedup.json + 발송 lock 파일.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRepoHeadRev } from "./ops-agent-git-push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const DEDUP_FILE = path.join(DATA_DIR, "ops-dev-notify-dedup.json");
const LOCK_DIR = path.join(DATA_DIR, "ops-notify-locks");

const DEFAULT_DEDUP_MS = 5 * 60 * 1000;
const DEFAULT_AUTOGIT_SUPPRESS_MS = 8 * 60 * 1000;

/** @type {Map<string, number>} */
const sentAtByKey = new Map();

let lastCompletionRev = "";
let lastCompletionAt = 0;
let diskHydrated = false;

function dedupWindowMs() {
  const n = Number(process.env.OPS_DEV_NOTIFY_DEDUP_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 60 * 60 * 1000);
  return DEFAULT_DEDUP_MS;
}

function autogitSuppressMs() {
  const n = Number(process.env.OPS_AUTOGIT_NOTIFY_SUPPRESS_AFTER_COMPLETION_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 60 * 60 * 1000);
  return DEFAULT_AUTOGIT_SUPPRESS_MS;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** 크래시 후 남은 send lock — 이후 알림 전부 막힘 방지 */
export function clearStaleOpsDevNotifyLocks(maxAgeMs = 120_000) {
  try {
    ensureDataDir();
    if (!fs.existsSync(LOCK_DIR)) return;
    const now = Date.now();
    for (const name of fs.readdirSync(LOCK_DIR)) {
      if (!name.endsWith(".lock")) continue;
      const p = path.join(LOCK_DIR, name);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > maxAgeMs) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** @returns {Record<string, number>} */
function readDiskEntries() {
  try {
    if (!fs.existsSync(DEDUP_FILE)) return {};
    const o = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf8"));
    if (!o || typeof o !== "object" || !o.entries) return {};
    return /** @type {Record<string, number>} */ (o.entries);
  } catch {
    return {};
  }
}

/** @param {Record<string, number>} entries */
function writeDiskEntries(entries) {
  ensureDataDir();
  const now = Date.now();
  const window = dedupWindowMs();
  const pruned = {};
  for (const [k, at] of Object.entries(entries)) {
    if (typeof at === "number" && now - at <= window * 2) pruned[k] = at;
  }
  fs.writeFileSync(
    DEDUP_FILE,
    JSON.stringify({ entries: pruned, updatedAtMs: now }, null, 0),
    "utf8",
  );
}

function hydrateFromDisk() {
  if (diskHydrated) return;
  diskHydrated = true;
  const window = dedupWindowMs();
  const now = Date.now();
  for (const [k, at] of Object.entries(readDiskEntries())) {
    if (typeof at === "number" && now - at < window) {
      sentAtByKey.set(k, at);
      if (k.startsWith("dev-complete:")) {
        const rev = getRepoHeadRev();
        if (rev) {
          lastCompletionRev = rev;
          lastCompletionAt = at;
        }
      }
    }
  }
}

function pruneSentKeys() {
  const window = dedupWindowMs();
  const now = Date.now();
  for (const [k, at] of sentAtByKey) {
    if (now - at > window * 2) sentAtByKey.delete(k);
  }
}

function sentRecently(k) {
  const window = dedupWindowMs();
  if (window === 0) return false;
  const now = Date.now();
  const mem = sentAtByKey.get(k);
  if (mem != null && now - mem < window) return true;
  const disk = readDiskEntries()[k];
  if (typeof disk === "number" && now - disk < window) {
    sentAtByKey.set(k, disk);
    return true;
  }
  return false;
}

/**
 * @param {{
 *   userRequest?: string | null;
 *   agentResponse?: string | null;
 *   errorText?: string | null;
 *   state?: string;
 *   gitSummary?: string | null;
 *   title?: string | null;
 *   turnId?: string | null;
 * }} opts
 */
export function buildOpsDevNotifyDedupKey(opts) {
  const turnId = String(opts.turnId ?? "").trim();
  if (turnId) return `dev-complete:turn:${turnId.slice(0, 64)}`;

  const req = String(opts.userRequest ?? opts.title ?? "").trim().slice(0, 280);
  let completion = "";
  if (opts.state === "error") {
    completion = String(opts.errorText ?? opts.agentResponse ?? "").trim();
  } else {
    completion = String(opts.agentResponse ?? "").trim();
  }
  completion = completion.slice(0, 400);
  const git = String(opts.gitSummary ?? "").trim().slice(0, 160);
  const rev = getRepoHeadRev() || "no-rev";
  const h = createHash("sha256")
    .update(`${rev}\n${req}\n${completion}\n${git}`)
    .digest("hex")
    .slice(0, 16);
  return `dev-complete:${h}`;
}

/**
 * @param {{ userRequest: string; completion: string; title?: string; turnId?: string }} snap
 */
export function buildOpsDevNotifyDedupKeyFromSnap(snap) {
  return buildOpsDevNotifyDedupKey({
    userRequest: snap.userRequest,
    agentResponse: snap.completion,
    title: snap.title,
    turnId: snap.turnId,
    state: "ok",
  });
}

/**
 * sendMessage 실패·중단 후 같은 턴 재시도 가능하도록 lock 해제.
 * @param {string | null | undefined} dedupKey
 */
export function releaseOpsDevNotifySendLock(dedupKey) {
  const k = String(dedupKey ?? "").trim();
  if (!k) return;
  const lockName = createHash("sha256").update(k).digest("hex").slice(0, 32);
  const lockPath = path.join(LOCK_DIR, `${lockName}.lock`);
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string | null | undefined} dedupKey
 * @returns {boolean} true면 전송 생략
 */
export function shouldSkipOpsDevNotify(dedupKey) {
  hydrateFromDisk();
  const k = String(dedupKey ?? "").trim();
  if (!k) return false;
  if (sentRecently(k)) {
    console.info(`[telegram:ops] skip duplicate notify (${k.slice(0, 40)}…)`);
    return true;
  }
  return false;
}

/**
 * 동시에 여러 Node(Vite 재기동)가 flush해도 1프로세스만 실제 발송.
 * @param {string | null | undefined} dedupKey
 * @returns {boolean} true면 이 프로세스가 send 해도 됨
 */
export function tryAcquireOpsDevNotifySend(dedupKey) {
  hydrateFromDisk();
  const k = String(dedupKey ?? "").trim();
  if (!k) return true;
  clearStaleOpsDevNotifyLocks();

  const lockName = createHash("sha256").update(k).digest("hex").slice(0, 32);
  const lockPath = path.join(LOCK_DIR, `${lockName}.lock`);

  ensureDataDir();
  if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });

  /* lock 먼저 획득 후 dedup 체크 — 반대 순서면 두 프로세스가 동시에 dedup=false 확인 후 둘 다 발송 */
  const tryWriteLock = () => {
    try {
      fs.writeFileSync(lockPath, String(Date.now()), { flag: "wx" });
      return true;
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e
          ? String(/** @type {{ code?: string }} */ (e).code)
          : "";
      if (code === "EEXIST") {
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > dedupWindowMs()) {
            fs.unlinkSync(lockPath);
            fs.writeFileSync(lockPath, String(Date.now()), { flag: "wx" });
            return true;
          }
        } catch {
          /* ignore */
        }
        return false;
      }
      return true;
    }
  };

  if (!tryWriteLock()) {
    console.info("[telegram:ops] skip duplicate notify (send lock)");
    return false;
  }

  /* lock 획득 성공 — dedup 확인 후 이미 발송됐으면 lock 해제 */
  if (shouldSkipOpsDevNotify(k)) {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    return false;
  }

  return true;
}

/**
 * @param {string} dedupKey
 * @param {string} [gitHead]
 */
export function markOpsDevNotifySent(dedupKey, gitHead) {
  hydrateFromDisk();
  const k = String(dedupKey ?? "").trim();
  if (!k) return;
  const now = Date.now();
  sentAtByKey.set(k, now);
  pruneSentKeys();

  const disk = readDiskEntries();
  disk[k] = now;
  const rev = String(gitHead ?? "").trim() || getRepoHeadRev();
  if (rev) {
    lastCompletionRev = rev;
    lastCompletionAt = now;
    disk[`completion-rev:${rev}`] = now;
  }
  writeDiskEntries(disk);
}

/**
 * 에이전트·IDE 완료 직후 같은 HEAD로 auto-git 알림이 또 가지 않게.
 * @param {string} newRev
 */
export function shouldSkipAutoGitPullNotify(newRev) {
  hydrateFromDisk();
  const rev = String(newRev ?? "").trim();
  if (!rev) return false;
  if (shouldSkipOpsDevNotify(`autogit:${rev}`)) return true;
  if (sentRecently(`completion-rev:${rev}`)) {
    console.info(
      "[telegram:ops] skip auto-git notify (recent completion same HEAD)",
    );
    return true;
  }
  const suppress = autogitSuppressMs();
  if (
    suppress > 0 &&
    lastCompletionRev &&
    lastCompletionRev === rev &&
    Date.now() - lastCompletionAt < suppress
  ) {
    console.info(
      "[telegram:ops] skip auto-git notify (recent agent/IDE completion same HEAD)",
    );
    return true;
  }
  return false;
}

clearStaleOpsDevNotifyLocks();
