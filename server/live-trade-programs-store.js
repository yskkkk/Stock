/**
 * 실매매 프로그램 등록 — 추천 기술 모델과 매매 규칙 연결
 * server/.data/live-trade-programs.json
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getTechModelByIdSync } from "./picks-tech-models-store.js";
import { programHasOnlySimulatedBuyTradesSync } from "./live-trade-portfolio-store.js";
import {
  getProgramArmedMarkets,
  validateLiveTradeArmLane,
} from "./live-trade-arm-gate.js";
import { minOrderAmountKrwForMarkets } from "./live-trade-market.js";
import {
  findUserByIdSync,
  listUsersSync,
  normalizeUserEmail,
} from "./users-store.js";
import { getCredentialMetaSync } from "./user-credentials-store.js";

/** 신규 매도 전략 반영 버전 — migrate가 올림 */
export const LIVE_TRADE_SELL_SETTINGS_VERSION = 2;

/** @type {{ sellHorizon: "short"; autoSellAtTarget: boolean; takeProfitPct: number; stopLossPct: number }} */
export const LIVE_TRADE_CANONICAL_SELL_SETTINGS = {
  sellHorizon: "short",
  autoSellAtTarget: true,
  takeProfitPct: 5,
  stopLossPct: -3,
};

import {
  readJsonStoreSync,
  writeJsonStoreSync,
  StoreCorruptError,
} from "./store-json.js";

export { StoreCorruptError };

const PROGRAMS_FILE = "live-trade-programs.json";
const MIGRATE_V2_FILE = ".live-trade-account-migrate-v2.json";

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
 *   ownerEmail: string | null;
 *   createdAtMs: number;
 *   updatedAtMs: number;
 * }} LiveTradeProgram
 */

/** @param {string | null | undefined} email */
export function normalizeProgramOwnerEmail(email) {
  const e = normalizeUserEmail(email);
  return e && e.includes("@") ? e : null;
}

/** @returns {{ programs: LiveTradeProgram[] }} */
function defaultStore() {
  return { programs: [] };
}

/** @returns {{ programs: LiveTradeProgram[] }} */
function readStoreSync() {
  return readJsonStoreSync(
    PROGRAMS_FILE,
    (o) => {
      if (!o || typeof o !== "object" || !Array.isArray(o.programs)) {
        return defaultStore();
      }
      return {
        programs: o.programs.map(normalizeProgram).filter(Boolean),
      };
    },
    defaultStore,
  );
}

export function readProgramsStoreSync() {
  return readStoreSync();
}

export function writeProgramsStoreSync(store) {
  writeStoreSync(store);
}

function writeStoreSync(store) {
  writeJsonStoreSync(PROGRAMS_FILE, store);
}

/** @returns {{ doneUserIds: string[] }} */
function readMigrateV2FlagsSync() {
  return readJsonStoreSync(
    MIGRATE_V2_FILE,
    (o) => {
      if (!o || typeof o !== "object") return { doneUserIds: [] };
      const ids = Array.isArray(o.doneUserIds) ? o.doneUserIds : [];
      return {
        doneUserIds: ids.map((x) => String(x).trim()).filter(Boolean),
      };
    },
    () => ({ doneUserIds: [] }),
  );
}

/** @param {string} userId */
function markMigrateV2DoneSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return;
  const flags = readMigrateV2FlagsSync();
  if (flags.doneUserIds.includes(uid)) return;
  flags.doneUserIds.push(uid);
  writeJsonStoreSync(MIGRATE_V2_FILE, flags);
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
    ownerEmail: normalizeProgramOwnerEmail(
      typeof o.ownerEmail === "string" ? o.ownerEmail : null,
    ),
    createdAtMs:
      typeof o.createdAtMs === "number" && o.createdAtMs > 0 ? o.createdAtMs : now,
    updatedAtMs:
      typeof o.updatedAtMs === "number" && o.updatedAtMs > 0 ? o.updatedAtMs : now,
  };
}

