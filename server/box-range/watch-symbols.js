import {
  BOX_RANGE_CRYPTO_HTF_SYMBOLS,
  boxRangeCryptoScanEnabled,
  isBoxRangeCryptoHtfSymbol,
} from "./constants.js";
import { listBoxesForProgramSync } from "./store.js";

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 */
export async function collectWatchSymbolsForProgram(program) {
  const fromBoxes = new Set();
  for (const b of listBoxesForProgramSync(program.id)) {
    if (isBoxRangeCryptoHtfSymbol(b.symbol)) fromBoxes.add(b.symbol);
  }
  if (boxRangeCryptoScanEnabled()) {
    for (const sym of BOX_RANGE_CRYPTO_HTF_SYMBOLS) {
      fromBoxes.add(sym);
    }
  }
  return [...fromBoxes];
}
