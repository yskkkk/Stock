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
import {
  getProgramArmedMarkets,
  validateLiveTradeArmLane,
} from "./live-trade-arm-gate.js";
import { minOrderAmountKrwForMarkets } from "./live-trade-market.js";

/** 신규 매도 전략 반영 버전 — migrate가 올림 */
export const LIVE_TRADE_SELL_SETTINGS_VERSION = 2;

/** @type {{ sellHorizon: "short"; autoSellAtTarget: boolean; takeProfitPct: number; stopLossPct: number }} */
export const LIVE_TRADE_CANONICAL_SELL_SETTINGS = {
  sellHorizon: "short",
  autoSellAtTarget: true,
  takeProfitPct: 5,
  stopLossPct: -3,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const PROGRAMS_FILE = path.join(DATA_DIR, "live-trade-programs.json");

/** 실매매·시뮬 — 모델 가중 점수 최소 비율(만점 대비) 기본값 */
export const LIVE_TRADE_DEFAULT_MIN_SCORE_RATIO = 0.8;

/** @typedef {"draft" | "armed" | "sim" | "paused" | "error"} LiveTradeStatus */

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   modelId: string;
 *   markets: { kr: boolean; us: boolean; crypto: boolean };
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
 *   sellHorizon?: "short" | "medium" | "long";
 *   sellSettingsVersion?: number;
 *   armedMarkets?: { kr: boolean; crypto: boolean };
 *   userId: string | null;
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

export function readProgramsStoreSync() {
  return readStoreSync();
}

export function writeProgramsStoreSync(store) {
  writeStoreSync(store);
}

function writeStoreSync(store) {
  ensureDirSync();
  const tmp = `${PROGRAMS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 0), "utf8");
  fs.renameSync(tmp, PROGRAMS_FILE);
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
      crypto: Boolean(mr.crypto),
    },
    minScoreRatio: clampNum(
      o.minScoreRatio,
      0.5,
      1,
      LIVE_TRADE_DEFAULT_MIN_SCORE_RATIO,
    ),
    maxOpenPositions: Math.floor(clampNum(o.maxOpenPositions, 1, 50, 5)),
    orderAmountKrw:
      o.orderAmountKrw == null || o.orderAmountKrw === ""
        ? null
        : clampNum(
            o.orderAmountKrw,
            minOrderAmountKrwForMarkets(mr),
            500_000_000,
            100_000,
          ),
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
    sellHorizon: (() => {
      const s = String(o.sellHorizon ?? "").toLowerCase().trim();
      if (s === "medium" || s === "long") return s;
      return "short";
    })(),
    sellSettingsVersion: (() => {
      const v = Number(o.sellSettingsVersion);
      return Number.isFinite(v) && v >= 0
        ? Math.floor(v)
        : 0;
    })(),
    armedMarkets: (() => {
      const markets = {
        kr: Boolean(mr.kr),
        us: Boolean(mr.us),
        crypto: Boolean(mr.crypto),
      };
      return getProgramArmedMarkets(
        /** @type {LiveTradeProgram} */ ({
          status,
          markets,
          armedMarkets:
            o.armedMarkets && typeof o.armedMarkets === "object"
              ? o.armedMarkets
              : undefined,
        }),
      );
    })(),
    userId:
      typeof o.userId === "string" && o.userId.trim() ? o.userId.trim() : null,
    createdAtMs:
      typeof o.createdAtMs === "number" && o.createdAtMs > 0 ? o.createdAtMs : now,
    updatedAtMs:
      typeof o.updatedAtMs === "number" && o.updatedAtMs > 0 ? o.updatedAtMs : now,
  };
}

/** @param {string | null | undefined} userId */
function matchesUser(program, userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return true;
  return program.userId === uid;
}

/**
 * @param {string} programId
 * @param {string} userId
 */
export function assertProgramOwnedByUser(programId, userId) {
  const prog = getLiveTradeProgramSync(programId, userId);
  if (!prog) throw new Error("프로그램을 찾을 수 없습니다.");
  return prog;
}

/** @param {Partial<LiveTradeProgram>} patch */
function validateProgramPatch(patch) {
  const modelId = String(patch.modelId ?? "").trim();
  if (!modelId) throw new Error("기술 분석 모델을 선택하세요.");
  if (!getTechModelByIdSync(modelId)) {
    throw new Error("선택한 모델을 찾을 수 없습니다. 추천 목록에서 모델을 먼저 만드세요.");
  }
  const mk = patch.markets ?? { kr: true, us: false, crypto: false };
  if (!mk.kr && !mk.us && !mk.crypto) {
    throw new Error("국내·미국·코인 시장 중 하나 이상 선택하세요.");
  }
  const name = String(patch.name ?? "").trim();
  if (!name) throw new Error("프로그램 이름이 필요합니다.");
  const needsKrw = mk.kr || mk.crypto;
  if (needsKrw) {
    const raw = patch.orderAmountKrw;
    if (raw == null || raw === "") {
      throw new Error("1회 매수 금액을 입력하세요.");
    }
    const n = Number(raw);
    const minKrw = minOrderAmountKrwForMarkets(mk);
    if (!Number.isFinite(n) || n < minKrw) {
      throw new Error(
        mk.crypto
          ? `코인 1회 매수 금액은 ${minKrw.toLocaleString("ko-KR")}원 이상이어야 합니다.`
          : `1회 매수 금액은 ${minKrw.toLocaleString("ko-KR")}원 이상이어야 합니다.`,
      );
    }
  }
}

/** @param {string} [userId] */
export function listLiveTradeProgramsSync(userId) {
  const uid = String(userId ?? "").trim();
  if (uid) migrateLegacyProgramsToUserSync(uid);
  return readStoreSync().programs.filter((p) => matchesUser(p, uid));
}

/**
 * @param {string} id
 * @param {string} [userId]
 */
export function getLiveTradeProgramSync(id, userId) {
  const sid = String(id ?? "").trim();
  const prog = readStoreSync().programs.find((p) => p.id === sid) ?? null;
  if (!prog) return null;
  if (!matchesUser(prog, userId)) return null;
  return prog;
}

/** @param {string} userId */
export function migrateLegacyProgramsToUserSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return { migrated: 0 };
  const store = readStoreSync();
  let n = 0;
  for (const p of store.programs) {
    if (!p.userId) {
      p.userId = uid;
      p.updatedAtMs = Date.now();
      n++;
    }
  }
  if (n > 0) writeStoreSync(store);
  return { migrated: n };
}

export function listArmedLiveTradeProgramsSync() {
  return listLiveTradeProgramsSync().filter((p) => {
    if (p.status !== "armed") return false;
    const am = getProgramArmedMarkets(p);
    return am.kr || am.crypto;
  });
}

export function listSimActiveProgramsSync() {
  return listLiveTradeProgramsSync().filter((p) => p.status === "sim");
}

export function startSimLiveTradeProgramSync(id, userId) {
  const prog = getLiveTradeProgramSync(id, userId);
  if (!prog) throw new Error("프로그램을 찾을 수 없습니다.");
  return updateLiveTradeProgramSync(
    id,
    {
      status: "sim",
      armedAtMs: Date.now(),
      lastError: null,
    },
    userId,
  );
}

export function stopSimLiveTradeProgramSync(id, userId) {
  const prog = getLiveTradeProgramSync(id, userId);
  if (!prog) throw new Error("프로그램을 찾을 수 없습니다.");
  return updateLiveTradeProgramSync(
    id,
    {
      status: "paused",
      armedAtMs: null,
    },
    userId,
  );
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
 *   sellHorizon?: "short" | "medium" | "long";
 * }} input
 */
export function createLiveTradeProgramSync(input, userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");
  const markets = {
    kr:
      input.markets == null || input.markets.kr === undefined
        ? true
        : Boolean(input.markets.kr),
    us: Boolean(input.markets?.us),
    crypto: Boolean(input.markets?.crypto),
  };
  validateProgramPatch({ ...input, markets });
  const now = Date.now();
  const program = normalizeProgram({
    id: randomUUID(),
    userId: uid,
    name: input.name,
    modelId: input.modelId,
    markets: {
      kr:
        input.markets == null || input.markets.kr === undefined
          ? true
          : Boolean(input.markets.kr),
      us: Boolean(input.markets?.us),
      crypto: Boolean(input.markets?.crypto),
    },
    minScoreRatio: input.minScoreRatio,
    maxOpenPositions: input.maxOpenPositions,
    orderAmountKrw: input.orderAmountKrw,
    orderAmountUsd: input.orderAmountUsd,
    simAutoBuy: input.simAutoBuy,
    autoSellAtTarget: input.autoSellAtTarget,
    sellHorizon: input.sellHorizon,
    sellSettingsVersion: LIVE_TRADE_SELL_SETTINGS_VERSION,
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
export function updateLiveTradeProgramSync(id, patch, userId) {
  const store = readStoreSync();
  const idx = store.programs.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("프로그램을 찾을 수 없습니다.");
  const prev = store.programs[idx];
  if (!matchesUser(prev, userId)) throw new Error("프로그램을 찾을 수 없습니다.");
  const markets = {
    kr:
      patch.markets?.kr !== undefined ? Boolean(patch.markets.kr) : prev.markets.kr,
    us:
      patch.markets?.us !== undefined ? Boolean(patch.markets.us) : prev.markets.us,
    crypto:
      patch.markets?.crypto !== undefined
        ? Boolean(patch.markets.crypto)
        : prev.markets.crypto,
  };
  validateProgramPatch({
    ...prev,
    ...patch,
    markets,
    orderAmountKrw:
      patch.orderAmountKrw !== undefined ? patch.orderAmountKrw : prev.orderAmountKrw,
    orderAmountUsd:
      patch.orderAmountUsd !== undefined ? patch.orderAmountUsd : prev.orderAmountUsd,
  });
  const next = normalizeProgram({
    ...prev,
    ...patch,
    id: prev.id,
    userId: prev.userId,
    createdAtMs: prev.createdAtMs,
    updatedAtMs: Date.now(),
  });
  store.programs[idx] = next;
  writeStoreSync(store);
  return next;
}

export function deleteLiveTradeProgramSync(id, userId) {
  const sid = String(id ?? "").trim();
  if (!sid) throw new Error("프로그램 id가 필요합니다.");
  const store = readStoreSync();
  const idx = store.programs.findIndex(
    (p) => p.id === sid && matchesUser(p, userId),
  );
  if (idx < 0) throw new Error("프로그램을 찾을 수 없습니다.");
  store.programs.splice(idx, 1);
  writeStoreSync(store);
  return { ok: true, deletedId: sid };
}

/**
 * @param {string} id
 * @param {"bithumb" | "toss"} lane
 */
export function armLiveTradeProgramLaneSync(id, lane, userId) {
  const prog = getLiveTradeProgramSync(id, userId);
  if (!prog) throw new Error("프로그램을 찾을 수 없습니다.");
  validateLiveTradeArmLane(prog, lane, userId);
  const prev = getProgramArmedMarkets(prog);
  const armedMarkets =
    lane === "bithumb"
      ? { ...prev, crypto: true }
      : { ...prev, kr: true };
  return updateLiveTradeProgramSync(
    id,
    {
      status: "armed",
      armedMarkets,
      armedAtMs: Date.now(),
      lastError: null,
    },
    userId,
  );
}

export function disarmLiveTradeProgramSync(id, userId) {
  const prog = getLiveTradeProgramSync(id, userId);
  if (!prog) throw new Error("프로그램을 찾을 수 없습니다.");
  return updateLiveTradeProgramSync(
    id,
    {
      status: "paused",
      armedMarkets: { kr: false, crypto: false },
      armedAtMs: null,
    },
    userId,
  );
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
      const healed = updateLiveTradeProgramSync(
        p.id,
        {
          status: "sim",
          lastError: null,
        },
        p.userId ?? undefined,
      );
      out.push(healed ?? p);
      continue;
    }
    out.push(p);
  }
  return out;
}

const OWNER_MISSING_ERR = "프로그램 소유자가 없습니다.";

/** userId 귀속 후에도 error로 남은 실매매 카드 복구 */
export function healOwnerMissingProgramErrorsSync(programs) {
  const out = [];
  for (const p of programs) {
    if (
      p.status === "error" &&
      p.userId &&
      p.lastError === OWNER_MISSING_ERR
    ) {
      const am = getProgramArmedMarkets(p);
      const nextStatus = am.kr || am.crypto ? "armed" : "paused";
      const healed = updateLiveTradeProgramSync(
        p.id,
        {
          status: nextStatus,
          lastError: null,
        },
        p.userId,
      );
      out.push(healed ?? p);
      continue;
    }
    out.push(p);
  }
  return out;
}

/** 등록된 모든 프로그램 가중 점수 비율을 동일 값으로 맞춤 */
export function setAllLiveTradeProgramsMinScoreRatioSync(
  ratio = LIVE_TRADE_DEFAULT_MIN_SCORE_RATIO,
) {
  const target = clampNum(ratio, 0.5, 1, LIVE_TRADE_DEFAULT_MIN_SCORE_RATIO);
  const store = readStoreSync();
  const now = Date.now();
  let changed = 0;
  for (const p of store.programs) {
    if (p.minScoreRatio === target) continue;
    p.minScoreRatio = target;
    p.updatedAtMs = now;
    changed += 1;
  }
  if (changed > 0) writeStoreSync(store);
  return changed;
}
