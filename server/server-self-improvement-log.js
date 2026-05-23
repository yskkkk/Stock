/**
 * 서버 운영 중 문제·개선점을 SERVER_IMPROVEMENTS.md 에 자동 기록.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { formatLogTimestampKst } from "./log-kst.js";
import { dailyServerLogPath, ensureServerLogDirSync } from "./log-paths.js";
import { getPicksState } from "./screener.js";
import {
  getTelegramNotifyStatus,
  isOpsTelegramNotifyEnabled,
  probeOpsTelegramSetup,
} from "./telegram-notify.js";
import { getOpsAgentQueueMemorySnapshot } from "./ops-agent-job-queue.js";
import { hasOpsDevCompletionPending } from "./ops-dev-completion-coalesce.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(__dirname, ".data");
const STORE_FILE = path.join(DATA_DIR, "server-improvement-items.json");
const NOTES_MD = path.join(REPO_ROOT, "SERVER_IMPROVEMENTS.md");
const PENDING_NOTIFY_FILE = path.join(DATA_DIR, "ops-dev-notify-pending.json");

const DEFAULT_PROBE_MS = 5 * 60 * 1000;
const REWRITE_MIN_INTERVAL_MS = 45_000;

/** @type {ReturnType<typeof setInterval> | null} */
let probeTimer = null;
let lastMdRewriteAt = 0;
let processIssueCount = 0;

/**
 * @typedef {{
 *   id: string;
 *   status: "open" | "muted";
 *   severity: "info" | "warn" | "error";
 *   area: string;
 *   problem: string;
 *   suggestion: string;
 *   evidence: string;
 *   firstSeenAtMs: number;
 *   lastSeenAtMs: number;
 *   occurrences: number;
 * }} ImprovementItem
 */

function probeIntervalMs() {
  const n = Number(process.env.STOCK_SELF_IMPROVEMENT_PROBE_MS);
  if (Number.isFinite(n) && n >= 60_000) return Math.min(n, 60 * 60 * 1000);
  return DEFAULT_PROBE_MS;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {{ items: ImprovementItem[]; lastProbeAtMs: number; lastProbeSummary: string }} */
function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return { items: [], lastProbeAtMs: 0, lastProbeSummary: "" };
    }
    const o = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    const items = Array.isArray(o?.items) ? o.items : [];
    return {
      items: items.filter((x) => x && typeof x.id === "string"),
      lastProbeAtMs: Number(o?.lastProbeAtMs) || 0,
      lastProbeSummary: String(o?.lastProbeSummary ?? ""),
    };
  } catch {
    return { items: [], lastProbeAtMs: 0, lastProbeSummary: "" };
  }
}

