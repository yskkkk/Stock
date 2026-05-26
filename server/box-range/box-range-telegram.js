import { liveTradeCurrency } from "../live-trade-market.js";
import {
  isTelegramNotifyEnabled,
  sendTelegramMessage,
  resolveStockTelegramCreds,
} from "../telegram-notify.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";

/**
 * @param {number} n
 * @param {"kr"|"us"|"crypto"} market
 */
function fmtBoxPrice(n, market) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const cur = liveTradeCurrency(market);
  if (cur === "USD") {
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (v >= 1000) {
    return `${Math.round(v).toLocaleString("ko-KR")}원`;
  }
  return `${v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
}

/**
 * 박스권 종료 후 하단 이탈·평행선(중심) 터치 매수 — 텔레그램 1회 알림
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {number} lastPrice
 * @param {"kr"|"us"|"crypto"} market
 */
export async function notifyBoxRangeMidEntry(box, program, lastPrice, market) {
  if (!isTelegramNotifyEnabled()) {
    liveTradeLogWarn(
      "[box-range:telegram]",
      "TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID 미설정 — 알림 생략",
      box.symbol,
    );
    return false;
  }
  const sym = box.symbol;
  const tf = box.timeframe;
  const st = program.status === "armed" ? "실매매" : "시뮬";
  const text = [
    "<b>📦 박스권 매수(평행선)</b>",
    "",
    `종목: <b>${sym}</b> · ${tf}`,
    `프로그램: ${program.name ?? program.id} (${st})`,
    `현재가: ${fmtBoxPrice(lastPrice, market)}`,
    `평행선(중심): <b>${fmtBoxPrice(box.mid, market)}</b>`,
    `익절(상단): ${fmtBoxPrice(box.top, market)}`,
    `손절(하단): ${fmtBoxPrice(box.bottom, market)}`,
    "",
    "조건: 박스 종료 후 하단 이탈·평행선 터치",
  ].join("\n");
  const ok = await sendTelegramMessage(text, undefined, resolveStockTelegramCreds());
  if (ok) {
    liveTradeLogInfo("[box-range:telegram]", "sent", program.name, sym, tf, box.mid);
  } else {
    liveTradeLogWarn("[box-range:telegram]", "send failed", program.name, sym, tf);
  }
  return ok;
}
