import {
  isTelegramNotifyEnabled,
  sendTelegramMessage,
  resolveStockTelegramCreds,
} from "../telegram-notify.js";

/**
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {number} lastPrice
 */
export async function notifyBoxRangeMidEntry(box, program, lastPrice) {
  if (!isTelegramNotifyEnabled()) return false;
  const sym = box.symbol;
  const tf = box.timeframe;
  const text = [
    "<b>📦 박스권 매수 신호</b>",
    "",
    `종목: <b>${sym}</b> (${tf})`,
    `프로그램: ${program.name ?? program.id}`,
    `현재가: ${lastPrice.toFixed(2)}`,
    `매수(중심): ${box.mid.toFixed(2)}`,
    `익절: ${box.top.toFixed(2)}`,
    `손절: ${box.bottom.toFixed(2)}`,
  ].join("\n");
  return sendTelegramMessage(text, undefined, resolveStockTelegramCreds());
}
