import { runFinancialsArchiveForMarket } from "./stock-financials-archive.js";
import {
  financialsArchiveEnabled,
  shouldRunFinancialsArchive,
} from "./stock-financials-archive-schedule.js";
import { readFinancialsArchiveMeta } from "./stock-financials-archive-store.js";
import { liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";

const TICK_MS = (() => {
  const n = Number(process.env.STOCK_FINANCIALS_ARCHIVE_TICK_MS ?? 60_000);
  return Number.isFinite(n) && n >= 15_000 ? Math.min(n, 300_000) : 60_000;
})();

/** @type {Record<"kr"|"us", boolean>} */
const marketRunning = { kr: false, us: false };

/**
 * @param {"kr"|"us"} market
 */
async function tickMarket(market) {
  if (marketRunning[market]) return;
  const meta = readFinancialsArchiveMeta();
  const lastSessionKey = meta[market]?.lastSessionKey ?? null;
  if (!shouldRunFinancialsArchive(market, lastSessionKey)) return;

  marketRunning[market] = true;
  try {
    await pollerGuardAsync(`financials-archive-${market}`, () =>
      runFinancialsArchiveForMarket(market),
    );
  } catch (e) {
    liveTradeLogWarn(
      `[financials-archive:${market}]`,
      e instanceof Error ? e.message : e,
    );
  } finally {
    marketRunning[market] = false;
  }
}

function tick() {
  if (!financialsArchiveEnabled()) return;
  void tickMarket("kr");
  void tickMarket("us");
}

export function startFinancialsArchivePoller() {
  if (!financialsArchiveEnabled()) return;
  const g = /** @type {typeof globalThis & { __stockFinancialsArchivePoller?: boolean }} */ (
    globalThis
  );
  if (g.__stockFinancialsArchivePoller) return;
  g.__stockFinancialsArchivePoller = true;

  tick();
  markPollerBootStarted("financials-archive");
  setInterval(tick, TICK_MS);
}
