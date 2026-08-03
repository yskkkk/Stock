/**
 * 가상 사용자 — 페르소나 · 피드백 · 백업 저장소
 * server/.data/virtual-users.json
 * server/.data/virtual-user-backups/<feedbackId>/<stamp>/
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { readJsonStoreSync, writeJsonStoreSync, parseJsonText } from "./store-json.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const STORE_FILE = "virtual-users.json";
const STORE_PATH = path.join(DATA_DIR, "virtual-users.json");
const BACKUPS_DIR = path.join(DATA_DIR, "virtual-user-backups");

const MAX_FEEDBACK = 300;
const MAX_BACKUPS_PER_FEEDBACK = 20;
const MAX_PROMPT_LEN = 12_000;
const MAX_TITLE_LEN = 200;
const MAX_DETAIL_LEN = 4_000;

/** @typedef {"new"|"pending_review"|"approved"|"queued"|"done"|"dismissed"} VuFeedbackStatus */
/** @typedef {"blocker"|"major"|"minor"|"nit"} VuSeverity */

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   enabled: boolean;
 *   skill: "beginner"|"intermediate"|"power";
 *   device: "desktop"|"mobile";
 *   goals: string[];
 *   focusAreas: string[];
 *   traits: string;
 *   satisfactionLevel: number;
 *   lastEscalatedAtMs: number | null;
 *   createdAtMs: number;
 *   updatedAtMs: number;
 * }} VirtualPersona
 */

/**
 * @typedef {{
 *   enabled: boolean;
 *   intervalMs: number;
 *   useBrowser: boolean;
 *   notifyTelegram: boolean;
 *   autoImplement: boolean;
 *   autoImplementMinSeverity: "blocker"|"major"|"minor"|"nit";
 *   pausedByApiExhaustion: boolean;
 *   pausedAtMs: number | null;
 *   pausedReason: string | null;
 *   lastTickAtMs: number | null;
 *   lastSessionId: string | null;
 *   lastError: string | null;
 *   lastCreatedCount: number;
 *   nextPersonaIndex: number;
 *   noveltyAngleOffset: number;
 *   emptyExploreStreak: number;
 *   lastManagerAtMs: number | null;
 *   lastManagerDecision: string | null;
 *   lastManagerScore: number | null;
 *   managerReviewCount: number;
 * }} VirtualUserContinuous
 */

/**
 * @typedef {{
 *   id: string;
 *   personaId: string;
 *   personaName: string;
 *   sessionId: string;
 *   at: string;
 *   createdAtMs: number;
 *   status: VuFeedbackStatus;
 *   severity: VuSeverity;
 *   area: string;
 *   title: string;
 *   detail: string;
 *   suggestion: string;
 *   discomfort: string;
 *   improvementSummary: string;
 *   implementResult: string;
 *   prompt: string;
 *   implementJobId: string | null;
 *   implementQueuedAtMs: number | null;
 *   implementDoneAtMs: number | null;
 *   preVersionId: string | null;
 *   postVersionId: string | null;
 *   telegramSentAtMs: number | null;
 *   backupCount: number;
 *   lastBackupId: string | null;
 *   managerScore: number | null;
 *   managerDecision: string | null;
 *   managerNotes: string;
 *   managerReviewedAtMs: number | null;
 * }} VirtualFeedback
 */

/**
 * @typedef {{
 *   id: string;
 *   startedAtMs: number;
 *   finishedAtMs: number | null;
 *   personaIds: string[];
 *   feedbackIds: string[];
 *   ok: boolean;
 *   error: string | null;
 * }} VirtualSession
 */

/**
 * @typedef {{
 *   version: number;
 *   personas: VirtualPersona[];
 *   feedback: VirtualFeedback[];
 *   sessions: VirtualSession[];
 *   continuous: VirtualUserContinuous;
 * }} VirtualUserStore
 */

const DEFAULT_CONTINUOUS_INTERVAL_MS = 3 * 60_000; // 에이전트 전송 스캔 주기(탐색은 연속)

