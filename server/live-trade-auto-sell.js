/**
 * 시뮬 보유 — 목표·손절가 도달 시 지정가로 자동 매도
 */
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";
import {
  getLiveTradeProgramSync,
  listSimActiveProgramsSync,
} from "./live-trade-programs-store.js";
import {
  buildOpenPositionsWithSellTargetsSync,
  recordLiveTradeSellSync,
} from "./live-trade-portfolio-store.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_LIVE_TRADE_AUTO_SELL_MS ?? 45_000);
  return Number.isFinite(n) && n >= 15_000 ? Math.min(n, 120_000) : 45_000;
})();

let started = false;

/**
 * @param {ReturnType<typeof buildOpenPositionsWithSellTargetsSync>[number]} pos
 * @param {number | null} currentPrice
 */
function shouldSellAtTarget(pos, currentPrice) {
  if (currentPrice == null || !Number.isFinite(currentPrice)) return null;
  const target = pos.targetSellPrice;
  const stop = pos.stopLossPrice;
  if (target != null && currentPrice >= target) {
    return { price: target, note: "목표가 도달" };
  }
  if (stop != null && currentPrice <= stop) {
    return { price: stop, note: "손절가 도달" };
  }
  return null;
}

export async function tickLiveTradeAutoSell() {
  const simPrograms = listSimActiveProgramsSync();
  if (!simPrograms.length) return { sold: 0 };

  const positions = buildOpenPositionsWithSellTargetsSync();
  if (!positions.length) return { sold: 0 };

  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const quotes = await fetchQuoteSnapshotsForSymbols(symbols);
  let sold = 0;

  for (const pos of positions) {
    const program = getLiveTradeProgramSync(pos.programId);
    if (!program || program.status !== "sim") continue;
    if (!program.autoSellAtTarget) continue;

    const q = quotes[pos.symbol];
    const current =
      q?.price != null && Number.isFinite(q.price) && q.price > 0 ? q.price : null;
    const hit = shouldSellAtTarget(pos, current);
    if (!hit) continue;

    try {
      recordLiveTradeSellSync({
        programId: pos.programId,
        symbol: pos.symbol,
        market: pos.market,
        quantity: pos.quantity,
        price: hit.price,
        note: hit.note,
        simulated: true,
        atMs: Date.now(),
      });
      sold++;
      console.info(
        "[live-trade:auto-sell]",
        pos.symbol,
        hit.note,
        hit.price,
      );
    } catch (e) {
      console.warn(
        "[live-trade:auto-sell]",
        pos.symbol,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return { sold };
}

export function startLiveTradeAutoSellPoller() {
  if (process.env.STOCK_LIVE_TRADE_AUTO_SELL === "0") return;
  if (started) return;
  started = true;
  const run = () => {
    void tickLiveTradeAutoSell().catch((e) => {
      console.warn(
        "[live-trade:auto-sell]",
        e instanceof Error ? e.message : e,
      );
    });
  };
  run();
  setInterval(run, POLL_MS);
}
