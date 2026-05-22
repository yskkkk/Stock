/**
 * 실매매 프로그램 등록 — 추천 기술 모델과 매매 규칙 연결
 * server/.data/live-trade-programs.json
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getTechModelByIdSync } from "./picks-tech-models-store.js";
import { programHasOnlySimulatedBuyTradesSync } from "./live-trade-portfolio-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const PROGRAMS_FILE = path.join(DATA_DIR, "live-trade-programs.json");

/** @typedef {"draft" | "armed" | "sim" | "paused" | "error"} LiveTradeStatus */

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   modelId: string;
 *   markets: { kr: boolean; us: boolean };
 *   minScoreRatio: number;
 *   maxOpenPositions: number;
 *   orderAmountKrw: number | null;
 *   orderAmountUsd: number | null;
 *   status: LiveTradeStatus;
 *   armedAtMs: number | null;
 *   lastRunAtMs: number | null;
 *   lastError: string | null;
 *   simAutoBuy: boolean;
 *   autoSellAtTarget: boolean;
 *   takeProfitPct: number | null;
 *   stopLossPct: number | null;
 *   createdAtMs: number;
 *   updatedAtMs: number;
 * }} LiveTradeProgram
 */

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {{ programs: LiveTradeProgram[] }} */
function defaultStore() {
  return { programs: [] };
}

/** @returns {{ programs: LiveTradeProgram[] }} */
function readStoreSync() {
  try {
    if (!fs.existsSync(PROGRAMS_FILE)) return defaultStore();
    const o = JSON.parse(fs.readFileSync(PROGRAMS_FILE, "utf8"));
    if (!o || typeof o !== "object" || !Array.isArray(o.programs)) return defaultStore();
    return { programs: o.programs.map(normalizeProgram).filter(Boolean) };
  } catch {
    return defaultStore();
  }
}

function writeStoreSync(store) {
  ensureDirSync();
  fs.writeFileSync(PROGRAMS_FILE, JSON.stringify(store, null, 0), "utf8");
}

/** @param {unknown} v @param {number} min @param {number} max @param {number} fallback */
function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** @param {unknown} raw @returns {LiveTradeProgram | null} */
function normalizeProgram(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const id = String(o.id ?? "").trim();
  if (!id) return null;
  const marketsRaw = o.markets && typeof o.markets === "object" ? o.markets : {};
  const mr = /** @type {Record<string, unknown>} */ (marketsRaw);
  const statusRaw = String(o.status ?? "draft").toLowerCase();
  const status =
    statusRaw === "armed" ||
    statusRaw === "sim" ||
    statusRaw === "paused" ||
    statusRaw === "error"
      ? statusRaw
      : "draft";
  const now = Date.now();
  return {
    id,
    name: String(o.name ?? "").trim() || "실매매 프로그램",
    modelId: String(o.modelId ?? "").trim(),
    markets: {
      kr: Boolean(mr.kr),
      us: Boolean(mr.us),
    },
    minScoreRatio: clampNum(o.minScoreRatio, 0.5, 1, 0.85),
    maxOpenPositions: Math.floor(clampNum(o.maxOpenPositions, 1, 50, 5)),
    orderAmountKrw:
      o.orderAmountKrw == null || o.orderAmountKrw === ""
        ? null
        : clampNum(o.orderAmountKrw, 10_000, 500_000_000, 100_000),
    orderAmountUsd:
      o.orderAmountUsd == null || o.orderAmountUsd === ""
        ? null
        : clampNum(o.orderAmountUsd, 10, 1_000_000, 100),
    status,
    armedAtMs:
      typeof o.armedAtMs === "number" && Number.isFinite(o.armedAtMs)
        ? o.armedAtMs
        : null,
    lastRunAtMs:
      typeof o.lastRunAtMs === "number" && Number.isFinite(o.lastRunAtMs)
        ? o.lastRunAtMs
        : null,
    lastError:
      typeof o.lastError === "string" && o.lastError.trim()
        ? o.lastError.trim().slice(0, 500)
        : null,
    simAutoBuy: o.simAutoBuy === false ? false : true,
    autoSellAtTarget: o.autoSellAtTarget === false ? false : true,
    takeProfitPct:
      o.takeProfitPct == null || o.takeProfitPct === ""
        ? null
        : clampNum(o.takeProfitPct, 0.5, 100, 5),
    stopLossPct: (() => {
      if (o.stopLossPct == null || o.stopLossPct === "") return null;
      const n = Number(o.stopLossPct);
      if (!Number.isFinite(n) || n >= 0) return null;
      return Math.max(-50, Math.min(-0.5, n));
    })(),
    createdAtMs:
      typeof o.createdAtMs === "number" && o.createdAtMs > 0 ? o.createdAtMs : now,
    updatedAtMs:
      typeof o.updatedAtMs === "number" && o.updatedAtMs > 0 ? o.updatedAtMs : now,
  };
}

/** @param {Partial<LiveTradeProgram>} patch */
function validateProgramPatch(patch) {
  const modelId = String(patch.modelId ?? "").trim();
  if (!modelId) throw new Error("기술 분석 모델을 선택하세요.");
  if (!getTechModelByIdSync(modelId)) {
    throw new Error("선택한 모델을 찾을 수 없습니다. 추천 목록에서 모델을 먼저 만드세요.");
  }
  const mk = patch.markets ?? { kr: true, us: false };
  if (!mk.kr && !mk.us) throw new Error("국내 또는 미국 시장을 하나 이상 선택하세요.");
  const name = String(patch.name ?? "").trim();
  if (!name) throw new Error("프로그램 이름이 필요합니다.");
}