/** @returns {VirtualUserContinuous} */
export function defaultContinuousConfig() {
  return {
    enabled: true,
    intervalMs: DEFAULT_CONTINUOUS_INTERVAL_MS,
    useBrowser: true,
    notifyTelegram: false,
    autoImplement: true,
    autoImplementMinSeverity: /** @type {const} */ ("minor"),
    pausedByApiExhaustion: false,
    pausedAtMs: null,
    pausedReason: null,
    lastTickAtMs: null,
    lastSessionId: null,
    lastError: null,
    lastCreatedCount: 0,
    nextPersonaIndex: 0,
    noveltyAngleOffset: 0,
    emptyExploreStreak: 0,
    lastManagerAtMs: null,
    lastManagerDecision: null,
    lastManagerScore: null,
    managerReviewCount: 0,
  };
}

/** @param {unknown} raw @returns {VirtualUserContinuous} */
function normalizeContinuous(raw) {
  const d = defaultContinuousConfig();
  if (!raw || typeof raw !== "object") return d;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const interval = Number(o.intervalMs);
  const minSev = String(o.autoImplementMinSeverity ?? "minor");
  /** @type {VirtualUserContinuous["autoImplementMinSeverity"]} */
  const autoImplementMinSeverity =
    minSev === "blocker" || minSev === "major" || minSev === "nit"
      ? minSev
      : "minor";
  return {
    enabled: o.enabled !== false,
    intervalMs:
      Number.isFinite(interval) && interval >= 60_000
        ? Math.min(interval, 60 * 60_000)
        : d.intervalMs,
    useBrowser: o.useBrowser !== false,
    notifyTelegram: o.notifyTelegram === true,
    autoImplement: o.autoImplement !== false,
    autoImplementMinSeverity,
    pausedByApiExhaustion: o.pausedByApiExhaustion === true,
    pausedAtMs:
      o.pausedAtMs == null ? null : Number(o.pausedAtMs) || null,
    pausedReason:
      o.pausedReason == null || o.pausedReason === ""
        ? null
        : String(o.pausedReason).slice(0, 500),
    lastTickAtMs:
      o.lastTickAtMs == null ? null : Number(o.lastTickAtMs) || null,
    lastSessionId:
      o.lastSessionId == null || o.lastSessionId === ""
        ? null
        : String(o.lastSessionId).slice(0, 80),
    lastError:
      o.lastError == null || o.lastError === ""
        ? null
        : String(o.lastError).slice(0, 500),
    lastCreatedCount: Math.max(0, Number(o.lastCreatedCount) || 0),
    nextPersonaIndex: Math.max(0, Math.floor(Number(o.nextPersonaIndex) || 0)),
    noveltyAngleOffset: Math.max(
      0,
      Math.floor(Number(o.noveltyAngleOffset) || 0),
    ),
    emptyExploreStreak: Math.max(0, Math.floor(Number(o.emptyExploreStreak) || 0)),
    lastManagerAtMs:
      o.lastManagerAtMs == null ? null : Number(o.lastManagerAtMs) || null,
    lastManagerDecision:
      o.lastManagerDecision == null || o.lastManagerDecision === ""
        ? null
        : String(o.lastManagerDecision).slice(0, 40),
    lastManagerScore:
      o.lastManagerScore == null
        ? null
        : Math.max(0, Math.min(100, Number(o.lastManagerScore) || 0)),
    managerReviewCount: Math.max(0, Math.floor(Number(o.managerReviewCount) || 0)),
  };
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultPersonas() {
  const now = Date.now();
  /** @type {VirtualPersona[]} */
  return [
    {
      id: "vu-beginner-kr",
      name: "초보 · 국내주식",
      enabled: true,
      skill: "beginner",
      device: "desktop",
      goals: [
        "계좌관리에서 내 보유 비중을 이해한다",
        "스케줄·즉시 매수 버튼이 무엇인지 파악한다",
        "아이콘·탭이 PC에서 읽히는지, 모바일에서도 깨지지 않는지 본다",
      ],
      focusAreas: ["account-manage", "rebalance", "auth", "navigation"],
      traits:
        "용어에 약하고 켜짐/꺼짐·원화/달러 구분이 안 보이면 바로 막힌다. PC·모바일 둘 다 보고 아이콘 크기·간격·가독성을 계속 지적한다.",
      satisfactionLevel: 3,
      lastEscalatedAtMs: null,
      createdAtMs: now,
      updatedAtMs: now,
    },
    {
      id: "vu-us-investor",
      name: "미국주식 투자자",
      enabled: true,
      skill: "intermediate",
      device: "desktop",
      goals: [
        "달러 현금으로만 미국 종목이 매수되는지 확인한다",
        "정규장이 아닐 때 즉시 매수가 막히는지 확인한다",
        "탭·브랜드 아이콘 크기와 PC 밀도·모바일 터치가 동시에 맞는지 본다",
      ],
      focusAreas: ["account-manage", "rebalance", "orders", "navigation"],
      traits:
        "통화 혼동·애프터장 주문을 싫어한다. PC에서 맞춘 UI가 모바일에서 깨지면 다시 피드백한다. 아이콘·칩 크기에도 깐깐하다.",
      satisfactionLevel: 3,
      lastEscalatedAtMs: null,
      createdAtMs: now,
      updatedAtMs: now,
    },
    {
      id: "vu-mobile-power",
      name: "모바일 파워유저",
      enabled: true,
      skill: "power",
      device: "mobile",
      goals: [
        "좁은 화면에서 관리자·계좌·스케줄 진입 경로를 찾는다",
        "중요 액션(즉시 매수)이 실수로 눌리지 않는지 본다",
        "가로 넘침·작은 터치(~44px)·아이콘 잘림·모달 footer 가림을 찾는다",
        "같은 이슈가 PC에서는 괜찮은지 교차 확인한다",
      ],
      focusAreas: ["account-manage", "rebalance", "navigation", "mobile"],
      traits:
        "터치 타깃·아이콘 크기·확인 다이얼로그·스크롤에 민감하다. 레이아웃 틀을 바꾸라는 말은 하지 않고, PC·모바일을 함께 보며 UI/UX를 계속 깐깐히 지적한다.",
      satisfactionLevel: 3,
      lastEscalatedAtMs: null,
      createdAtMs: now,
      updatedAtMs: now,
    },
    {
      id: "vu-mobile-beginner",
      name: "모바일 초보",
      enabled: true,
      skill: "beginner",
      device: "mobile",
      goals: [
        "한 손으로 계좌관리·탭 이동이 되는지 본다",
        "글자·버튼·아이콘이 잘리거나 너무 작아 못 누르는 곳을 찾는다",
        "PC 화면과 느낌이 너무 다르면 불편하다고 말한다",
      ],
      focusAreas: ["account-manage", "navigation", "mobile"],
      traits:
        "용어에 약하고 엄지로 누르기 어려운 UI·작은 아이콘에 바로 막힌다. 화면 구조보다 누르기·읽기·아이콘 크기를 PC·모바일 기준으로 계속 피드백한다.",
      satisfactionLevel: 3,
      lastEscalatedAtMs: null,
      createdAtMs: now,
      updatedAtMs: now,
    },
  ];
}

/** @returns {VirtualUserStore} */
function emptyStore() {
  return {
    version: 2,
    personas: defaultPersonas(),
    feedback: [],
    sessions: [],
    continuous: defaultContinuousConfig(),
  };
}

/** @param {unknown} raw @returns {VirtualPersona | null} */
function normalizePersona(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const id = String(o.id ?? "").trim();
  const name = String(o.name ?? "").trim();
  if (!id || !name) return null;
  const skillRaw = String(o.skill ?? "beginner");
  const skill =
    skillRaw === "intermediate" || skillRaw === "power" ? skillRaw : "beginner";
  const device = String(o.device ?? "desktop") === "mobile" ? "mobile" : "desktop";
  const goals = Array.isArray(o.goals)
    ? o.goals.map((g) => String(g).trim()).filter(Boolean).slice(0, 8)
    : [];
  const focusAreas = Array.isArray(o.focusAreas)
    ? o.focusAreas.map((g) => String(g).trim()).filter(Boolean).slice(0, 12)
    : [];
  const createdAtMs = Number(o.createdAtMs);
  const updatedAtMs = Number(o.updatedAtMs);
  const sat = Math.round(Number(o.satisfactionLevel ?? 1));
  const lastEsc = o.lastEscalatedAtMs == null ? null : Number(o.lastEscalatedAtMs);
  return {
    id,
    name: name.slice(0, 80),
    enabled: o.enabled !== false,
    skill,
    device,
    goals,
    focusAreas,
    traits: String(o.traits ?? "").slice(0, 400),
    satisfactionLevel:
      Number.isFinite(sat) && sat >= 1 && sat <= 5 ? sat : 1,
    lastEscalatedAtMs: lastEsc != null && Number.isFinite(lastEsc) ? lastEsc : null,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
  };
}

/** @param {unknown} raw @returns {VirtualFeedback | null} */
function normalizeFeedback(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const id = String(o.id ?? "").trim();
  if (!id) return null;
  const st = String(o.status ?? "new");
  /** @type {VuFeedbackStatus} */
  const status =
    st === "queued" ||
    st === "done" ||
    st === "dismissed" ||
    st === "pending_review" ||
    st === "approved"
      ? st
      : "new";
  const sev = String(o.severity ?? "minor");
  /** @type {VuSeverity} */
  const severity =
    sev === "blocker" || sev === "major" || sev === "nit" ? sev : "minor";
  const createdAtMs = Number(o.createdAtMs);
  return {
    id,
    personaId: String(o.personaId ?? "").slice(0, 80),
    personaName: String(o.personaName ?? "").slice(0, 80),
    sessionId: String(o.sessionId ?? "").slice(0, 80),
    at: String(o.at ?? new Date().toISOString()),
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    status,
    severity,
    area: String(o.area ?? "").slice(0, 80),
    title: String(o.title ?? "").slice(0, MAX_TITLE_LEN),
    detail: String(o.detail ?? "").slice(0, MAX_DETAIL_LEN),
    suggestion: String(o.suggestion ?? "").slice(0, MAX_DETAIL_LEN),
    discomfort: String(o.discomfort ?? "").slice(0, MAX_DETAIL_LEN),
    improvementSummary: String(o.improvementSummary ?? "").slice(
      0,
      MAX_DETAIL_LEN,
    ),
    implementResult: String(o.implementResult ?? "").slice(0, MAX_DETAIL_LEN),
    prompt: String(o.prompt ?? "").slice(0, MAX_PROMPT_LEN),
    implementJobId:
      o.implementJobId == null || o.implementJobId === ""
        ? null
        : String(o.implementJobId).slice(0, 80),
    implementQueuedAtMs:
      o.implementQueuedAtMs == null
        ? null
        : Number(o.implementQueuedAtMs) || null,
    implementDoneAtMs:
      o.implementDoneAtMs == null
        ? null
        : Number(o.implementDoneAtMs) || null,
    preVersionId:
      o.preVersionId == null || o.preVersionId === ""
        ? null
        : String(o.preVersionId).slice(0, 80),
    postVersionId:
      o.postVersionId == null || o.postVersionId === ""
        ? null
        : String(o.postVersionId).slice(0, 80),
    telegramSentAtMs:
      o.telegramSentAtMs == null ? null : Number(o.telegramSentAtMs) || null,
    backupCount: Math.max(0, Number(o.backupCount) || 0),
    lastBackupId:
      o.lastBackupId == null || o.lastBackupId === ""
        ? null
        : String(o.lastBackupId).slice(0, 80),
    managerScore: (() => {
      const n = o.managerScore == null ? null : Number(o.managerScore);
      return n != null && Number.isFinite(n)
        ? Math.max(0, Math.min(100, n))
        : null;
    })(),
    managerDecision:
      o.managerDecision == null || o.managerDecision === ""
        ? null
        : String(o.managerDecision).slice(0, 40),
    managerNotes: String(o.managerNotes ?? "").slice(0, 1200),
    managerReviewedAtMs: (() => {
      const n =
        o.managerReviewedAtMs == null ? null : Number(o.managerReviewedAtMs);
      return n != null && Number.isFinite(n) ? n : null;
    })(),
  };
}

/** @returns {VirtualUserStore} */
export function readVirtualUserStoreSync() {
  return readJsonStoreSync(
    STORE_FILE,
    (raw) => {
      if (!raw || typeof raw !== "object") return emptyStore();
      const personas = Array.isArray(raw.personas)
        ? raw.personas.map(normalizePersona).filter(Boolean)
        : [];
      const feedback = Array.isArray(raw.feedback)
        ? raw.feedback.map(normalizeFeedback).filter(Boolean)
        : [];
      const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
      /** @type {VirtualUserStore} */
      const store = {
        version: 2,
        personas: personas.length ? /** @type {VirtualPersona[]} */ (personas) : defaultPersonas(),
        feedback: /** @type {VirtualFeedback[]} */ (feedback).slice(0, MAX_FEEDBACK),
        sessions: /** @type {VirtualSession[]} */ (sessions).slice(0, 100),
        continuous: normalizeContinuous(raw.continuous),
      };
      return store;
    },
    emptyStore,
  );
}

/** @param {VirtualUserStore} store */
export function writeVirtualUserStoreSync(store) {
  ensureDataDir();
  const payload = {
    version: 2,
    personas: store.personas,
    feedback: store.feedback.slice(0, MAX_FEEDBACK),
    sessions: store.sessions.slice(0, 100),
    continuous: normalizeContinuous(store.continuous),
  };
  writeJsonStoreSync(STORE_FILE, payload);
}

export function getVirtualUserContinuousSync() {
  return normalizeContinuous(readVirtualUserStoreSync().continuous);
}

/**
 * @param {Partial<VirtualUserContinuous>} patch
 */
export function patchVirtualUserContinuousSync(patch) {
  const store = readVirtualUserStoreSync();
  const cur = normalizeContinuous(store.continuous);
  store.continuous = normalizeContinuous({ ...cur, ...patch });
  writeVirtualUserStoreSync(store);
  return { ok: true, continuous: store.continuous };
}

/**
 * @param {string} id
 * @param {number} [delta]
 */
export function bumpPersonaSatisfactionSync(id, delta = 1) {
  const store = readVirtualUserStoreSync();
  const idx = store.personas.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "페르소나를 찾을 수 없습니다." };
  const cur = store.personas[idx];
  const nextLevel = Math.min(
    5,
    Math.max(1, (cur.satisfactionLevel || 1) + (Number(delta) || 1)),
  );
  if (nextLevel === cur.satisfactionLevel) {
    return { ok: true, persona: cur, escalated: false };
  }
  const next = normalizePersona({
    ...cur,
    satisfactionLevel: nextLevel,
    lastEscalatedAtMs: Date.now(),
    updatedAtMs: Date.now(),
  });
  if (!next) return { ok: false, error: "잘못된 페르소나입니다." };
  store.personas[idx] = next;
  writeVirtualUserStoreSync(store);
  return { ok: true, persona: next, escalated: true, personas: store.personas };
}

