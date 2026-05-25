/**
 * 실매매 프로그램·보유 — 신규 매수/매도(청산) 설정 일괄 반영
 * - 프로그램: 단기 매도·자동매도·목표/손절 % (exit-scenario 기본과 동일)
 * - 열린 포지션: 마지막 매수 체결의 목표가·손절가 재산정
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readProgramsStoreSync,
  writeProgramsStoreSync,
  getLiveTradeProgramSync,
  LIVE_TRADE_SELL_SETTINGS_VERSION,
  LIVE_TRADE_CANONICAL_SELL_SETTINGS,
} from "./live-trade-programs-store.js";
import {
  readPortfolioStoreSync,
  writePortfolioStoreSync,
  buildOpenPositionsWithSellTargetsSync,
} from "./live-trade-portfolio-store.js";
import {
  LIVE_TRADE_EXIT_SCENARIO_VERSION,
  resolveLiveTradeExitTargets,
} from "./live-trade-exit-scenario.js";
import { getRoundTripFeeRateForUserMarketSync } from "./exchange-trading-fees.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");

export { LIVE_TRADE_SELL_SETTINGS_VERSION, LIVE_TRADE_CANONICAL_SELL_SETTINGS };

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @returns {Partial<import("./live-trade-programs-store.js").LiveTradeProgram> | null}
 */
export function buildSellSettingsMigrationPatch(program) {
  const ver = Number(program.sellSettingsVersion ?? 0);
  if (ver >= LIVE_TRADE_SELL_SETTINGS_VERSION) return null;
  return {
    sellHorizon: LIVE_TRADE_CANONICAL_SELL_SETTINGS.sellHorizon,
    autoSellAtTarget: LIVE_TRADE_CANONICAL_SELL_SETTINGS.autoSellAtTarget,
    takeProfitPct:
      program.takeProfitPct != null && Number.isFinite(program.takeProfitPct)
        ? program.takeProfitPct
        : LIVE_TRADE_CANONICAL_SELL_SETTINGS.takeProfitPct,
    stopLossPct:
      program.stopLossPct != null && Number.isFinite(program.stopLossPct)
        ? program.stopLossPct
        : LIVE_TRADE_CANONICAL_SELL_SETTINGS.stopLossPct,
    sellSettingsVersion: LIVE_TRADE_SELL_SETTINGS_VERSION,
    updatedAtMs: Date.now(),
  };
}

/**
 * @returns {{ migrated: number; programIds: string[] }}
 */
export function migrateAllLiveTradeProgramsSellSettingsSync() {
  const store = readProgramsStoreSync();
  /** @type {string[]} */
  const programIds = [];
  let migrated = 0;

  for (let i = 0; i < store.programs.length; i++) {
    const p = store.programs[i];
    const patch = buildSellSettingsMigrationPatch(p);
    if (!patch) continue;
    store.programs[i] = { ...p, ...patch };
    programIds.push(p.id);
    migrated++;
    liveTradeLogInfo("[live-trade:migrate] program sell settings", p.name ?? p.id, {
      sellHorizon: patch.sellHorizon,
      autoSellAtTarget: patch.autoSellAtTarget,
      takeProfitPct: patch.takeProfitPct,
      stopLossPct: patch.stopLossPct,
    });
  }

  if (migrated > 0) writeProgramsStoreSync(store);
  return { migrated, programIds };
}

function positionKey(programId, market, symbol) {
  return `${programId}:${market}:${symbol}`;
}

/**
 * 열린 포지션의 마지막 매수 체결에 목표·손절가 재기록
 * @param {Set<string> | string[] | null} [onlyProgramIds] null이면 전체
 * @returns {Promise<{ updated: number; skipped: number }>}
 */
