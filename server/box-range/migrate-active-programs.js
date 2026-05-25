/**
 * 실매매 프로그램 → 박스권(1h·4h·1d) 시나리오 일괄 적용
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOX_RANGE_MODEL_ID, isBoxRangeProgram } from "./constants.js";
import { getProgramArmedMarkets } from "../live-trade-arm-gate.js";
import {
  readProgramsStoreSync,
  updateLiveTradeProgramForRunnerSync,
} from "../live-trade-programs-store.js";
import { liveTradeLogInfo } from "../live-trade-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLAG_FILE = path.join(
  __dirname,
  "../.data/.box-range-scenario-rollout-v2.json",
);
export const BOX_RANGE_SCENARIO_VERSION = 2;

function readFlagSync() {
  try {
    if (!fs.existsSync(FLAG_FILE)) return null;
    return JSON.parse(fs.readFileSync(FLAG_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeFlagSync(payload) {
  const dir = path.dirname(FLAG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${FLAG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 0), "utf8");
  fs.renameSync(tmp, FLAG_FILE);
}

/**
 * 코인 전용 vs 미국(S&P500) 박스권 트랙
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 */
export function resolveBoxRangeMarketsForProgram(program) {
  const mk = program.markets ?? {};
  return {
    kr: Boolean(mk.kr),
    us: Boolean(mk.us),
    crypto: Boolean(mk.crypto),
  };
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 */
export function buildBoxRangeScenarioPatch(program) {
  const markets = resolveBoxRangeMarketsForProgram(program);
  /** @type {Record<string, unknown>} */
  const patch = {
    modelId: BOX_RANGE_MODEL_ID,
    markets,
    autoSellAtTarget: false,
    lastError: null,
    updatedAtMs: Date.now(),
  };
  if (program.status === "armed") {
    const am = getProgramArmedMarkets(program);
    patch.armedMarkets = {
      kr: markets.kr && (am.kr || Boolean(program.markets?.kr)),
      crypto: markets.crypto && (am.crypto || Boolean(program.markets?.crypto)),
    };
  }
  return patch;
}

/** @deprecated — 실행 중만; v2는 전체 프로그램 */
export function buildBoxRangeActiveProgramPatch(program) {
  if (isBoxRangeProgram(program)) {
    return buildBoxRangeScenarioPatch(program);
  }
  return buildBoxRangeScenarioPatch(program);
}

/**
 * 저장소의 모든 실매매 프로그램에 박스권 시나리오 적용
 * @returns {{ migrated: number; programIds: string[]; skipped: string[]; details: object[] }}
 */
export function migrateAllLiveTradeProgramsToBoxRangeSync() {
  const store = readProgramsStoreSync();
  /** @type {string[]} */
  const programIds = [];
  /** @type {string[]} */
  const skipped = [];
  /** @type {object[]} */
  const details = [];
  let migrated = 0;

  for (const p of store.programs) {
    const patch = buildBoxRangeScenarioPatch(p);
    const sameModel =
      p.modelId === patch.modelId &&
      p.autoSellAtTarget === patch.autoSellAtTarget &&
      p.markets?.kr === patch.markets.kr &&
      p.markets?.us === patch.markets.us &&
      p.markets?.crypto === patch.markets.crypto;
    if (sameModel && isBoxRangeProgram(p)) {
      skipped.push(p.id);
      continue;
    }
    updateLiveTradeProgramForRunnerSync(p.id, patch);
    programIds.push(p.id);
    migrated++;
    details.push({
      id: p.id,
      name: p.name,
      status: p.status,
      fromModel: p.modelId,
      markets: patch.markets,
    });
    liveTradeLogInfo("[box-range:rollout] program → box-range v2", p.name ?? p.id, {
      status: p.status,
      markets: patch.markets,
    });
  }

  return { migrated, programIds, skipped, details };
}

/** @param {{ force?: boolean }} [opts] */
export function migrateRunningProgramsToBoxRangeSync() {
  const store = readProgramsStoreSync();
  let migrated = 0;
  const programIds = [];
  const skipped = [];
  for (const p of store.programs) {
    if (p.status !== "armed" && p.status !== "sim") continue;
    const patch = buildBoxRangeScenarioPatch(p);
    updateLiveTradeProgramForRunnerSync(p.id, patch);
    programIds.push(p.id);
    migrated++;
  }
  return { migrated, programIds, skipped };
}

/**
 * @param {{ force?: boolean; sendEmail?: boolean; emailDryRun?: boolean; emailForce?: boolean }} [opts]
 */
export async function ensureBoxRangeScenarioRolloutOnce(opts = {}) {
  const force = Boolean(opts.force);
  const flag = readFlagSync();
  if (!force && flag?.version >= BOX_RANGE_SCENARIO_VERSION && flag?.done) {
    return { ...flag, skippedRun: true };
  }

  const migrate = migrateAllLiveTradeProgramsToBoxRangeSync();
  /** @type {Record<string, unknown>} */
  const payload = {
    done: true,
    version: BOX_RANGE_SCENARIO_VERSION,
    atMs: Date.now(),
    ...migrate,
  };

  let emailResult = null;
  if (opts.sendEmail) {
    const { sendBoxRangeStrategyEmailToLiveTradeUsers } = await import(
      "../notifications/box-range-strategy-email.js"
    );
    emailResult = await sendBoxRangeStrategyEmailToLiveTradeUsers({
      dryRun: Boolean(opts.emailDryRun),
      force: Boolean(opts.emailForce),
    });
    payload.email = emailResult;
  }

  writeFlagSync(payload);
  return payload;
}

/** @param {{ force?: boolean }} [opts] */
export function ensureRunningProgramsBoxRangeMigratedOnce(opts = {}) {
  return ensureBoxRangeScenarioRolloutOnce({
    force: opts.force,
    sendEmail: false,
  });
}
