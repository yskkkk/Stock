import { liveTradeCurrency } from "../live-trade-market.js";
import { resolveDisplayName } from "../names-ko.js";
import {
  isTelegramNotifyEnabled,
  sendStockTelegramMessage,
} from "../telegram-notify.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";
import { readSymbolCatalogSync, resolveCatalogRootDir } from "./catalog-store.js";

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
 * 박스권 종료 후 하단 이탈 → 하단 위로 복귀 매수(PRO v2) — 텔레그램 1회 알림
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {number} lastPrice
 * @param {"kr"|"us"|"crypto"} market
 */
export async function notifyBoxRangeDipRecoveryEntry(box, program, lastPrice, market) {
  if (!isTelegramNotifyEnabled()) {
    liveTradeLogWarn(
      "[box-range:telegram]",
      "TELEGRAM_BOT_TOKEN·TELEGRAM_CHANNEL_ID(또는 CHAT_ID) 미설정 — 알림 생략",
      box.symbol,
    );
    return false;
  }
  const sym = box.symbol;
  const cat =
    market === "crypto"
      ? null
      : readSymbolCatalogSync(
          sym,
          market,
          resolveCatalogRootDir(),
        );
  const displayName =
    market === "crypto" ? sym : resolveDisplayName(sym, cat?.name);
  const tf = box.timeframe;
  const st = program.status === "armed" ? "실매매" : "시뮬";
  const dip = Number(box.dipLow);
  const dipOk = Number.isFinite(dip) && dip > 0;
  const slPct = box.bottom > 0 && lastPrice > 0
    ? (((lastPrice - box.bottom) / lastPrice) * 100).toFixed(2)
    : null;
  const tpPct = box.top > 0 && lastPrice > 0
    ? (((box.top - lastPrice) / lastPrice) * 100).toFixed(2)
    : null;
  const text = [
    "<b>📦 박스권 매수(PRO v2)</b>",
    "",
    `종목: <b>${displayName}</b> · ${sym} · ${tf}`,
    `프로그램: ${program.name ?? program.id} (${st})`,
    `예상체결가(현재가): <b>${fmtBoxPrice(lastPrice, market)}</b>`,
    `익절(상단): ${fmtBoxPrice(box.top, market)}${tpPct != null ? ` (+${tpPct}%)` : ""}`,
    `손절(하단): ${fmtBoxPrice(box.bottom, market)}${slPct != null ? ` (-${slPct}%)` : ""}`,
    ...(dipOk && Math.abs(dip - box.bottom) / box.bottom > 0.001
      ? [`dip 최저: ${fmtBoxPrice(dip, market)}`]
      : []),
    "",
    "조건: 박스 종료 후 하단 이탈 → 하단 위로 복귀",
  ].join("\n");
  const ok = await sendStockTelegramMessage(text, undefined);
  if (ok) {
    liveTradeLogInfo("[box-range:telegram]", "sent", program.name, sym, tf, box.mid);
  } else {
    liveTradeLogWarn("[box-range:telegram]", "send failed", program.name, sym, tf);
  }
  return ok;
}
