import {
  listArmedLiveTradeProgramsSync,
  listSimActiveProgramsSync,
} from "../live-trade-programs-store.js";
import {
  isBoxRangeCryptoHtfManaged,
  isBoxRangeCryptoHtfSymbol,
  isBoxRangeProgram,
} from "./constants.js";
import {
  fetchBoxRangeLastPrices,
  isBoxRangeQuoteFresh,
} from "./quotes.js";
import { pickQuoteFromMap } from "../quote-symbol-resolve.js";
import { listBoxesForProgramSync } from "./store.js";
import { processBoxFsmForProgram } from "./runner-fsm.js";
import { liveTradeLogWarn } from "../live-trade-log.js";

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const debounceBySymbol = new Map();

const FSM_DEBOUNCE_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_WS_FSM_MS ?? 80);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 500) : 80;
})();

function activeBoxRangePrograms() {
  return [
    ...listSimActiveProgramsSync().filter(isBoxRangeProgram),
    ...listArmedLiveTradeProgramsSync().filter(isBoxRangeProgram),
  ];
}

/**
 * WebSocket 체결가 수신 시 해당 종목 박스만 FSM (탐지는 폴러 담당)
 * @param {string} yahooSymbol
 */
export function scheduleBoxRangeFsmOnWsPrice(yahooSymbol) {
  if (process.env.STOCK_BOX_RANGE_WS === "0") return;
  const sym = String(yahooSymbol ?? "").trim().toUpperCase();
  if (!sym || !isBoxRangeCryptoHtfSymbol(sym)) return;
  const prev = debounceBySymbol.get(sym);
  if (prev) clearTimeout(prev);
  if (FSM_DEBOUNCE_MS <= 0) {
    void runBoxRangeFsmForSymbol(sym).catch(logFsmErr);
    return;
  }
  debounceBySymbol.set(
    sym,
    setTimeout(() => {
      debounceBySymbol.delete(sym);
      void runBoxRangeFsmForSymbol(sym).catch(logFsmErr);
    }, FSM_DEBOUNCE_MS),
  );
}

function logFsmErr(e) {
  liveTradeLogWarn(
    "[box-range:ws-fsm]",
    e instanceof Error ? e.message : e,
  );
}

/**
 * @param {string} symbol
 */
export async function runBoxRangeFsmForSymbol(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const programs = activeBoxRangePrograms();
  if (!programs.length) return;

  const quotes = await fetchBoxRangeLastPrices([sym]);
  const q = pickQuoteFromMap(quotes, sym, "crypto");
  if (!isBoxRangeQuoteFresh(q)) return;
  const lastPrice = Number(q?.price);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return;

  for (const program of programs) {
    if (!program.markets?.crypto) continue;
    const live = program.status === "armed";
    const sim = program.status === "sim";
    if (!live && !sim) continue;

    const boxes = listBoxesForProgramSync(program.id, sym);
    for (const box of boxes) {
      if (box.state === "closed" || box.tradeEligible === false) continue;
      if (!isBoxRangeCryptoHtfManaged(box.symbol, box.timeframe)) continue;
      await processBoxFsmForProgram(program, box, lastPrice, live);
    }
  }
}
