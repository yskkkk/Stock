import { MA_CROSS_KINDS } from "./golden-cross-detect.js";
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

const CROSS_GROUP_ORDER = [...MA_CROSS_KINDS];

const TIMEFRAME_LABEL = {
  "1d": "일봉",
  "1wk": "주봉",
};

function goldenCrossTelegramEnabled() {
  return String(process.env.STOCK_GOLDEN_CROSS_TELEGRAM ?? "1").trim() !== "0";
}

const MARKET_LABEL = {
  kr: "국내 시총 상위",
  us: "미국 S&amp;P500",
  all: "국내 시총 상위 · 미국 S&amp;P500",
};

const SCAN_TRIGGER_LABEL = {
  manual: "수동 탐색",
  scheduled: "자동 탐색",
};

const MARKET_SHORT_LABEL = {
  kr: "국내",
  us: "미국",
};

const SCAN_KIND_LABEL = {
  goldenCross: "골든크로스",
  maAlign: "정배열",
  ma120Near: "120선 근처",
  bookAccum: "매집봉",
  bottomCandle: "바닥캔들",
  lowSlopeFlip: "저점기울기",
};

const MARKET_ORDER = ["kr", "us"];
const TIMEFRAME_ORDER = ["1d", "1wk"];
const KIND_ORDER = ["goldenCross", "maAlign", "ma120Near", "lowSlopeFlip", "bookAccum", "bottomCandle"];

/**
 * @param {number} ms
 */
export function formatScanDurationMs(ms) {
  const totalSec = Math.max(0, Math.round(Number(ms) / 1000));
  if (totalSec < 60) return `${totalSec}초`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec ? `${min}분 ${sec}초` : `${min}분`;
}

/**
 * @typedef {{
 *   market: "kr"|"us";
 *   timeframe: import("./vault-scan-timeframe.js").VaultScanTimeframe;
 *   kind: "goldenCross"|"maAlign"|"ma120Near"|"bookAccum"|"bottomCandle"|"lowSlopeFlip";
 *   durationMs: number;
 *   hitCount?: number;
 *   ok: boolean;
 * }} VaultScanTimingRow
 */

/**
 * @param {VaultScanTimingRow[]} rows
 */
function sortAndGroupScanTimingRows(rows) {
  const sorted = [...rows].sort((a, b) => {
    const mi = MARKET_ORDER.indexOf(a.market) - MARKET_ORDER.indexOf(b.market);
    if (mi) return mi;
    const ti = TIMEFRAME_ORDER.indexOf(a.timeframe) - TIMEFRAME_ORDER.indexOf(b.timeframe);
    if (ti) return ti;
    return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  });

  /** @type {Array<{ market: "kr"|"us"; timeframe: import("./vault-scan-timeframe.js").VaultScanTimeframe; items: VaultScanTimingRow[] }>} */
  const groups = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.market === row.market && last.timeframe === row.timeframe) {
      last.items.push(row);
    } else {
      groups.push({
        market: row.market,
        timeframe: row.timeframe,
        items: [row],
      });
    }
  }
  return groups;
}

/**
 * @param {VaultScanTimingRow[]} rows
 * @param {(group: { market: "kr"|"us"; timeframe: import("./vault-scan-timeframe.js").VaultScanTimeframe; items: VaultScanTimingRow[] }) => string[]} [renderGroup]
 */