export function listLiveTradeProgramsSync() {
  return readStoreSync().programs;
}

export function getLiveTradeProgramSync(id) {
  const sid = String(id ?? "").trim();
  return readStoreSync().programs.find((p) => p.id === sid) ?? null;
}

export function listArmedLiveTradeProgramsSync() {
  return listLiveTradeProgramsSync().filter((p) => p.status === "armed");
}

export function listSimActiveProgramsSync() {
  return listLiveTradeProgramsSync().filter((p) => p.status === "sim");
}

export function startSimLiveTradeProgramSync(id) {
  const prog = getLiveTradeProgramSync(id);
  if (!prog) throw new Error("프로그램을 찾을 수 없습니다.");
  return updateLiveTradeProgramSync(id, {
    status: "sim",
    armedAtMs: Date.now(),
    lastError: null,
  });
}

export function stopSimLiveTradeProgramSync(id) {
  const prog = getLiveTradeProgramSync(id);
  if (!prog) throw new Error("프로그램을 찾을 수 없습니다.");
  return updateLiveTradeProgramSync(id, {
    status: "paused",
    armedAtMs: null,
  });
}

/**
 * @param {{
 *   name: string;
 *   modelId: string;
 *   markets?: { kr?: boolean; us?: boolean };
 *   minScoreRatio?: number;
 *   maxOpenPositions?: number;
 *   orderAmountKrw?: number | null;
 *   orderAmountUsd?: number | null;
 *   simAutoBuy?: boolean;
 *   autoSellAtTarget?: boolean;
 *   takeProfitPct?: number | null;
 *   stopLossPct?: number | null;
 * }} input
 */
export function createLiveTradeProgramSync(input) {
  validateProgramPatch(input);
  const now = Date.now();
  const program = normalizeProgram({
    id: randomUUID(),
    name: input.name,
    modelId: input.modelId,
    markets: {
      kr: input.markets?.kr !== false,
      us: Boolean(input.markets?.us),
    },
    minScoreRatio: input.minScoreRatio,
    maxOpenPositions: input.maxOpenPositions,
    orderAmountKrw: input.orderAmountKrw,
    orderAmountUsd: input.orderAmountUsd,
    status: "draft",
    createdAtMs: now,
    updatedAtMs: now,
  });
  const store = readStoreSync();
  store.programs.push(program);
  writeStoreSync(store);
  return program;
}

/**
 * @param {string} id
 * @param {Partial<LiveTradeProgram>} patch
 */
export function updateLiveTradeProgramSync(id, patch) {
  const store = readStoreSync();
  const idx = store.programs.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("프로그램을 찾을 수 없습니다.");
  const prev = store.programs[idx];
  const next = normalizeProgram({
    ...prev,
    ...patch,
    id: prev.id,
    createdAtMs: prev.createdAtMs,
    updatedAtMs: Date.now(),
  });
  validateProgramPatch(next);
  store.programs[idx] = next;
  writeStoreSync(store);
  return next;
}

export function deleteLiveTradeProgramSync(id) {
  const sid = String(id ?? "").trim();
  const store = readStoreSync();
  const before = store.programs.length;
  store.programs = store.programs.filter((p) => p.id !== sid);
  if (store.programs.length === before) throw new Error("프로그램을 찾을 수 없습니다.");
  writeStoreSync(store);
  return { ok: true };
}

/**
 * @param {string} id
 * @param {{ tossConfigured: boolean; tossMessage?: string }} toss
 */
export function armLiveTradeProgramSync(id, toss) {
  if (!toss.tossConfigured) {
    throw new Error(
      toss.tossMessage ??
        "토스 API 키가 설정되지 않았습니다. 서버 환경 설정에 API 키를 등록한 뒤 재시작하세요.",
    );
  }
  const prog = getLiveTradeProgramSync(id);
  if (!prog) throw new Error("프로그램을 찾을 수 없습니다.");
  return updateLiveTradeProgramSync(id, {
    status: "armed",
    armedAtMs: Date.now(),
    lastError: null,
  });
}

export function disarmLiveTradeProgramSync(id) {
  const prog = getLiveTradeProgramSync(id);
  if (!prog) throw new Error("프로그램을 찾을 수 없습니다.");
  return updateLiveTradeProgramSync(id, {
    status: "paused",
    armedAtMs: null,
  });
}

/**
 * @param {string} id
 * @param {string | null} err
 */
export function touchLiveTradeProgramRunSync(id, err = null) {
  const prog = getLiveTradeProgramSync(id);
  if (!prog) return null;
  const simLane = prog.status === "sim";
  return updateLiveTradeProgramSync(id, {
    lastRunAtMs: Date.now(),
    lastError: err,
    /* 시뮬: 종목별 실패(중복·한도 등)로 전체 상태를 error로 두지 않음 */
    status: err && !simLane ? "error" : simLane ? "sim" : prog.status,
  });
}

/**
 * 시뮬 매수 후 잘못 error로 남은 카드 복구(보유 있음·체결 전부 simulated).
 * @param {LiveTradeProgram[]} programs
 * @param {Record<string, { holdingCount?: number }>} programReturns
 */
export function healStuckSimProgramErrorsSync(programs, programReturns) {
  const out = [];
  for (const p of programs) {
    if (
      p.status === "error" &&
      (programReturns[p.id]?.holdingCount ?? 0) > 0 &&
      programHasOnlySimulatedBuyTradesSync(p.id)
    ) {
      const healed = updateLiveTradeProgramSync(p.id, {
        status: "sim",
        lastError: null,
      });
      out.push(healed ?? p);
      continue;
    }
    out.push(p);
  }
  return out;
}