export function listVirtualPersonasSync() {
  return readVirtualUserStoreSync().personas;
}

/**
 * 기본 페르소나 중 저장소에 없는 id만 추가하고,
 * 기존 기본 페르소나는 만족도 하한(3)·UI 깐깐 기준 traits/goals를 보강한다.
 * @returns {{ ok: true; added: string[] }}
 */
export function ensureDefaultPersonasPresentSync() {
  const store = readVirtualUserStoreSync();
  const byId = new Map(store.personas.map((p) => [p.id, p]));
  /** @type {string[]} */
  const added = [];
  let changed = false;
  const STRICT_FLOOR = 3;
  const UI_TRAIT_MARK = "PC·모바일";

  for (const def of defaultPersonas()) {
    const cur = byId.get(def.id);
    if (!cur) {
      store.personas.push(def);
      byId.set(def.id, def);
      added.push(def.id);
      changed = true;
      continue;
    }
    /** @type {Record<string, unknown>} */
    const patch = { ...cur };
    let local = false;
    if ((cur.satisfactionLevel || 1) < STRICT_FLOOR) {
      patch.satisfactionLevel = STRICT_FLOOR;
      local = true;
    }
    const traits = String(cur.traits || "");
    if (!traits.includes(UI_TRAIT_MARK)) {
      patch.traits = `${traits} ${def.traits}`.trim().slice(0, 400);
      local = true;
    }
    const goals = Array.isArray(cur.goals) ? [...cur.goals] : [];
    for (const g of def.goals || []) {
      if (!goals.some((x) => String(x).includes(String(g).slice(0, 18)))) {
        goals.push(g);
        local = true;
      }
    }
    if (local) {
      patch.goals = goals.slice(0, 8);
      patch.focusAreas = Array.from(
        new Set([...(cur.focusAreas || []), ...(def.focusAreas || [])]),
      ).slice(0, 8);
      patch.updatedAtMs = Date.now();
      const next = normalizePersona(patch);
      if (next) {
        const idx = store.personas.findIndex((p) => p.id === def.id);
        if (idx >= 0) store.personas[idx] = next;
        changed = true;
      }
    }
  }

  if (changed) writeVirtualUserStoreSync(store);
  return { ok: true, added };
}

