/**
 * Cursor Agent transcript(jsonl) 감시 — 이 채팅처럼 beforeSubmitPrompt 훅이
 * 안 돌 때도 사용자 메시지 직후 개발 대기열에 IDE 항목을 올린다.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getOpsAgentQueueMemorySnapshot,
  hasActiveIdeSlotForPrompt,
  registerIdeDevQueueSlot,
  releaseAnyRunningIdeDevQueueSlot,
} from "./ops-agent-job-queue.js";
import {
  isIdeCompletionNotified,
  notifyIdeDevelopmentCompleted,
} from "./ops-ide-completion-notify.js";
import {
  clearIdeLeaseOnDisk,
  writeIdeLeaseDiskImmediate,
} from "./ops-ide-lease-disk.js";

const POLL_MS = 100;
/**
 * 마지막 assistant가 텍스트만·transcript 유휴 N ms 후 턴 종료(release).
 * `STOCK_IDE_TURN_END_IDLE_MS` (기본 4s, 최소 2s·최대 30s)
 */
const TURN_END_IDLE_MS = (() => {
  const n = Number(process.env.STOCK_IDE_TURN_END_IDLE_MS);
  if (Number.isFinite(n) && n >= 2000) return Math.min(n, 30_000);
  return 12_000;
})();
/** @deprecated */ const IDLE_RELEASE_MS = TURN_END_IDLE_MS;
/** 훅 enqueue 전·서버 재시작 직후 lease 유지 (display-sync 120s와 맞춤) */
const STALE_LEASE_MS = 120_000;
const TRANSCRIPT_POLLER_MARKER = path.join(
  process.cwd(),
  ".stock-ops-transcript-poller.on",
);

let pollerBootstrapped = false;
let pollerStarted = false;
/** @type {string | null} */
let activeLeaseId = null;
/** @type {string | null} */
let activeTranscriptPath = null;
/** transcript별 마지막 처리 user 키 — 병렬 에이전트·멀티 채팅 */
/** @type {Map<string, string>} */
const lastProcessedUserKeyByFile = new Map();
let lastProcessedUserKey = "";

/* 파일별 상태 — 전역 변수 공유 시 다중 파일 스캔에서 오래된 파일이 활성 슬롯을 잘못 release하는 버그 방지 */
/** @type {Map<string, number>} */
const lastFileMtimeMsByFile = new Map();
/** @type {Map<string, number>} */
const lastFileChangeMsByFile = new Map();
/** @type {Map<string, number>} */
const lastTranscriptLineCountByFile = new Map();
/** @type {Map<string, number>} mtime별 release 중복 방지 (파일별) */
const idleTurnReleasedForMtimeByFile = new Map();
/** @type {Map<string, string[]>} */
const cachedTranscriptLinesByFile = new Map();
/** @type {Map<string, { filePath: string; sessionId: string; prompt: string; lineIndex: number } | null>} */
const lastTurnNotifyContextByFile = new Map();

function resolveTranscriptRoot() {
  const fromEnv = String(process.env.STOCK_AGENT_TRANSCRIPTS_DIR ?? "").trim();
  if (fromEnv) return fromEnv;

  const cwd = path.resolve(process.cwd());
  const drive = cwd.charAt(0).toLowerCase();
  const tail = cwd.slice(3).replace(/\\/g, "-");
  const slug = tail ? `${drive}-${tail}` : drive;
  return path.join(os.homedir(), ".cursor", "projects", slug, "agent-transcripts");
}

const ACTIVE_TRANSCRIPT_MAX_AGE_MS = 45 * 60 * 1000;

/** @returns {string[]} 최근 수정 순 */
function findActiveTranscriptFiles(root, maxAgeMs = ACTIVE_TRANSCRIPT_MAX_AGE_MS) {
  if (!fs.existsSync(root)) return [];

  const now = Date.now();
  /** @type {{ path: string; mtime: number }[]} */
  const hits = [];

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
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (now - st.mtimeMs > maxAgeMs) continue;
      hits.push({ path: full, mtime: st.mtimeMs });
    }
  }

  walk(root);
  hits.sort((a, b) => b.mtime - a.mtime);
  return hits.map((h) => h.path);
}

/** @returns {string | null} */
function findNewestTranscriptFile(root) {
  const files = findActiveTranscriptFiles(root);
  return files[0] ?? null;
}

/** @param {string} text */
function extractUserPrompt(text) {
  const t = String(text ?? "");
  if (!t.trim()) return "";
  if (t.includes("<system_notification>")) return "";
  if (/Briefly inform the user about the task result/i.test(t)) return "";

  const m = t.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (m) return m[1].trim();
  return t.trim();
}

