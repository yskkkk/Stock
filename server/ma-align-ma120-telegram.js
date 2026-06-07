import {
  isTelegramNotifyEnabled,
  sendStockTelegramMessage,
} from "./telegram-notify.js";
import { liveTradeLogWarn } from "./live-trade-log.js";

/** @param {string} s */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ma120NearTelegramEnabled() {
  return String(process.env.STOCK_MA120_NEAR_TELEGRAM ?? "1").trim() !== "0";
}

/**
 * @param {number} price
 * @param {number} ma120
 * @param {"kr"|"us"} market
 */
function formatPrice(price, market) {
  const p = Number(price);
  if (!Number.isFinite(p)) return "—";
  if (market === "kr") return `${Math.round(p).toLocaleString("ko-KR")}원`;
  return `$${p.toFixed(2)}`;
}

/**
 * @param {{
 *   symbol: string;
 *   name: string;
 *   market: "kr"|"us";
 *   price: number;
 *   ma120: number;
 *   distancePct: number;
 *   sessionKey: string;
 * }} hit
 */
export function buildMaAlignMa120NearTelegramHtml(hit) {
  const marketKo = hit.market === "kr" ? "국내" : "미국";
  const code = hit.symbol.replace(/\.(KS|KQ)$/i, "");
  const dist = hit.distancePct.toFixed(2);
  return [
    `<b>📐 정배열 · 120일선 근접 · ${marketKo}</b>`,
    `<i>${esc(hit.sessionKey)} · MA 5·20·60·120 정배열</i>`,
    "",
    `<b>${esc(hit.name)}</b> <code>${esc(code)}</code>`,
    `현재가 ${esc(formatPrice(hit.price, hit.market))}`,
    `120일선 ${esc(formatPrice(hit.ma120, hit.market))}`,
    `괴리 ${esc(dist)}%`,
  ].join("\n");
}

/**
 * @param {Parameters<typeof buildMaAlignMa120NearTelegramHtml>[0]} hit
 */
export async function notifyMaAlignMa120NearTelegram(hit) {
  if (!ma120NearTelegramEnabled()) return { sent: false, reason: "disabled" };
  if (!isTelegramNotifyEnabled()) return { sent: false, reason: "telegram_off" };

  const text = buildMaAlignMa120NearTelegramHtml(hit);
  try {
    await sendStockTelegramMessage(text);
    return { sent: true };
  } catch (e) {
    liveTradeLogWarn(
      "[ma-align:ma120:telegram]",
      hit.symbol,
      e instanceof Error ? e.message : e,
    );
    return { sent: false, reason: "send_failed" };
  }
}