export function listVirtualFeedbackSync() {
  return readVirtualUserStoreSync().feedback;
}

/**
 * @param {string} id
 * @returns {VirtualFeedback | null}
 */
export function getVirtualFeedbackByIdSync(id) {
  const key = String(id ?? "").trim();
  if (!key) return null;
  return listVirtualFeedbackSync().find((f) => f.id === key) ?? null;
}

/**
 * 관리자 목록용 — 전체 prompt(수천자×수백건)를 빼 페이로드를 가볍게
 * @param {VirtualFeedback} item
 * @param {{ promptPreviewMax?: number }} [opts]
 */
export function slimVirtualFeedbackForList(item, opts = {}) {
  const previewMax = Math.min(
    400,
    Math.max(80, Number(opts.promptPreviewMax) || 160),
  );
  const prompt = String(item.prompt ?? "").trim();
  const hasPrompt = Boolean(prompt) && prompt !== "(생성 중)";
  return {
    ...item,
    detail: String(item.detail ?? "").slice(0, 420),
    discomfort: String(item.discomfort ?? "").slice(0, 420),
    suggestion: String(item.suggestion ?? "").slice(0, 280),
    improvementSummary: String(item.improvementSummary ?? "").slice(0, 360),
    implementResult: String(item.implementResult ?? "").slice(0, 240),
    prompt: hasPrompt ? `${prompt.slice(0, previewMax)}${prompt.length > previewMax ? "…" : ""}` : "",
    promptFull: undefined,
    hasPrompt,
    promptChars: hasPrompt ? prompt.length : 0,
  };
}