/**
 * @param {string[]} lines
 * @returns {{ hasToolUse: boolean; textOnly: boolean } | null}
 */
function parseLastAssistantTail(lines) {
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
      return { hasToolUse: false, textOnly: true };
    }
    const hasToolUse = parts.some((p) => p?.type === "tool_use");
    const textOnly =
      parts.length > 0 && parts.every((p) => p?.type === "text");
    return { hasToolUse, textOnly };
  }
  return null;
}

/**
 * @param {string} filePath
 */
function releaseActiveLease(filePath) {
  /* 활성 transcript와 다른 파일이 release를 트리거하면 무시 */
  if (activeTranscriptPath != null && filePath !== activeTranscriptPath) return;

  const ctx = lastTurnNotifyContextByFile.get(filePath);
  const notify =
    ctx && ctx.filePath === filePath && ctx.prompt
      ? {
          userRequest: ctx.prompt,
          sessionId: ctx.sessionId,
          transcriptPath: filePath,
        }
      : undefined;

  activeLeaseId = null;
  activeTranscriptPath = null;
  idleTurnReleasedForMtimeByFile.set(filePath, lastFileMtimeMsByFile.get(filePath) ?? 0);
  try {
    releaseAnyRunningIdeDevQueueSlot(notify ? { notify } : {});
  } catch {
    /* ignore */
  }
  clearIdeLeaseOnDisk();
  lastTurnNotifyContextByFile.delete(filePath);
  void import("./ops-dev-queue-display-sync.js")
    .then((m) => {
      m.forceClearDevQueueDisplayMirrorSync();
      m.requestDevQueueDisplaySyncNow();
    })
    .catch(() => {});
}

/** 메모리 큐·이 transcript 턴에서 등록한 lease만 — 디스크 lease 재승격 없음 */
function hasIdeQueueWork(/** @type {ReturnType<typeof getOpsAgentQueueMemorySnapshot>} */ snap) {
  if (activeLeaseId) return true;
  return snap.entries.some(
    (e) => e.source === "ide" || e.requestIp === "cursor-ide",
  );
}

/**
 * transcript: 유휴 + 마지막 assistant가 **텍스트만**일 때만 턴 종료(도구 실행·대기 중에는 파일 비우지 않음).
 *
 * @param {string[]} lines
 * @param {ReturnType<typeof getOpsAgentQueueMemorySnapshot>} snap
 * @param {string} filePath
 */
function notifyTurnCompletedWithoutQueue(filePath) {
  const ctx = lastTurnNotifyContextByFile.get(filePath);
  if (!ctx?.prompt || ctx.filePath !== filePath) return;
  if (isIdeCompletionNotified(ctx.sessionId, ctx.prompt)) return;
  notifyIdeDevelopmentCompleted({
    userRequest: ctx.prompt,
    sessionId: ctx.sessionId,
    transcriptPath: filePath,
  });
}

function tryReleaseWhenTurnEnded(lines, snap, filePath) {
  /* 활성 transcript와 다른 파일(오래된 대화 등)이 현재 슬롯을 잘못 release하는 버그 방지 */
  if (activeTranscriptPath != null && filePath !== activeTranscriptPath) return;

  if (!Array.isArray(lines) || lines.length === 0) return;

  const tail = parseLastAssistantTail(lines);
  if (!tail) return;
  if (tail.hasToolUse) return;
  if (!tail.textOnly) return;

  const fileChangeMs = lastFileChangeMsByFile.get(filePath) ?? 0;
  const fileMtimeMs = lastFileMtimeMsByFile.get(filePath) ?? 0;
  const idleReleasedMtime = idleTurnReleasedForMtimeByFile.get(filePath) ?? 0;

  if (Date.now() - fileChangeMs < TURN_END_IDLE_MS) return;
  if (idleReleasedMtime === fileMtimeMs) return;
  idleTurnReleasedForMtimeByFile.set(filePath, fileMtimeMs);

  if (hasIdeQueueWork(snap)) {
    releaseActiveLease(filePath);
    return;
  }

  /* 큐가 이미 비었어도(transcript·훅 선행) 턴 완료 알림은 보냄 */
  notifyTurnCompletedWithoutQueue(filePath);
  lastTurnNotifyContextByFile.delete(filePath);
}

/**
 * 마지막 assistant가 텍스트만이고 transcript가 유휴 — 턴 종료로 간주.
 * @param {string[]} lines
 * @param {string} filePath
 */
