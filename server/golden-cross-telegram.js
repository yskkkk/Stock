import {
  LEGACY_MA_CROSS_KINDS,
  MA_CROSS_KINDS,
} from "./golden-cross-detect.js";
import {
  isTelegramNotifyEnabled,
  sendStockTelegramMessage,
} from "./telegram-notify.js";
import { liveTradeLogWarn } from "./live-trade-log.js";
import { normalizeVaultScanTimeframe } from "./vault-scan-timeframe.js";

/** @param {string} s */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const CROSS_LABEL = {
  "5>20": "5→20 골든",
  "5<20": "5→20 데드",
  "20>120": "20→120 골든",
  "20<120": "20→120 데드",
  "5>60": "5→60 골든",
  "5>120": "5→120 골든",
};

const CROSS_GROUP_ORDER = [...MA_CROSS_KINDS, ...LEGACY_MA_CROSS_KINDS];

const TIMEFRAME_LABEL = {
  "1d": "일봉",
  "1wk": "주봉",
};

function goldenCrossTelegramEnabled() {
  return String(process.env.STOCK_GOLDEN_CROSS_TELEGRAM ?? "1").trim() !== "0";
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {Array<{ symbol: string; name: string; crosses: string[] }>} hits
 * @param {import("./vault-scan-timeframe.js").VaultScanTimeframe} [timeframe]
 */
export function buildGoldenCrossTelegramHtml(
  market,
  scanDate,
  hits,
  timeframe = "1d",
) {
  const tf = normalizeVaultScanTimeframe(timeframe);
  const tfKo = TIMEFRAME_LABEL[tf] ?? "일봉";
  const marketKo = market === "kr" ? "국내 시총 300" : "S&amp;P 500";
  const lines = [
    `<b>📈 ${tfKo} MA 교차 · ${marketKo}</b>`,
    `<i>${esc(scanDate)} · 5↔20 · 20↔120 · ${tfKo}</i>`,
    "",
  ];

  if (!hits.length) {
    lines.push(`오늘 신규 ${tfKo} MA 교차 종목이 없습니다.`);
    return lines.join("\n");
  }

  for (const cross of CROSS_GROUP_ORDER) {
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
 * @param {import("./vault-scan-timeframe.js").VaultScanTimeframe} [timeframe]
 */
export async function notifyGoldenCrossScanTelegram(
  market,
  scanDate,
  hits,
  timeframe = "1d",
) {
  if (!goldenCrossTelegramEnabled()) return { sent: false, reason: "disabled" };
  if (!isTelegramNotifyEnabled()) return { sent: false, reason: "telegram_off" };

  const text = buildGoldenCrossTelegramHtml(market, scanDate, hits, timeframe);
  try {
    await sendStockTelegramMessage(text);
    return { sent: true };
  } catch (e) {
    liveTradeLogWarn(
      "[golden-cross:telegram]",
      market,
      timeframe,
      e instanceof Error ? e.message : e,
    );
    return { sent: false, reason: "send_failed" };
  }
}

const IX_CROSS_LABEL = { ...CROSS_LABEL };

/**
 * @param {{
 *   market: "kr"|"us";
 *   scanDate: string;
 *   goldenCross: Array<{ daily: { symbol: string; name: string; crosses?: string[] }; weekly: { crosses?: string[] } }>;
 *   maAlign: Array<{ daily: { symbol: string; name: string } }>;
 * }} intersection
 */
export function buildVaultIntersectionTelegramHtml(intersection) {
  const marketKo = intersection.market === "kr" ? "국내 시총 300" : "S&amp;P 500";
  const lines = [
    `<b>🔗 일봉·주봉 교집합 · ${marketKo}</b>`,
    `<i>${esc(intersection.scanDate)} · 일봉·주봉 모두 탐지된 종목</i>`,
    "",
  ];
  const gc = intersection.goldenCross ?? [];
  const ma = intersection.maAlign ?? [];
  if (!gc.length && !ma.length) {
    lines.push("교집합 종목이 없습니다.");
    return lines.join("\n");
  }
  if (gc.length) {
    lines.push(`<b>골든크로스 (${gc.length})</b>`);
    for (const pair of gc.slice(0, 25)) {
      const code = pair.daily.symbol.replace(/\.(KS|KQ)$/i, "");
      const d = (pair.daily.crosses ?? [])
        .map((c) => IX_CROSS_LABEL[c] ?? c)
        .join("·");
      const w = (pair.weekly.crosses ?? [])
        .map((c) => IX_CROSS_LABEL[c] ?? c)
        .join("·");
      lines.push(
        `· ${esc(pair.daily.name)} <code>${esc(code)}</code> 일${d || "—"} 주${w || "—"}`,
      );
    }
    if (gc.length > 25) lines.push(`… 외 ${gc.length - 25}종목`);
    lines.push("");
  }
  if (ma.length) {
    lines.push(`<b>정배열 (${ma.length})</b>`);
    for (const pair of ma.slice(0, 25)) {
      const code = pair.daily.symbol.replace(/\.(KS|KQ)$/i, "");
      lines.push(`· ${esc(pair.daily.name)} <code>${esc(code)}</code>`);
    }
    if (ma.length > 25) lines.push(`… 외 ${ma.length - 25}종목`);
  }
  return lines.join("\n").trim();
}

/**
 * @param {Parameters<typeof buildVaultIntersectionTelegramHtml>[0]} intersection
 */
export async function notifyVaultTimeframeIntersectionTelegram(intersection) {
  if (!goldenCrossTelegramEnabled()) return { sent: false, reason: "disabled" };
  if (!isTelegramNotifyEnabled()) return { sent: false, reason: "telegram_off" };
  const gc = intersection.goldenCross?.length ?? 0;
  const ma = intersection.maAlign?.length ?? 0;
  if (!gc && !ma) return { sent: false, reason: "empty" };

  const text = buildVaultIntersectionTelegramHtml(intersection);
  try {
    await sendStockTelegramMessage(text);
    return { sent: true };
  } catch (e) {
    liveTradeLogWarn(
      "[golden-cross:telegram:intersection]",
      intersection.market,
      e instanceof Error ? e.message : e,
    );
    return { sent: false, reason: "send_failed" };
  }
}