/**
 * @param {string} id
 * @param {Partial<VirtualPersona>} patch
 */
export function updateVirtualPersonaSync(id, patch) {
  const store = readVirtualUserStoreSync();
  const idx = store.personas.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "페르소나를 찾을 수 없습니다." };
  const cur = store.personas[idx];
  /** @type {Record<string, unknown>} */
  const merged = { ...cur };
  if (patch.enabled !== undefined) merged.enabled = Boolean(patch.enabled);
  if (patch.name !== undefined) merged.name = patch.name;
  if (patch.traits !== undefined) merged.traits = patch.traits;
  if (patch.goals !== undefined) merged.goals = patch.goals;
  if (patch.focusAreas !== undefined) merged.focusAreas = patch.focusAreas;
  if (patch.skill !== undefined) merged.skill = patch.skill;
  if (patch.device !== undefined) merged.device = patch.device;
  if (patch.satisfactionLevel !== undefined) {
    merged.satisfactionLevel = patch.satisfactionLevel;
  }
  if (patch.lastEscalatedAtMs !== undefined) {
    merged.lastEscalatedAtMs = patch.lastEscalatedAtMs;
  }
  merged.updatedAtMs = Date.now();
  const next = normalizePersona(merged);
  if (!next) return { ok: false, error: "잘못된 페르소나입니다." };
  store.personas[idx] = next;
  writeVirtualUserStoreSync(store);
  return { ok: true, persona: next, personas: store.personas };
}