/** @param {LiveTradeProgram} program @param {string} userId */
function matchesUserForUser(program, userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return false;
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

/** @param {string} userId @param {string} [ownerEmail] */
export function listLiveTradeProgramsForUserSync(userId, ownerEmail) {
  const uid = String(userId ?? "").trim();
  if (!uid) return [];
  return readStoreSync().programs.filter((p) => matchesUserForUser(p, uid));
}

/** @param {string} [userId] @param {string} [ownerEmail] */
export function listLiveTradeProgramsSync(userId, ownerEmail) {
  return listLiveTradeProgramsForUserSync(userId, ownerEmail);
}

/**
 * @param {string} id
 * @param {string} [userId]
 */
/** @param {string} id */
export function getLiveTradeProgramForRunnerSync(id) {
  const sid = String(id ?? "").trim();
  return readStoreSync().programs.find((p) => p.id === sid) ?? null;
}

export function getLiveTradeProgramSync(id, userId) {
  const prog = getLiveTradeProgramForRunnerSync(id);
  if (!prog) return null;
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  if (!matchesUserForUser(prog, uid)) return null;
  return prog;
}

/**
 * @param {LiveTradeProgram} program
 * @param {{
 *   userId: string;
 *   email: string;
 *   users: ReturnType<typeof listUsersSync>;
 *   soleBithumbUserId: string | null;
 * }} ctx
 * @returns {{ userId: string; ownerEmail: string } | null}
 */
export function resolveProgramAccountMigrationPatch(program, ctx) {
  const uid = ctx.userId;
  const email = ctx.email;
  const pe = normalizeProgramOwnerEmail(program.ownerEmail);
  const pid = String(program.userId ?? "").trim();

  if (!pid) {
    if (pe === email) return { userId: uid, ownerEmail: email };
    if (!pe && ctx.users.length === 1) return { userId: uid, ownerEmail: email };
    return null;
  }

  if (pid !== uid && ctx.users.some((u) => u.id === pid)) {
    return null;
  }

  if (!ctx.users.some((u) => u.id === pid)) {
    if (pe === email) return { userId: uid, ownerEmail: email };
    if (
      !pe &&
      program.markets.crypto &&
      ctx.soleBithumbUserId === uid
    ) {
      return { userId: uid, ownerEmail: email };
    }
  }

  return null;
}

/** @param {string} userId @param {string | null | undefined} ownerEmail */
export function migrateProgramsForAccountSync(userId, ownerEmail) {
  const uid = String(userId ?? "").trim();
  const email = normalizeProgramOwnerEmail(ownerEmail);
  if (!uid || !email) return { migrated: 0, reclaimed: 0 };

  const users = listUsersSync();
  const bithumbUserIds = users
    .filter((u) => getCredentialMetaSync(u.id, "bithumb").configured)
    .map((u) => u.id);
  const soleBithumbUserId =
    bithumbUserIds.length === 1 ? bithumbUserIds[0] : null;

  const store = readStoreSync();
  let migrated = 0;
  let reclaimed = 0;
  let dirty = false;

  for (const p of store.programs) {
    if (!p.ownerEmail && p.userId) {
      const u = findUserByIdSync(p.userId);
      if (u?.email) {
        p.ownerEmail = normalizeProgramOwnerEmail(u.email);
        dirty = true;
      }
    }

    const patch = resolveProgramAccountMigrationPatch(p, {
      userId: uid,
      email,
      users,
      soleBithumbUserId,
    });
    if (!patch) continue;

    const hadUser = Boolean(p.userId);
    p.userId = patch.userId;
    p.ownerEmail = patch.ownerEmail;
    p.updatedAtMs = Date.now();
    dirty = true;
    if (!hadUser) migrated++;
    else reclaimed++;
  }

  if (dirty) writeStoreSync(store);
  return { migrated, reclaimed };
}

/** @param {string} userId @param {string} [ownerEmail] */
export function migrateProgramsForAccountOnceSync(userId, ownerEmail) {
  const uid = String(userId ?? "").trim();
  if (!uid) return { migrated: 0, reclaimed: 0, skipped: true };
  const flags = readMigrateV2FlagsSync();
  if (flags.doneUserIds.includes(uid)) {
    return { migrated: 0, reclaimed: 0, skipped: true };
  }
  const email =
    normalizeProgramOwnerEmail(ownerEmail) ??
    normalizeProgramOwnerEmail(findUserByIdSync(uid)?.email);
  const { migrated, reclaimed } = migrateProgramsForAccountSync(uid, email);
  markMigrateV2DoneSync(uid);
  return { migrated, reclaimed, skipped: false };
}

/** @param {string} userId @param {string} [ownerEmail] */
export function migrateLegacyProgramsToUserSync(userId, ownerEmail) {
  return migrateProgramsForAccountOnceSync(userId, ownerEmail);
}

export function listArmedLiveTradeProgramsForRunnerSync() {
  return readStoreSync().programs.filter((p) => {
    if (p.status !== "armed") return false;
    const am = getProgramArmedMarkets(p);
    return am.kr || am.crypto;
  });
}

export function listSimActiveProgramsForRunnerSync() {
  return readStoreSync().programs.filter((p) => p.status === "sim");
}

export function listArmedLiveTradeProgramsSync() {
  return listArmedLiveTradeProgramsForRunnerSync();
}

export function listSimActiveProgramsSync() {
  return listSimActiveProgramsForRunnerSync();
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
export function createLiveTradeProgramSync(input, userId, ownerEmail) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");
  const owner =
    normalizeProgramOwnerEmail(ownerEmail) ??
    normalizeProgramOwnerEmail(findUserByIdSync(uid)?.email);
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
    ownerEmail: owner,
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

/** @param {string} id @param {Partial<LiveTradeProgram>} patch */
export function updateLiveTradeProgramForRunnerSync(id, patch) {
  const store = readStoreSync();
  const idx = store.programs.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("프로그램을 찾을 수 없습니다.");
  const prev = store.programs[idx];
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

export function updateLiveTradeProgramSync(id, patch, userId) {
  const sid = String(id ?? "").trim();
  const uid = String(userId ?? "").trim();
  if (!uid || !getLiveTradeProgramSync(sid, uid)) {
    throw new Error("프로그램을 찾을 수 없습니다.");
  }
  return updateLiveTradeProgramForRunnerSync(sid, patch);
}

export function deleteLiveTradeProgramSync(id, userId) {
  const sid = String(id ?? "").trim();
  if (!sid) throw new Error("프로그램 id가 필요합니다.");
  const store = readStoreSync();
  const idx = store.programs.findIndex(
    (p) => p.id === sid && matchesUserForUser(p, userId),
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
  const prog = getLiveTradeProgramForRunnerSync(id);
  if (!prog) return null;
  const simLane = prog.status === "sim";
  return updateLiveTradeProgramForRunnerSync(id, {
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
      const healed = p.userId
        ? updateLiveTradeProgramSync(
            p.id,
            { status: "sim", lastError: null },
            p.userId,
          )
        : null;
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
