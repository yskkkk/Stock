import {
  listArmedLiveTradeProgramsSync,
  listSimActiveProgramsSync,
} from "../live-trade-programs-store.js";
import {
  setBithumbWsTickerWanted,
  startBithumbWsTickerHub,
  stopBithumbWsTickerHub,
} from "../bithumb-ws-ticker.js";
import { isBoxRangeProgram } from "./constants.js";
import { collectWatchSymbolsForProgram } from "./watch-symbols.js";
import { scheduleBoxRangeFsmOnWsPrice } from "./ws-fsm.js";

function activeBoxRangePrograms() {
  return [
    ...listSimActiveProgramsSync().filter(isBoxRangeProgram),
    ...listArmedLiveTradeProgramsSync().filter(isBoxRangeProgram),
  ];
}

/** 활성 박스권 프로그램 감시 종목 → WebSocket 구독 갱신 */
export async function syncBoxRangeWsSubscriptions() {
  if (
    process.env.STOCK_BOX_RANGE_WS === "0" ||
    process.env.STOCK_BITHUMB_WS_TICKER === "0"
  ) {
    setBithumbWsTickerWanted([]);
    return;
  }

  const programs = activeBoxRangePrograms();
  if (!programs.length) {
    setBithumbWsTickerWanted([]);
    stopBithumbWsTickerHub();
    return;
  }

  const symbols = new Set();
  for (const p of programs) {
    const syms = await collectWatchSymbolsForProgram(p);
    for (const s of syms) symbols.add(s);
  }

  startBithumbWsTickerHub({
    onPriceUpdate: (yahooSymbol) => {
      scheduleBoxRangeFsmOnWsPrice(yahooSymbol);
    },
  });
  setBithumbWsTickerWanted([...symbols]);
}