/**
 * @param {Omit<VirtualFeedback, "id"|"at"|"createdAtMs"|"implementJobId"|"implementQueuedAtMs"|"telegramSentAtMs"|"backupCount"|"lastBackupId"|"status"> & { status?: VuFeedbackStatus }} input
 */
export function appendVirtualFeedbackSync(input) {
  const store = readVirtualUserStoreSync();
  const now = Date.now();
  const title = String(input.title ?? "").slice(0, MAX_TITLE_LEN);
  const detail = String(input.detail ?? "").slice(0, MAX_DETAIL_LEN);
  const discomfortRaw = String(input.discomfort ?? "").trim();
  const discomfort = (
    discomfortRaw ||
    (title && detail && !detail.includes(title)
      ? `${title}\n\n${detail}`
      : detail || title)
  ).slice(0, MAX_DETAIL_LEN);
  /** @type {VirtualFeedback} */
  const item = {
    id: randomUUID(),
    personaId: String(input.personaId ?? ""),
    personaName: String(input.personaName ?? ""),
    sessionId: String(input.sessionId ?? ""),
    at: new Date(now).toISOString(),
    createdAtMs: now,
    status: input.status ?? "new",
    severity: input.severity ?? "minor",
    area: String(input.area ?? ""),
    title,
    detail,
    suggestion: String(input.suggestion ?? "").slice(0, MAX_DETAIL_LEN),
    discomfort,
    improvementSummary: String(input.improvementSummary ?? "").slice(
      0,
      MAX_DETAIL_LEN,
    ),
    implementResult: String(input.implementResult ?? "").slice(0, MAX_DETAIL_LEN),
    prompt: String(input.prompt ?? "").slice(0, MAX_PROMPT_LEN),
    implementJobId: null,
    implementQueuedAtMs: null,
    implementDoneAtMs: null,
    preVersionId: null,
    postVersionId: null,
    telegramSentAtMs: null,
    backupCount: 0,
    lastBackupId: null,
    managerScore: null,
    managerDecision: null,
    managerNotes: "",
    managerReviewedAtMs: null,
  };
  store.feedback = trimVirtualFeedbackList([item, ...store.feedback]);
  writeVirtualUserStoreSync(store);
  return { ok: true, item, store };
}

