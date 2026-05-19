/**
 * Cursor Agent transcript(jsonl) 감시 — 이 채팅처럼 beforeSubmitPrompt 훅이
 * 안 돌 때도 사용자 메시지 직후 개발 대기열에 IDE 항목을 올린다.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getOpsAgentQueueSnapshot,
  hasActiveIdeSlotForPrompt,
  registerIdeDevQueueSlot,
  releaseAnyRunningIdeDevQueueSlot,
  releaseRunningIdeDevQueueIfDifferentPrompt,
} from "./ops-agent-job-queue.js";
import { readDevQueueLiveAgentEntriesSync } from "./ops-dev-queue-live-store.js";
import {
  clearIdeLeaseOnDisk,
  writeIdeLeaseDiskImmediate,
} from "./ops-ide-lease-disk.js";

const POLL_MS = 100;
/**
 * 마지막 assistant 줄이 **텍스트만**이고, 도구 호출 직후 짧은 공백(2~5초)과 구분하기 위한 유휴.
 * 답변 본문 스트리밍이 멈춘 뒤에만 release.
 */
const TURN_END_IDLE_MS = 12_000;
/** @deprecated */ const IDLE_RELEASE_MS = TURN_END_IDLE_MS;
const STALE_LEASE_MS = 8_000;

let pollerBootstrapped = false;
let pollerStarted = false;
/** @type {number} 같은 transcript mtime에 대해 release-active 중복 호출 방지 */
let idleTurnReleasedForMtime = 0;

/** @type {string | null} */
let activeLeaseId = null;
/** @type {string | null} */
let activeTranscriptPath = null;
let lastProcessedUserKey = "";
let lastFileMtimeMs = 0;
let lastFileChangeMs = 0;

function resolveTranscriptRoot() {
  const fromEnv = String(process.env.STOCK_AGENT_TRANSCRIPTS_DIR ?? "").trim();
  if (fromEnv) return fromEnv;

  const cwd = path.resolve(process.cwd());
  const drive = cwd.charAt(0).toLowerCase();
  const tail = cwd.slice(3).replace(/\\/g, "-");
  const slug = tail ? `${drive}-${tail}` : drive;
  return path.join(os.homedir(), ".cursor", "projects", slug, "agent-transcripts");
}

/** @returns {string | null} */
function findNewestTranscriptFile(root) {
  if (!fs.existsSync(root)) return null;

  /** @type {string | null} */
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
      const m = st.mtimeMs;
      if (m >= bestMtime) {
        bestMtime = m;
        best = full;
      }
    }
  }

  walk(root);
  return best;
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

function releaseActiveLease() {
  activeLeaseId = null;
  activeTranscriptPath = null;
  try {
    releaseAnyRunningIdeDevQueueSlot();
  } catch {
    /* ignore */
  }
  clearIdeLeaseOnDisk();
}

/** 메모리 큐·디스크 영속·활성 lease 중 IDE 작업 존재 여부 */
function hasIdeQueueWork(/** @type {ReturnType<typeof getOpsAgentQueueSnapshot>} */ snap) {
  if (activeLeaseId) return true;
  if (
    snap.entries.some(
      (e) => e.source === "ide" || e.requestIp === "cursor-ide",
    )
  ) {
    return true;
  }
  return readDevQueueLiveAgentEntriesSync().some(
    (e) =>
      (e.source === "ide" || e.requestIp === "cursor-ide") &&
      (e.status === "running" || e.status === "waiting"),
  );
}

/**
 * transcript가 TURN_END_IDLE_MS 동안 갱신 없으면 턴 종료로 간주해 해제.
 * (마지막 assistant가 tool_use만 있어도 완료 후 stuck 되지 않게 — 유휴 시간으로 구분)
 *
 * @param {string[]} lines
 * @param {ReturnType<typeof getOpsAgentQueueSnapshot>} snap
 */
function tryReleaseWhenTurnEnded(lines, snap) {
  if (!hasIdeQueueWork(snap)) {
    clearIdeLeaseOnDisk();
    return;
  }

  if (!lines.length) return;

  if (Date.now() - lastFileChangeMs < TURN_END_IDLE_MS) return;
  if (idleTurnReleasedForMtime === lastFileMtimeMs) return;
  idleTurnReleasedForMtime = lastFileMtimeMs;

  releaseActiveLease();
}

/**
 * @param {ReturnType<typeof getOpsAgentQueueSnapshot>} snap
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
    if (since > 0 && Date.now() - since >= STALE_LEASE_MS) {
      clearIdeLeaseOnDisk();
    }
  } catch {
    clearIdeLeaseOnDisk();
  }
}

/** 메모리 슬롯 없이 디스크에만 running IDE가 남은 경우(훅 미호출·재시작) */
function sweepOrphanedPersistRunning(snap) {
  const memRunning = snap.entries.find(
    (e) =>
      e.status === "running" &&
      (e.source === "ide" || e.requestIp === "cursor-ide"),
  );
  const memRunningId = memRunning ? String(memRunning.id ?? "").trim() : "";
  const orphans = readDevQueueLiveAgentEntriesSync().filter((e) => {
    if (e.status !== "running") return false;
    if (e.source !== "ide" && e.requestIp !== "cursor-ide") return false;
    const id = String(e.id ?? "").trim();
    if (!id) return false;
    if (memRunningId && id === memRunningId) return false;
    return true;
  });
  if (!orphans.length) return;
  if (Date.now() - lastFileChangeMs < TURN_END_IDLE_MS) return;
  try {
    releaseAnyRunningIdeDevQueueSlot();
  } catch {
    /* ignore */
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
  if (userKey === lastProcessedUserKey) return;
  lastProcessedUserKey = userKey;

  /* 같은 사용자 메시지면 실행 중 슬롯을 내리지 않음(훅 등록과 이중 완료 방지) */
  releaseRunningIdeDevQueueIfDifferentPrompt(preview);

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

/** @type {string[]} */
let cachedTranscriptLines = [];
/** @type {string} */
let cachedTranscriptPath = "";

/** @param {string} filePath */
function scanTranscriptFile(filePath) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    return;
  }

  const mtimeChanged = st.mtimeMs !== lastFileMtimeMs;
  if (mtimeChanged || cachedTranscriptPath !== filePath) {
    lastFileMtimeMs = st.mtimeMs;
    lastFileChangeMs = Date.now();
    idleTurnReleasedForMtime = 0;
    cachedTranscriptPath = filePath;
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      return;
    }
    cachedTranscriptLines = raw.split(/\n/).filter((l) => l.trim().length > 0);
  }

  const lines = cachedTranscriptLines;
  const snap = getOpsAgentQueueSnapshot();

  if (mtimeChanged) {
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
    const userKey = `${filePath}:${latestUser.lineIndex}`;
    if (!pollerBootstrapped) {
      lastProcessedUserKey = userKey;
      pollerBootstrapped = true;
    } else if (userKey !== lastProcessedUserKey) {
      enqueueFromTranscript(filePath, latestUser.prompt, latestUser.lineIndex);
    }
  }
  }

  tryReleaseWhenTurnEnded(lines, snap);
  sweepOrphanedPersistRunning(snap);
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
    const file = resolveTranscriptFileForScan(root);
    if (!file) return;
    scanTranscriptFile(file);
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
  if (pollerStarted) return;
  pollerStarted = true;

  try {
    releaseAnyRunningIdeDevQueueSlot();
    clearIdeLeaseOnDisk();
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
