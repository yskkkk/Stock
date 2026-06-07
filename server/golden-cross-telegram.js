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

const CROSS_LABEL = {
  "5>20": "5→20",
  "5>60": "5→60",
  "5>120": "5→120",
};

function goldenCrossTelegramEnabled() {
  return String(process.env.STOCK_GOLDEN_CROSS_TELEGRAM ?? "1").trim() !== "0";
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {Array<{ symbol: string; name: string; crosses: string[] }>} hits
 */
export function buildGoldenCrossTelegramHtml(market, scanDate, hits) {
  const marketKo = market === "kr" ? "국내 시총 300" : "S&amp;P 500";
  const lines = [
    `<b>📈 일봉 골든크로스 · ${marketKo}</b>`,
    `<i>${esc(scanDate)} · MA 5·20·60·120</i>`,
    "",
  ];

  if (!hits.length) {
    lines.push("오늘 신규 골든크로스 종목이 없습니다.");
    return lines.join("\n");
  }

  for (const cross of ["5>20", "5>60", "5>120"]) {
    const group = hits.filter((h) => h.crosses.includes(cross));
    if (!group.length) continue;
    lines.push(`<b>${CROSS_LABEL[cross] ?? cross}</b> (${group.length})`);
    for (const h of group.slice(0, 40)) {
      const code = h.symbol.replace(/\.(KS|KQ)$/i, "");
      lines.push(`· ${esc(h.name)} <code>${esc(code)}</code>`);
    }
    if (group.length > 40) {
      lines.push(`… 외 ${group.length - 40}종목`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {Array<{ symbol: string; name: string; crosses: string[] }>} hits
 */
export async function notifyGoldenCrossScanTelegram(market, scanDate, hits) {
  if (!goldenCrossTelegramEnabled()) return { sent: false, reason: "disabled" };
  if (!isTelegramNotifyEnabled()) return { sent: false, reason: "telegram_off" };

  const text = buildGoldenCrossTelegramHtml(market, scanDate, hits);
  try {
    await sendStockTelegramMessage(text);
    return { sent: true };
  } catch (e) {
    liveTradeLogWarn(
      "[golden-cross:telegram]",
      market,
      e instanceof Error ? e.message : e,
    );
    return { sent: false, reason: "send_failed" };
  }
}