/**
 * 한도 초과 시 approved/queued를 보존하고, 오래된 pending/new·dismissed부터 버림
 * @param {VirtualFeedback[]} list
 */
export function trimVirtualFeedbackList(list) {
  const arr = Array.isArray(list) ? [...list] : [];
  if (arr.length <= MAX_FEEDBACK) return arr;
  const keep = new Set(["approved", "queued"]);
  /** @type {VirtualFeedback[]} */
  const protectedItems = [];
  /** @type {VirtualFeedback[]} */
  const rest = [];
  for (const f of arr) {
    if (keep.has(f.status)) protectedItems.push(f);
    else rest.push(f);
  }
  const room = Math.max(0, MAX_FEEDBACK - protectedItems.length);
  // rest: 최신 우선(앞에 있음) 유지하되 한도 맞춤
  const keptRest = rest.slice(0, room);
  // protected가 앞에 오면 구현 후보가 안 밀림 — approved 먼저, 그다음 최신 rest
  return [...protectedItems, ...keptRest].slice(0, MAX_FEEDBACK);
}

/**
 * @param {string} id
 * @param {Partial<VirtualFeedback>} patch
 */
export function patchVirtualFeedbackSync(id, patch) {
  const store = readVirtualUserStoreSync();
  const idx = store.feedback.findIndex((f) => f.id === id);
  if (idx < 0) return { ok: false, error: "피드백을 찾을 수 없습니다." };
  const merged = normalizeFeedback({ ...store.feedback[idx], ...patch, id });
  if (!merged) return { ok: false, error: "잘못된 피드백입니다." };
  store.feedback[idx] = merged;
  writeVirtualUserStoreSync(store);
  return { ok: true, item: merged, feedback: store.feedback };
}