function isTranscriptTurnIdleCompleted(lines, filePath) {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const tail = parseLastAssistantTail(lines);
  if (!tail || tail.hasToolUse || !tail.textOnly) return false;
  const fileChangeMs = lastFileChangeMsByFile.get(filePath) ?? 0;
  return Date.now() - fileChangeMs >= TURN_END_IDLE_MS;
}

/**
 * @param {ReturnType<typeof getOpsAgentQueueMemorySnapshot>} snap
 */
function sweepStaleDiskLease(snap) {
  if (hasIdeQueueWork(snap)) return;

  try {
    const leasePath = path.join(process.cwd(), ".stock-ops-ide-lease.json");
    if (!fs.existsSync(leasePath)) return;
    const lease = JSON.parse(fs.readFileSync(leasePath, "utf8"));
    const since =
      typeof lease.sinceMs === "number"
        ? lease.sinceMs
        : typeof lease.enqueuedAtMs === "number"
          ? lease.enqueuedAtMs
          : 0;
    const hasLeaseId = Boolean(String(lease.leaseId ?? lease.id ?? "").trim());
    const age = since > 0 ? Date.now() - since : 0;
    const stale =
      age >= STALE_LEASE_MS && (!hasLeaseId || age >= 30 * 60 * 1000);
    if (stale) {
      clearIdeLeaseOnDisk();
    }
  } catch {
    clearIdeLeaseOnDisk();
  }
}

/**
 * 훅이 enqueue를 안 할 때 transcript 백업.
 * @param {string} filePath
 * @param {{ lineIndex: number; prompt: string }} latestUser
 * @param {string[]} lines
 */
function ensureLatestUserInQueue(filePath, latestUser, lines) {
  if (!Array.isArray(lines)) lines = [];
  const preview = latestUser.prompt.trim();
  if (!preview) return;
  if (hasActiveIdeSlotForPrompt(preview)) return;

  const userKey = `${filePath}:${latestUser.lineIndex}`;
  const sessionId = path.basename(filePath, ".jsonl");
  const prevKey = lastProcessedUserKeyByFile.get(filePath) ?? "";

  if (isTranscriptTurnIdleCompleted(lines, filePath)) {
    lastProcessedUserKeyByFile.set(filePath, userKey);
    lastProcessedUserKey = userKey;
    return;
  }

  if (userKey !== prevKey) {
    enqueueFromTranscript(filePath, preview, latestUser.lineIndex);
    lastProcessedUserKeyByFile.set(filePath, userKey);
    return;
  }

  /* release 직후·같은 턴 진행 중에만 재등록(재기동·완료 턴은 위에서 스킵) */
  const _fileChangeMs = lastFileChangeMsByFile.get(filePath) ?? 0;
  if (Date.now() - _fileChangeMs >= TURN_END_IDLE_MS) return;

  writeIdeLeaseDiskImmediate({ prompt: preview, sessionId, queueStatus: "waiting" });
  try {
    const reg = registerIdeDevQueueSlot({ prompt: preview, sessionId });
    activeLeaseId = String(reg.leaseId ?? "").trim() || null;
    activeTranscriptPath = filePath;
    writeIdeLeaseDiskImmediate({
      prompt: preview,
      sessionId,
      leaseId: activeLeaseId,
      queueStatus: reg.queueStatus === "running" ? "running" : "waiting",
    });
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String(/** @type {{ code?: string }} */ (e).code)
        : "";
    if (code !== "IDE_SESSION_BUSY") {
      console.warn(
        "[ops-ide-transcript]",
        e instanceof Error ? e.message : e,
      );
    }
  }
}

/**
 * @param {string} filePath
 * @param {string} prompt
 * @param {number} lineIndex
 */
function enqueueFromTranscript(filePath, prompt, lineIndex) {
  const preview = prompt.trim();
  if (!preview) return;

  if (hasActiveIdeSlotForPrompt(preview)) return;

  const sessionId = path.basename(filePath, ".jsonl");
  const userKey = `${filePath}:${lineIndex}`;
  if (userKey === (lastProcessedUserKeyByFile.get(filePath) ?? "")) return;
  lastProcessedUserKeyByFile.set(filePath, userKey);
  lastProcessedUserKey = userKey;

  try {
    const reg = registerIdeDevQueueSlot({
      prompt: preview,
      sessionId,
    });
    activeLeaseId = String(reg.leaseId ?? "").trim() || null;
    activeTranscriptPath = filePath;
    writeIdeLeaseDiskImmediate({
      prompt: preview,
      sessionId,
      leaseId: activeLeaseId,
      queueStatus: reg.queueStatus === "running" ? "running" : "waiting",
    });
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String(/** @type {{ code?: string }} */ (e).code)
        : "";
    if (code !== "IDE_SESSION_BUSY") {
      console.warn(
        "[ops-ide-transcript]",
        e instanceof Error ? e.message : e,
      );
    }
  }
}