function buildScanDoneTelegramHtmlFromRows(
  title,
  opts,
  rows,
  renderGroup,
) {
  const triggerKo = SCAN_TRIGGER_LABEL[opts.trigger] ?? "탐색";
  const datePart = opts.scanDate ? `${esc(opts.scanDate)} · ` : "";
  const lines = [
    `<b>${title}</b>`,
    `<i>${datePart}${triggerKo} · 총 ${formatScanDurationMs(opts.totalDurationMs)}</i>`,
    "",
  ];

  for (const group of sortAndGroupScanTimingRows(rows)) {
    const tfKo = TIMEFRAME_LABEL[group.timeframe] ?? group.timeframe;
    const marketKo = MARKET_SHORT_LABEL[group.market] ?? group.market;
    lines.push(`<b>${marketKo} · ${tfKo}</b>`);
    if (renderGroup) {
      lines.push(...renderGroup(group));
    } else {
      for (const row of group.items) {
        const label = SCAN_KIND_LABEL[row.kind] ?? row.kind;
        const dur = formatScanDurationMs(row.durationMs);
        if (row.ok) {
          lines.push(`· ${label} ${dur} · ${row.hitCount ?? 0}건`);
        } else {
          lines.push(`· ${label} ${dur} · 실패`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * @param {{ trigger: "manual"|"scheduled"; market?: "kr"|"us"|"all"; scanDate?: string }} opts
 */
export function buildVaultScanStartTelegramHtml(opts) {
  const triggerKo = SCAN_TRIGGER_LABEL[opts.trigger] ?? "탐색";
  const marketKo = MARKET_LABEL[opts.market ?? "all"] ?? MARKET_LABEL.all;
  const lines = [
    `<b>🔍 종목보관 탐색 시작</b>`,
    opts.scanDate
      ? `<i>${esc(opts.scanDate)} · ${triggerKo}</i>`
      : `<i>${triggerKo}</i>`,
    "",
    `<b>대상</b> ${marketKo}`,
    "<b>항목</b>",
    "· 일봉 — 골든크로스, 정배열, 120선 근처(±3%), 저점 기울기 전환, 매집봉",
    "· 주봉 — 골든크로스, 정배열, 매집봉",
  ];
  return lines.join("\n");
}

/**
 * @param {Parameters<typeof buildVaultScanStartTelegramHtml>[0]} opts
 */
export async function notifyVaultScanStartTelegram(opts) {
  if (!goldenCrossTelegramEnabled()) return { sent: false, reason: "disabled" };
  if (!isTelegramNotifyEnabled()) return { sent: false, reason: "telegram_off" };

  const text = buildVaultScanStartTelegramHtml(opts);
  try {
    await sendStockTelegramMessage(text);
    return { sent: true };
  } catch (e) {
    liveTradeLogWarn(
      "[golden-cross:telegram:start]",
      opts.market ?? "all",
      e instanceof Error ? e.message : e,
    );
    return { sent: false, reason: "send_failed" };
  }
}

/**
 * @param {{ trigger: "manual"|"scheduled"; scanDate?: string }} opts
 */
export function buildBottomCandleScanStartTelegramHtml(opts) {
  const triggerKo = SCAN_TRIGGER_LABEL[opts.trigger] ?? "탐색";
  const lines = [
    `<b>🔍 바닥캔들 탐색 시작</b>`,
    opts.scanDate
      ? `<i>${esc(opts.scanDate)} · ${triggerKo}</i>`
      : `<i>${triggerKo}</i>`,
    "",
    `<b>대상</b> ${MARKET_LABEL.all}`,
    "<b>항목</b> 일봉·주봉 세력 바닥 3캔들",
  ];
  return lines.join("\n");
}

/**
 * @param {Parameters<typeof buildBottomCandleScanStartTelegramHtml>[0]} opts
 */
export async function notifyBottomCandleScanStartTelegram(opts) {
  if (!goldenCrossTelegramEnabled()) return { sent: false, reason: "disabled" };
  if (!isTelegramNotifyEnabled()) return { sent: false, reason: "telegram_off" };

  const text = buildBottomCandleScanStartTelegramHtml(opts);
  try {
    await sendStockTelegramMessage(text);
    return { sent: true };
  } catch (e) {
    liveTradeLogWarn(
      "[bottom-candle:telegram:start]",
      e instanceof Error ? e.message : e,
    );
    return { sent: false, reason: "send_failed" };
  }
}

/**
 * @param {{
 *   trigger: "manual"|"scheduled";
 *   market?: "kr"|"us"|"all";
 *   scanDate?: string;
 *   totalDurationMs: number;
 *   rows: VaultScanTimingRow[];
 * }} opts
 */
export function buildVaultScanDoneTelegramHtml(opts) {
  return buildScanDoneTelegramHtmlFromRows(
    "✅ 종목보관 탐색 완료",
    opts,
    opts.rows,
  );
}

/**
 * @param {Parameters<typeof buildVaultScanDoneTelegramHtml>[0]} opts
 */
export async function notifyVaultScanDoneTelegram(opts) {
  if (!goldenCrossTelegramEnabled()) return { sent: false, reason: "disabled" };
  if (!isTelegramNotifyEnabled()) return { sent: false, reason: "telegram_off" };
  if (!opts.rows?.length) return { sent: false, reason: "empty" };

  const text = buildVaultScanDoneTelegramHtml(opts);
  try {
    await sendStockTelegramMessage(text);
    return { sent: true };
  } catch (e) {
    liveTradeLogWarn(
      "[golden-cross:telegram:done]",
      opts.market ?? "all",
      e instanceof Error ? e.message : e,
    );
    return { sent: false, reason: "send_failed" };
  }
}

/**
 * @param {{
 *   trigger: "manual"|"scheduled";
 *   scanDate?: string;
 *   totalDurationMs: number;
 *   rows: VaultScanTimingRow[];
 * }} opts
 */
export function buildBottomCandleScanDoneTelegramHtml(opts) {
  return buildScanDoneTelegramHtmlFromRows(
    "✅ 바닥캔들 탐색 완료",
    opts,
    opts.rows,
  );
}

/**
 * @param {Parameters<typeof buildBottomCandleScanDoneTelegramHtml>[0]} opts
 */
export async function notifyBottomCandleScanDoneTelegram(opts) {
  if (!goldenCrossTelegramEnabled()) return { sent: false, reason: "disabled" };
  if (!isTelegramNotifyEnabled()) return { sent: false, reason: "telegram_off" };
  if (!opts.rows?.length) return { sent: false, reason: "empty" };

  const text = buildBottomCandleScanDoneTelegramHtml(opts);
  try {
    await sendStockTelegramMessage(text);
    return { sent: true };
  } catch (e) {
    liveTradeLogWarn(
      "[bottom-candle:telegram:done]",
      e instanceof Error ? e.message : e,
    );
    return { sent: false, reason: "send_failed" };
  }
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
    `<i>${esc(scanDate)} · 5↔20·60·120 · 20↔120 · ${tfKo}</i>`,
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
