import { loadCryptoWatchlistTen } from "../crypto-universe.js";
import { listBoxesForProgramSync } from "./store.js";

const MAX_SYMBOLS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_MAX_SYMBOLS ?? 10);
  return Number.isFinite(n) && n >= 3 ? Math.min(n, 20) : 10;
})();

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 */
export async function collectWatchSymbolsForProgram(program) {
  const fromBoxes = new Set(
    listBoxesForProgramSync(program.id).map((b) => b.symbol),
  );
  try {
    const uni = await loadCryptoWatchlistTen();
    for (const a of uni.assets.slice(0, MAX_SYMBOLS)) {
      fromBoxes.add(a.symbol);
    }
  } catch {
    fromBoxes.add("BTC-USDT");
  }
  return [...fromBoxes].slice(0, MAX_SYMBOLS);
}