/** @param {{ items: ImprovementItem[]; lastProbeAtMs?: number; lastProbeSummary?: string }} store */
function writeStore(store) {
  ensureDataDir();
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify(
      {
        items: store.items,
        lastProbeAtMs: store.lastProbeAtMs ?? 0,
        lastProbeSummary: store.lastProbeSummary ?? "",
        updatedAtMs: Date.now(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function severityRank(s) {
  if (s === "error") return 3;
  if (s === "warn") return 2;
  return 1;
}

/**
 * @param {{
 *   id: string;
 *   severity?: "info" | "warn" | "error";
 *   area?: string;
 *   problem: string;
 *   suggestion?: string;
 *   evidence?: string;
 * }} input
 */
export function recordServerImprovementNote(input) {
  const id = String(input.id ?? "")
    .trim()
    .replace(/[^\w.-]/g, "_")
    .slice(0, 80);
  if (!id) return;

  const problem = String(input.problem ?? "").trim().slice(0, 600);
  if (!problem) return;

  const now = Date.now();
  const store = readStore();
  const idx = store.items.findIndex((x) => x.id === id);
  const next = /** @type {ImprovementItem} */ ({
    id,
    status: "open",
    severity: input.severity === "error" ? "error" : input.severity === "info" ? "info" : "warn",
    area: String(input.area ?? "server").trim().slice(0, 32) || "server",
    problem,
    suggestion: String(input.suggestion ?? "").trim().slice(0, 500) || "원인 확인 후 코드·설정·UX를 점검하세요.",
    evidence: String(input.evidence ?? "").trim().slice(0, 300),
    firstSeenAtMs: now,
    lastSeenAtMs: now,
    occurrences: 1,
  });

  if (idx >= 0) {
    const prev = store.items[idx];
    if (prev.status === "muted") return;
    next.status = "open";
    next.firstSeenAtMs = prev.firstSeenAtMs;
    next.lastSeenAtMs = now;
    next.occurrences = (prev.occurrences ?? 0) + 1;
    if (severityRank(next.severity) < severityRank(prev.severity)) {
      next.severity = prev.severity;
    }
    const sameBody =
      prev.problem === next.problem &&
      prev.suggestion === next.suggestion &&
      now - prev.lastSeenAtMs < 30 * 60 * 1000;
    if (sameBody && next.occurrences % 5 !== 0) {
      store.items[idx] = { ...prev, lastSeenAtMs: now, occurrences: next.occurrences };
      writeStore(store);
      return;
    }
    store.items[idx] = next;
  } else {
    store.items.push(next);
  }

  if (store.items.length > 80) {
    store.items.sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs);
    store.items = store.items.slice(0, 80);
  }

  writeStore(store);
  maybeRewriteMarkdown(store);
}

function maybeRewriteMarkdown(store) {
  const now = Date.now();
  if (now - lastMdRewriteAt < REWRITE_MIN_INTERVAL_MS) return;
  lastMdRewriteAt = now;
  rewriteImprovementsMarkdown(store);
}

function rewriteImprovementsMarkdown(store) {
  const open = store.items
    .filter((x) => x.status === "open")
    .sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        b.lastSeenAtMs - a.lastSeenAtMs,
    );

  const lines = [
    "# Stock 서버 자가 개선 백로그",
    "",
    "이 파일은 **서버가 돌면서** 스스로 발견한 문제·개선 아이디어를 적습니다.",
    "에이전트에게 예: `@SERVER_IMPROVEMENTS.md` 열어서 열린 항목 반영해줘.",
    "",
    "| 표시 | 의미 |",
    "|------|------|",
    "| **open** | 아직 미해결 |",
    "| **muted** | 같은 id가 반복돼도 일시 무시 중 |",
    "",
    "내부 상태: `server/.data/server-improvement-items.json` (git 제외)",
    "",
    "---",
    "",
    "## 열린 항목",
    "",
  ];

  if (!open.length) {
    lines.push("_현재 자동 기록된 열린 항목이 없습니다._", "");
  } else {
    for (const it of open) {
      const ts = formatLogTimestampKst(it.lastSeenAtMs);
      const sev = it.severity.toUpperCase();
      lines.push(
        `### [${sev}] ${it.area} — ${ts}`,
        "",
        `<!-- id:${it.id} -->`,
        "",
        `**문제**: ${it.problem}`,
        "",
        `**개선 제안**: ${it.suggestion}`,
        "",
      );
      if (it.evidence) lines.push(`**근거**: ${it.evidence}`, "");
      if (it.occurrences > 1) {
        lines.push(`_재발 ${it.occurrences}회 (최초 ${formatLogTimestampKst(it.firstSeenAtMs)})_`, "");
      }
      lines.push("---", "");
    }
  }

  lines.push("## 최근 자동 점검", "");
  if (store.lastProbeSummary) {
    lines.push(
      `${formatLogTimestampKst(store.lastProbeAtMs)} — ${store.lastProbeSummary}`,
      "",
    );
  } else {
    lines.push("_(아직 없음)_", "");
  }

  try {
    fs.writeFileSync(NOTES_MD, lines.join("\n"), "utf8");
  } catch (e) {
    console.warn(
      "[self-improvement]",
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * @param {string} category
 * @param {string} message
 * @param {"warn"|"error"} level
 */
export function recordServerEventForImprovement(category, message, level) {
  const cat = String(category ?? "server").trim() || "server";
  const msg = String(message ?? "").trim();
  if (!msg) return;
  if (/skip duplicate notify/i.test(msg)) return;
  if (/listening|기동/i.test(msg) && level !== "error") return;

  const h = createHash("sha256").update(`${cat}:${msg}`).digest("hex").slice(0, 10);
  recordServerImprovementNote({
    id: `log-${cat}-${h}`,
    severity: level === "error" ? "error" : "warn",
    area: cat,
    problem: msg,
    suggestion: inferSuggestionFromLog(cat, msg),
    evidence: `server/.logs 접근 로그 INTERNAL ${cat}`,
  });
}

/**
 * @param {string} label
 * @param {unknown} reason
 */
export function recordProcessRuntimeIssue(label, reason) {
  processIssueCount++;
  const msg = reason instanceof Error ? reason.message : String(reason ?? "");
  recordServerImprovementNote({
    id: `process-${String(label).replace(/\W/g, "_")}`,
    severity: "error",
    area: "process",
    problem: `${label}: ${msg.slice(0, 400)}`,
    suggestion:
      "비동기 오류를 await/catch로 처리하고, 폴링·훅 tick에서 throw가 밖으로 나가지 않게 방어하세요.",
    evidence: `누적 ${processIssueCount}회`,
  });
}

/**
 * @param {string} cat
 * @param {string} msg
 */
function inferSuggestionFromLog(cat, msg) {
  if (/telegram|텔레그램/i.test(cat + msg)) {
    return "TELEGRAM_* 토큰·chat_id·send 실패 로그를 확인하고, ops/주식 봇 설정을 분리 점검하세요.";
  }
  if (/auto-git|pull failed|stash|fetch origin/i.test(msg)) {
    return "로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.";
  }
  if (/screener|yahoo/i.test(cat + msg)) {
    return "데이터 소스 rate limit·심볼 오류를 줄이거나 실패 종목 재시도·백오프를 조정하세요.";
  }
  if (/queue|ide|lease/i.test(cat + msg)) {
    return "개발 큐 lease·transcript poller·훅 release 경로가 맞는지 확인하세요.";
  }
  return "해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.";
}

function tailInternalErrorsFromTodayLog(maxLines = 400) {
  ensureServerLogDirSync();
  const logPath = dailyServerLogPath("access");
  if (!fs.existsSync(logPath)) return [];
  try {
    const raw = fs.readFileSync(logPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.includes("\tINTERNAL\t"));
    const recent = lines.slice(-maxLines);
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const line of recent) {
      if (!/\terror\b|fail|failed|오류/i.test(line)) continue;
      const parts = line.split("\t");
      const cat = parts[3] ?? "server";
      const msg = (parts[4] ?? "").slice(0, 120);
      const key = `${cat}:${msg}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function runServerSelfImprovementProbes() {
  /** @type {string[]} */
  const notes = [];
  let newCount = 0;

  if (!isOpsTelegramNotifyEnabled()) {
    recordServerImprovementNote({
      id: "env-ops-telegram-disabled",
      severity: "warn",
      area: "telegram",
      problem: "개발 완료·운영 알림용 TELEGRAM_OPS_BOT_TOKEN / TELEGRAM_OPS_CHAT_ID 가 비어 있습니다.",
      suggestion:
        ".env에 ops 전용 봇·채팅 ID를 넣고 probeOpsTelegramSetup으로 연결을 확인하세요.",
      evidence: "isOpsTelegramNotifyEnabled() === false",
    });
    newCount++;
  } else {
    const probe = await probeOpsTelegramSetup();
    if (!probe.ok) {
      recordServerImprovementNote({
        id: "env-ops-telegram-probe-fail",
        severity: "warn",
        area: "telegram",
        problem: `ops 텔레그램 연결 검증 실패: ${probe.reason ?? "unknown"}`,
        suggestion: "봇 토큰·채팅 ID·봇 초대 여부를 확인하세요.",
        evidence: String(probe.reason ?? ""),
      });
      newCount++;
    }
  }

  const stockTg = getTelegramNotifyStatus();
  if (!stockTg.enabled) {
    recordServerImprovementNote({
      id: "env-stock-telegram-disabled",
      severity: "info",
      area: "telegram",
      problem: "종목 추천 알림(TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)이 꺼져 있습니다.",
      suggestion: "추천 알림이 필요하면 주식 봇 환경 변수를 설정하세요.",
    });
  } else if (stockTg.lastError) {
    const ageMin = Math.round((Date.now() - stockTg.lastError.atMs) / 60_000);
    if (ageMin < 120) {
      recordServerImprovementNote({
        id: "telegram-stock-send-error",
        severity: "warn",
        area: "telegram",
        problem: `종목 알림 전송 오류: ${stockTg.lastError.message}`,
        suggestion: "텔레그램 API 응답·rate limit·메시지 포맷을 점검하세요.",
        evidence: `${ageMin}분 전 status ${stockTg.lastError.status ?? "?"}`,
      });
      newCount++;
    }
  }

  const picks = getPicksState();
  if (picks.running) {
    const elapsed = picks.startedAt ? Date.now() - picks.startedAt : 0;
    if (elapsed > 25 * 60_000) {
      recordServerImprovementNote({
        id: "screener-run-too-long",
        severity: "warn",
        area: "screener",
        problem: `스크리닝이 ${Math.round(elapsed / 60_000)}분 이상 running 상태입니다.`,
        suggestion: "Yahoo 병렬·종목 수·타임아웃을 줄이거나 진행률 stuck 원인을 조사하세요.",
        evidence: picks.message ?? "",
      });
      newCount++;
    }
  } else if (picks.updatedAt) {
    const stale = Date.now() - picks.updatedAt;
    const limit = (picks.scanIntervalMs ?? 60_000) * 2.5;
    if (stale > limit) {
      recordServerImprovementNote({
        id: "screener-stale-results",
        severity: "warn",
        area: "screener",
        problem: `마지막 스캔 결과가 ${Math.round(stale / 60_000)}분 전입니다.`,
        suggestion: "startScreening·타이머·오류 로그를 확인해 자동 재스캔이 멈추지 않게 하세요.",
        evidence: picks.message ?? "",
      });
      newCount++;
    }
  }

  if (picks.total > 0 && picks.failedCount > 0) {
    const ratio = picks.failedCount / picks.total;
    if (ratio >= 0.15 && picks.failedCount >= 5) {
      recordServerImprovementNote({
        id: "screener-high-failure-rate",
        severity: "warn",
        area: "screener",
        problem: `스크리닝 실패 ${picks.failedCount}/${picks.total} (${(ratio * 100).toFixed(0)}%)`,
        suggestion:
          "실패 심볼·데이터 소스를 분류하고 재시도·제외 목록·캐시 전략을 조정하세요.",
        evidence: (picks.failures?.[0] ?? "").toString().slice(0, 120),
      });
      newCount++;
    }
  }

  const q = getOpsAgentQueueMemorySnapshot();
  const running = q.entries.find((e) => e.status === "running");
  if (running?.enqueuedAtMs) {
    const runMs = Date.now() - running.enqueuedAtMs;
    if (runMs > 3 * 60 * 60_000) {
      recordServerImprovementNote({
        id: "ops-queue-running-stuck",
        severity: "warn",
        area: "ops-queue",
        problem: `개발 큐 running 항목이 ${Math.round(runMs / 3_600_000)}시간 이상 유지됩니다.`,
        suggestion:
          "IDE lease·transcript 턴 종료·release 훅이 호출되는지 확인하고 stuck 슬롯을 정리하세요.",
        evidence: running.instructionPreview ?? running.id ?? "",
      });
      newCount++;
    }
  }

  if (hasOpsDevCompletionPending()) {
    try {
      if (fs.existsSync(PENDING_NOTIFY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(PENDING_NOTIFY_FILE, "utf8"));
        const at = raw?.pending?.at;
        if (typeof at === "number" && Date.now() - at > 10 * 60_000) {
          recordServerImprovementNote({
            id: "ops-dev-notify-pending-stale",
            severity: "warn",
            area: "telegram",
            problem: "개발 완료 텔레그램 pending이 10분 이상 디스크에 남아 있습니다.",
            suggestion:
              "flushOpsDevNotifyPendingFromDisk·coalesce 타이머·프로세스 재기동 경로를 점검하세요.",
            evidence: `pending since ${formatLogTimestampKst(at)}`,
          });
          newCount++;
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (!String(process.env.CURSOR_API_KEY ?? "").trim()) {
    recordServerImprovementNote({
      id: "env-cursor-api-key-missing",
      severity: "info",
      area: "env",
      problem: "CURSOR_API_KEY 가 비어 있어 웹 운영 에이전트를 쓸 수 없습니다.",
      suggestion: "운영 탭 Cursor 에이전트를 쓸 때 .env에 키를 설정하세요.",
    });
  }

  for (const [key, count] of tailInternalErrorsFromTodayLog()) {
    const [cat, msg] = key.split(":", 2);
    recordServerImprovementNote({
      id: `logfreq-${createHash("sha256").update(key).digest("hex").slice(0, 10)}`,
      severity: "warn",
      area: cat || "server",
      problem: `오늘 로그에서 반복 오류: ${msg} (${count}회)`,
      suggestion: inferSuggestionFromLog(cat, msg),
      evidence: `server/.logs 오늘 INTERNAL ${count}회`,
    });
    newCount++;
  }

  const store = readStore();
  store.lastProbeAtMs = Date.now();
  store.lastProbeSummary = `probes 완료 · 열린 ${store.items.filter((x) => x.status === "open").length}건 · 이번 기록 ${newCount}건`;
  writeStore(store);
  rewriteImprovementsMarkdown(store);
  notes.push(store.lastProbeSummary);
  return { summary: store.lastProbeSummary, openCount: store.items.filter((x) => x.status === "open").length };
}

export function startServerSelfImprovementWatcher() {
  if (process.env.STOCK_SELF_IMPROVEMENT === "0") return;
  const g = /** @type {typeof globalThis & { __stockSelfImprovementStarted?: boolean }} */ (
    globalThis
  );
  if (g.__stockSelfImprovementStarted) return;
  g.__stockSelfImprovementStarted = true;

  const store = readStore();
  rewriteImprovementsMarkdown(store);

  const bootDelay = 30_000;
  setTimeout(() => {
    void runServerSelfImprovementProbes();
  }, bootDelay);

  probeTimer = setInterval(() => {
    void runServerSelfImprovementProbes();
  }, probeIntervalMs());
  if (typeof probeTimer.unref === "function") probeTimer.unref();

  console.info(
    `[self-improvement] 백로그 → ${path.relative(REPO_ROOT, NOTES_MD)} · probe ${probeIntervalMs() / 1000}s`,
  );
}