/** @param {string} filePath */
function scanTranscriptFile(filePath) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    return;
  }

  const prevMtime = lastFileMtimeMsByFile.get(filePath) ?? -1;
  const mtimeChanged = st.mtimeMs !== prevMtime;
  if (mtimeChanged || !cachedTranscriptLinesByFile.has(filePath)) {
    lastFileMtimeMsByFile.set(filePath, st.mtimeMs);
    lastFileChangeMsByFile.set(filePath, st.mtimeMs);
    idleTurnReleasedForMtimeByFile.set(filePath, 0);
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      return;
    }
    cachedTranscriptLinesByFile.set(filePath, raw.split(/\n/).filter((l) => l.trim().length > 0));
  }

  const lines = cachedTranscriptLinesByFile.get(filePath) ?? [];
  const snap = getOpsAgentQueueMemorySnapshot();
  const prevLineCount = lastTranscriptLineCountByFile.get(filePath) ?? 0;
  const lineCountChanged = lines.length !== prevLineCount;
  if (lineCountChanged && !mtimeChanged) {
    lastFileChangeMsByFile.set(filePath, Date.now());
  }
  lastTranscriptLineCountByFile.set(filePath, lines.length);

  /** @type {{ lineIndex: number; prompt: string } | null} */
  let latestUser = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
      const p = extractUserPrompt(String(part.text ?? ""));
      if (p) latestUser = { lineIndex: i, prompt: p };
    }
  }

  if (latestUser) {
    lastTurnNotifyContextByFile.set(filePath, {
      filePath,
      sessionId: path.basename(filePath, ".jsonl"),
      prompt: latestUser.prompt.trim(),
      lineIndex: latestUser.lineIndex,
    });
    ensureLatestUserInQueue(filePath, latestUser, lines);
    pollerBootstrapped = true;
  }

  tryReleaseWhenTurnEnded(lines, snap, filePath);
  sweepStaleDiskLease(snap);
}

/** @param {string} root */
function resolveTranscriptFileForScan(root) {
  if (activeTranscriptPath) {
    try {
      if (fs.existsSync(activeTranscriptPath)) return activeTranscriptPath;
    } catch {
      /* fall through */
    }
  }
  return findNewestTranscriptFile(root);
}

function tick() {
  try {
    const root = resolveTranscriptRoot();
    const files = findActiveTranscriptFiles(root);
    if (!files.length) return;
    const primary = resolveTranscriptFileForScan(root);
    const ordered = primary
      ? [primary, ...files.filter((f) => f !== primary)]
      : files;
    const seen = new Set();
    for (const file of ordered) {
      if (seen.has(file)) continue;
      seen.add(file);
      scanTranscriptFile(file);
    }
  } catch (e) {
    console.warn(
      "[ops-ide-transcript]",
      e instanceof Error ? e.message : e,
    );
  }
}

/** @type {fs.FSWatcher | null} */
let transcriptWatcher = null;

export function startOpsIdeTranscriptPoller() {
  if (process.env.STOCK_IDE_TRANSCRIPT_POLLER === "0") return;
  const g = /** @type {typeof globalThis & { __stockIdeTranscriptPollerStarted?: boolean }} */ (
    globalThis
  );
  if (g.__stockIdeTranscriptPollerStarted || pollerStarted) return;
  g.__stockIdeTranscriptPollerStarted = true;
  pollerStarted = true;

  try {
    fs.writeFileSync(TRANSCRIPT_POLLER_MARKER, `${Date.now()}\n`, "utf8");
  } catch {
    /* ignore */
  }

  const root = resolveTranscriptRoot();
  console.info(
    `[ops-ide-transcript] 백업 감시 ON (훅 미동작 시) · ${root} · ${POLL_MS}ms`,
  );

  tick();
  setInterval(tick, POLL_MS);

  try {
    if (transcriptWatcher) transcriptWatcher.close();
    transcriptWatcher = fs.watch(root, { recursive: true }, () => {
      tick();
    });
  } catch {
    /* watch 실패 시 폴링만 */
  }
}
