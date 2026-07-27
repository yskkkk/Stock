/**
 * 주식 수량 유니버스 스캔 — KR·US 정규장 마감 후 1회
 */
import { appendServerEventLog } from "./access-log.js";
import { liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import {
  readShareStructureMeta,
  runShareStructureScanForMarket,
} from "./stock-share-structure.js";
import {
  shareStructureScanEnabled,
  shouldRunShareStructureScan,
} from "./stock-share-structure-schedule.js";

const TICK_MS = (() => {
  const n = Number(process.env.STOCK_SHARE_STRUCTURE_TICK_MS ?? 60_000);
  return Number.isFinite(n) && n >= 15_000 ? Math.min(n, 300_000) : 60_000;
})();

/** @type {Record<"kr"|"us", boolean>} */
const marketRunning = { kr: false, us: false };

/**
 * @param {"kr"|"us"} market
 */
async function tickMarket(market) {
  if (marketRunning[market]) return;
  const meta = readShareStructureMeta();
  const lastSessionKey = meta[market]?.lastSessionKey ?? null;
  if (!shouldRunShareStructureScan(market, lastSessionKey)) return;

  marketRunning[market] = true;
  try {
    const result = await pollerGuardAsync(`share-structure-${market}`, () =>
      runShareStructureScanForMarket(market),
    );
    appendServerEventLog(
      "share-structure",
      `${market.toUpperCase()} 마감 스캔 ${result.okCount}/${result.symbolCount} (${result.sessionKey})`,
    );
  } catch (err) {
    liveTradeLogWarn(
      `[share-structure:${market}]`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    marketRunning[market] = false;
  }
}

function tick() {
  if (!shareStructureScanEnabled()) return;
  void tickMarket("kr").catch((e) => {
    liveTradeLogWarn(
      "[share-structure:kr]",
      e instanceof Error ? e.message : e,
    );
  });
  void tickMarket("us").catch((e) => {
    liveTradeLogWarn(
      "[share-structure:us]",
      e instanceof Error ? e.message : e,
    );
  });
}

export function startStockShareStructurePoller() {
  if (!shareStructureScanEnabled()) return;
  const g = /** @type {typeof globalThis & { __stockShareStructurePoller?: boolean }} */ (
    globalThis
  );
  if (g.__stockShareStructurePoller) return;
  g.__stockShareStructurePoller = true;

  tick();
  markPollerBootStarted("share-structure");
  setInterval(tick, TICK_MS);
}