export async function refreshOpenTradeExitTargetsSync(onlyProgramIds = null) {
  const allow =
    onlyProgramIds == null
      ? null
      : new Set(
          Array.isArray(onlyProgramIds)
            ? onlyProgramIds
            : [...onlyProgramIds],
        );
  const open = buildOpenPositionsWithSellTargetsSync();
  const store = readPortfolioStoreSync();
  let updated = 0;
  let skipped = 0;

  for (const pos of open) {
    if (allow && !allow.has(pos.programId)) {
      skipped++;
      continue;
    }
    const program = getLiveTradeProgramSync(pos.programId);
    if (!program) {
      skipped++;
      continue;
    }
    if (program.autoSellAtTarget === false) {
      skipped++;
      continue;
    }
    const entry = Number(pos.avgEntryPrice);
    if (!Number.isFinite(entry) || entry <= 0) {
      skipped++;
      continue;
    }

    const uid = String(program.userId ?? "").trim();
    const roundTripFeeRate = uid
      ? getRoundTripFeeRateForUserMarketSync(uid, pos.market)
      : undefined;

    let targets;
    try {
      targets = await resolveLiveTradeExitTargets(pos.symbol, entry, {
        market: pos.market,
        signalIds: pos.buySignalIds,
        roundTripFeeRate,
        sellHorizon: program.sellHorizon,
      });
    } catch (e) {
      liveTradeLogWarn(
        "[live-trade:migrate] exit targets failed:",
        pos.symbol,
        e instanceof Error ? e.message : e,
      );
      skipped++;
      continue;
    }

    const key = positionKey(pos.programId, pos.market, pos.symbol);
    let buyIdx = -1;
    for (let i = store.trades.length - 1; i >= 0; i--) {
      const t = store.trades[i];
      if (
        t.side === "buy" &&
        positionKey(t.programId, t.market, t.symbol) === key
      ) {
        buyIdx = i;
        break;
      }
    }
    if (buyIdx < 0) {
      skipped++;
      continue;
    }

    const prev = store.trades[buyIdx];
    store.trades[buyIdx] = {
      ...prev,
      targetSellPrice: targets.targetSellPrice ?? null,
      stopLossPrice: targets.stopLossPrice ?? null,
      exitScenarioNote: targets.exitScenarioNote ?? null,
      entryStructureNote: targets.entryStructureNote ?? prev.entryStructureNote,
      entryIdeal: Boolean(targets.entryIdeal),
      entryKind: targets.entryKind ?? prev.entryKind,
    };
    updated++;
    liveTradeLogInfo("[live-trade:migrate] refreshed exit targets", pos.symbol, {
      programId: pos.programId,
      target: targets.targetSellPrice,
      stop: targets.stopLossPrice,
    });
  }

  if (updated > 0) writePortfolioStoreSync(store);
  return { updated, skipped };
}

let migrateOncePromise = null;
let exitScenarioMigrateOncePromise = null;

/**
 * exit-scenario v3 — 단타/스윙 분리 후 열린 포지션 목표·손절 재산정(1회)
 */
export function ensureLiveTradeExitScenarioMigratedOnce() {
  if (!exitScenarioMigrateOncePromise) {
    exitScenarioMigrateOncePromise = (async () => {
      try {
        const marker = path.join(
          DATA_DIR,
          `.live-trade-exit-scenario-v${LIVE_TRADE_EXIT_SCENARIO_VERSION}.json`,
        );
        if (fs.existsSync(marker)) {
          return { skipped: true, updated: 0 };
        }
        const { updated, skipped } = await refreshOpenTradeExitTargetsSync(null);
        try {
          if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(
            marker,
            JSON.stringify({ updated, skipped, atMs: Date.now() }),
            "utf8",
          );
        } catch {
          /* ignore */
        }
        liveTradeLogInfo("[live-trade:migrate] exit scenario v3 done", {
          updated,
          skipped,
        });
        return { updated, skipped };
      } catch (e) {
        exitScenarioMigrateOncePromise = null;
        throw e;
      }
    })();
  }
  return exitScenarioMigrateOncePromise;
}

/**
 * 서버 기동·API 조회 시 1회 — 프로그램 설정 + 열린 포지션 목표/손절 재산정
 */
export function ensureLiveTradeSellSettingsMigratedOnce() {
  if (!migrateOncePromise) {
    migrateOncePromise = (async () => {
      try {
        const marker = path.join(
          DATA_DIR,
          `.live-trade-sell-settings-v${LIVE_TRADE_SELL_SETTINGS_VERSION}.json`,
        );
        if (fs.existsSync(marker)) {
          return { skipped: true, migrated: 0, updated: 0 };
        }

        const { migrated, programIds } = migrateAllLiveTradeProgramsSellSettingsSync();
        const { updated, skipped } = await refreshOpenTradeExitTargetsSync(
          migrated > 0 ? programIds : null,
        );

        try {
          if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(
            marker,
            JSON.stringify({ migrated, updated, skipped, atMs: Date.now() }),
            "utf8",
          );
        } catch {
          /* ignore marker */
        }
        liveTradeLogInfo("[live-trade:migrate] sell settings v2 done", {
          migrated,
          updated,
          skipped,
        });
        return { migrated, updated, skipped };
      } catch (e) {
        migrateOncePromise = null;
        throw e;
      }
    })();
  }
  return migrateOncePromise;
}