/** @param {string} id */
export function deleteVirtualFeedbackSync(id) {
  const store = readVirtualUserStoreSync();
  const next = store.feedback.filter((f) => f.id !== id);
  if (next.length === store.feedback.length) {
    return { ok: false, error: "피드백을 찾을 수 없습니다." };
  }
  store.feedback = next;
  writeVirtualUserStoreSync(store);
  return { ok: true, feedback: next };
}

/**
 * @param {VirtualSession} session
 */
export function appendVirtualSessionSync(session) {
  const store = readVirtualUserStoreSync();
  store.sessions = [session, ...store.sessions].slice(0, 100);
  writeVirtualUserStoreSync(store);
  return store;
}

function gitHeadShort() {
  try {
    const root = path.resolve(__dirname, "..");
    return execSync("git rev-parse --short HEAD", {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 피드백 항목 스냅샷 백업 (구현 전/후 보존)
 * @param {string} feedbackId
 */
export function backupVirtualFeedbackSync(feedbackId) {
  const store = readVirtualUserStoreSync();
  const item = store.feedback.find((f) => f.id === feedbackId);
  if (!item) return { ok: false, error: "피드백을 찾을 수 없습니다." };

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const backupId = randomUUID().slice(0, 8);
  const dir = path.join(BACKUPS_DIR, feedbackId, `${stamp}_${backupId}`);
  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    backupId,
    feedbackId,
    createdAtMs: Date.now(),
    createdAtIso: new Date().toISOString(),
    gitHead: gitHeadShort(),
    personaName: item.personaName,
    title: item.title,
    status: item.status,
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "feedback.json"), JSON.stringify(item, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "prompt.txt"), item.prompt || "", "utf8");

  // prune old backups for this feedback
  try {
    const parent = path.join(BACKUPS_DIR, feedbackId);
    const entries = fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    while (entries.length > MAX_BACKUPS_PER_FEEDBACK) {
      const old = entries.shift();
      if (!old) break;
      fs.rmSync(path.join(parent, old), { recursive: true, force: true });
    }
  } catch {
    /* ignore prune errors */
  }

  const patched = patchVirtualFeedbackSync(feedbackId, {
    backupCount: (item.backupCount || 0) + 1,
    lastBackupId: backupId,
  });

  return {
    ok: true,
    backupId,
    dir: path.relative(DATA_DIR, dir).replace(/\\/g, "/"),
    meta,
    item: patched.ok ? patched.item : item,
  };
}

/**
 * @param {string} [feedbackId]
 */
export function listVirtualBackupsSync(feedbackId) {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  /** @type {Array<{ feedbackId: string; stamp: string; meta: object | null; dir: string }>} */
  const out = [];
  const feedbackDirs = feedbackId
    ? [feedbackId].filter((id) => fs.existsSync(path.join(BACKUPS_DIR, id)))
    : fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  for (const fid of feedbackDirs) {
    const parent = path.join(BACKUPS_DIR, fid);
    let stamps = [];
    try {
      stamps = fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
    } catch {
      continue;
    }
    for (const stamp of stamps.slice(0, 30)) {
      const dir = path.join(parent, stamp);
      let meta = null;
      try {
        meta = parseJsonText(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
      } catch {
        meta = null;
      }
      out.push({
        feedbackId: fid,
        stamp,
        meta,
        dir: path.relative(DATA_DIR, dir).replace(/\\/g, "/"),
      });
    }
  }
  return out;
}
