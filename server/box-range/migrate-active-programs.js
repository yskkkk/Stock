/**
 * 실행 중(armed·sim) 실매매 프로그램 → 박스권(1h·4h·1d) 모델 일괄 전환
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
const FLAG_FILE = path.join(__dirname, "../.data/.box-range-active-programs-migrated.json");

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
  fs.writeFileSync(FLAG_FILE, JSON.stringify(payload, null, 0), "utf8");
}

/** @param {import("../live-trade-programs-store.js").LiveTradeProgram} program */
export function buildBoxRangeActiveProgramPatch(program) {
  if (isBoxRangeProgram(program)) return null;
  const patch = {
    modelId: BOX_RANGE_MODEL_ID,
    markets: { kr: false, us: false, crypto: true },
    autoSellAtTarget: false,
    lastError: null,
    updatedAtMs: Date.now(),
  };
  if (program.status === "armed") {
    const am = getProgramArmedMarkets(program);
    return {
      ...patch,
      armedMarkets: { kr: false, crypto: am.crypto || program.markets?.crypto },
    };
  }
  return patch;
}

/**
 * @returns {{ migrated: number; programIds: string[]; skipped: string[] }}
 */
export function migrateRunningProgramsToBoxRangeSync() {
  const store = readProgramsStoreSync();
  /** @type {string[]} */
  const programIds = [];
  /** @type {string[]} */
  const skipped = [];
  let migrated = 0;

  for (const p of store.programs) {
    if (p.status !== "armed" && p.status !== "sim") continue;
    const patch = buildBoxRangeActiveProgramPatch(p);
    if (!patch) {
      skipped.push(p.id);
      continue;
    }
    updateLiveTradeProgramForRunnerSync(p.id, patch);
    programIds.push(p.id);
    migrated++;
    liveTradeLogInfo("[box-range:migrate] active program → box-range", p.name ?? p.id, {
      status: p.status,
      fromModel: p.modelId,
    });
  }

  return { migrated, programIds, skipped };
}

/**
 * @param {{ force?: boolean }} [opts]
 */
export function ensureRunningProgramsBoxRangeMigratedOnce(opts = {}) {
  const force = Boolean(opts.force);
  const flag = readFlagSync();
  if (!force && flag?.done) {
    return Promise.resolve({ ...flag, skippedRun: true });
  }
  const result = migrateRunningProgramsToBoxRangeSync();
  const payload = {
    done: true,
    atMs: Date.now(),
    ...result,
  };
  writeFlagSync(payload);
  return Promise.resolve(payload);
}
