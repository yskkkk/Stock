import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { DEFAULT_AUDIT_REPORT_TO } from "./box-range-v2-audit-report.js";
import {
  enrichScanEmailMarkets,
  formatScanEmailHitLine,
  scanEmailHitCells,
} from "./golden-cross-scan-email-enrich.js";
import { listUsersSync, getUserNotificationEmailSync } from "../users-store.js";
import { normalizeVaultScanTimeframe } from "../vault-scan-timeframe.js";
import { MA_CROSS_KINDS } from "../golden-cross-detect.js";
import { buildEmailTimeframeIntersections } from "../vault-scan-intersection.js";

export { DEFAULT_AUDIT_REPORT_TO };

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

/** @param {import("../vault-scan-timeframe.js").VaultScanTimeframe | undefined} tf */
function timeframeLabel(tf) {
  const key = normalizeVaultScanTimeframe(tf);
  return TIMEFRAME_LABEL[key] ?? "일봉";
}

/**
 * @typedef {{
 *   market: "kr"|"us";
 *   scanDate: string;
 *   timeframe?: import("../vault-scan-timeframe.js").VaultScanTimeframe;
 *   scanned: number;
 *   hits: Array<{ symbol: string; name: string; crosses: string[] }>;
 * }} GoldenCrossEmailMarket
 */

/**
 * @typedef {{
 *   market: "kr"|"us";
 *   scanDate: string;
 *   timeframe?: import("../vault-scan-timeframe.js").VaultScanTimeframe;
 *   scanned: number;
 *   hits: Array<{ symbol: string; name: string }>;
 * }} MaAlignEmailMarket
 */

/**
 * @typedef {{
 *   market: "kr"|"us";
 *   scanDate: string;
 *   timeframe?: import("../vault-scan-timeframe.js").VaultScanTimeframe;
 *   scanned: number;
 *   hits: Array<{
 *     symbol: string;
 *     name: string;
 *     distancePct?: number;
 *     ma120Approach?: string;
 *     ma120Side?: string;
 *   }>;
 * }} Ma120NearEmailMarket
 */

/**
 * @typedef {{
 *   market: "kr"|"us";
 *   scanDate: string;
 *   timeframe?: import("../vault-scan-timeframe.js").VaultScanTimeframe;
 *   scanned: number;
 *   hits: Array<{
 *     symbol: string;
 *     name: string;
 *     signalDate?: string;
 *     accumScore?: number;
 *     accumRvol?: number;
 *   }>;
 * }} BookAccumEmailMarket
 */

/**
 * @typedef {{
 *   market: "kr"|"us";
 *   scanDate: string;
 *   timeframe?: import("../vault-scan-timeframe.js").VaultScanTimeframe;
 *   scanned: number;
 *   hits: Array<{
 *     symbol: string;
 *     name: string;
 *     signalDate?: string;
 *     bottomTag?: string;
 *     bottomScore?: number;
 *     bottomRvol?: number;
 *   }>;
 * }} BottomCandleEmailMarket
 */

const EMAIL_TABLE_HEAD =
  `<tr style="background:#f1f5f9"><th>종목</th><th>코드</th><th>현재가</th><th>등락률</th><th>업종</th></tr>`;

const MA120_TABLE_HEAD =
  `<tr style="background:#f1f5f9"><th>종목</th><th>코드</th><th>현재가</th><th>등락률</th><th>120선 거리</th><th>접근</th><th>업종</th></tr>`;

const SIGNAL_TABLE_HEAD =
  `<tr style="background:#f1f5f9"><th>종목</th><th>코드</th><th>현재가</th><th>등락률</th><th>점수</th><th>RVOL</th><th>신호일</th><th>업종</th></tr>`;

const BOTTOM_TABLE_HEAD =
  `<tr style="background:#f1f5f9"><th>종목</th><th>코드</th><th>현재가</th><th>등락률</th><th>태그</th><th>점수</th><th>RVOL</th><th>신호일</th><th>업종</th></tr>`;

/** @param {string | undefined} approach */
function formatMa120ApproachLabel(approach) {
  if (approach === "from_below") return "하단접근";
  if (approach === "from_above") return "상단접근";
  return "—";
}

/** @param {number | undefined} n */
function formatOptionalNumber(n, digits = 1) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

/** @param {import("./golden-cross-scan-email-enrich.js").ScanEmailHit} h @param {"kr"|"us"} market */
function renderHitRowHtml(h, market) {
  const cells = scanEmailHitCells(h, market);
  const chgNum = Number(h.changePercent);
  const chgStyle =
    Number.isFinite(chgNum) && chgNum >= 0
      ? "color:#15803d;font-weight:600"
      : Number.isFinite(chgNum)
        ? "color:#b91c1c;font-weight:600"
        : "";
  return `<tr>
<td>${escapeHtml(cells.name)}</td>
<td>${escapeHtml(cells.code)}</td>
<td style="text-align:right;font-family:monospace">${escapeHtml(cells.price)}</td>
<td style="text-align:right;font-family:monospace;${chgStyle}">${escapeHtml(cells.change)}</td>
<td>${escapeHtml(cells.industry)}</td>
</tr>`;
}

/** @returns {string[]} */
export function listGoldenCrossEmailRecipientsSync() {
  const adminOnly =
    String(process.env.STOCK_GOLDEN_CROSS_EMAIL_ALL_MEMBERS ?? "0").trim() === "1";
  if (!adminOnly) {
    const to = String(
      process.env.STOCK_GOLDEN_CROSS_EMAIL_TO ?? DEFAULT_AUDIT_REPORT_TO,
    ).trim();
    return to ? [to] : [];
  }
  const out = new Set();
  for (const user of listUsersSync()) {
    const email = getUserNotificationEmailSync(user);
    if (email) out.add(email);
  }
  const fallback = String(
    process.env.STOCK_GOLDEN_CROSS_EMAIL_TO ?? DEFAULT_AUDIT_REPORT_TO,
  ).trim();
  if (fallback) out.add(fallback);
  return [...out];
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {Record<import("../vault-scan-timeframe.js").VaultScanTimeframe, {
 *   goldenCross: { scanned: number; hits: GoldenCrossEmailMarket["hits"] };
 *   maAlign: { scanned: number; hits: MaAlignEmailMarket["hits"] };
 *   ma120Near?: { scanned: number; hits: Ma120NearEmailMarket["hits"] };
 *   bookAccum?: { scanned: number; hits: BookAccumEmailMarket["hits"] };
 * }>} byTimeframe
 */
export function buildScanEmailPayloadFromVaultResult(market, scanDate, byTimeframe) {
  /** @type {GoldenCrossEmailMarket[]} */
  const goldenCross = [];
  /** @type {MaAlignEmailMarket[]} */
  const maAlign = [];
  /** @type {Ma120NearEmailMarket[]} */
  const ma120Near = [];
  /** @type {BookAccumEmailMarket[]} */
  const bookAccum = [];
  for (const tf of /** @type {const} */ (["1d", "1wk"])) {
    const block = byTimeframe?.[tf];
    if (!block) continue;
    goldenCross.push({
      market,
      scanDate,
      timeframe: tf,
      scanned: block.goldenCross.scanned,
      hits: block.goldenCross.hits,
    });
    maAlign.push({
      market,
      scanDate,
      timeframe: tf,
      scanned: block.maAlign.scanned,
      hits: block.maAlign.hits,
    });
    if (tf === "1d" && block.ma120Near) {
      ma120Near.push({
        market,
        scanDate,
        timeframe: "1d",
        scanned: block.ma120Near.scanned,
        hits: block.ma120Near.hits,
      });
    }
    if (block.bookAccum) {
      bookAccum.push({
        market,
        scanDate,
        timeframe: tf,
        scanned: block.bookAccum.scanned,
        hits: block.bookAccum.hits,
      });
    }
  }
  return { goldenCross, maAlign, ma120Near, bookAccum };
}

/**
 * @param {GoldenCrossEmailMarket[]} markets
 */
function buildGoldenCrossSection(markets) {
  /** @type {string[]} */
  const textParts = ["[MA 교차] 5→20·60·120 · 5↔20·20↔120 (골든·데드)", ""];
  /** @type {string[]} */
  const htmlParts = [`<h2 style="color:#1e40af;">골든크로스</h2>`];

  for (const block of markets) {
    const marketKo = block.market === "kr" ? "국내 시총 300" : "S&P 500";
    const tfKo = timeframeLabel(block.timeframe);
    textParts.push(`${marketKo} · ${tfKo} · ${block.scanDate} · ${block.hits.length}건`);
    htmlParts.push(
      `<h3>${marketKo} · <strong>${tfKo}</strong> <small style="color:#64748b">${block.scanDate} · ${block.hits.length}건</small></h3>`,
    );
    if (!block.hits.length) {
      textParts.push("· 없음", "");
      htmlParts.push("<p>없음</p>");
      continue;
    }
    for (const cross of CROSS_GROUP_ORDER) {
      const group = block.hits.filter((h) => h.crosses.includes(cross));
      if (!group.length) continue;
      const label = CROSS_LABEL[cross] ?? cross;
      textParts.push(`  ${label} (${group.length})`);
      htmlParts.push(`<h4>${label} (${group.length})</h4>`);
      htmlParts.push(
        `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.85em;margin-bottom:16px;width:100%;">${EMAIL_TABLE_HEAD}`,
      );
      for (const h of group) {
        textParts.push(`  ${formatScanEmailHitLine(h, block.market)}`);
        htmlParts.push(renderHitRowHtml(h, block.market));
      }
      htmlParts.push("</table>");
    }
    textParts.push("");
  }
  return { textParts, htmlParts };
}

/**
 * @param {MaAlignEmailMarket[]} markets
 */
function buildMaAlignSection(markets) {
  /** @type {string[]} */
  const textParts = ["[정배열] MA5>20>60>120", ""];
  /** @type {string[]} */
  const htmlParts = [`<h2 style="color:#1e40af;">정배열</h2>`];

  for (const block of markets) {
    const marketKo = block.market === "kr" ? "국내 시총 300" : "S&P 500";
    const tfKo = timeframeLabel(block.timeframe);
    textParts.push(`${marketKo} · ${tfKo} · ${block.scanDate} · ${block.hits.length}건`);
    htmlParts.push(
      `<h3>${marketKo} · <strong>${tfKo}</strong> <small style="color:#64748b">${block.scanDate} · ${block.hits.length}건</small></h3>`,
    );
    if (!block.hits.length) {
      textParts.push("· 없음", "");
      htmlParts.push("<p>없음</p>");
      continue;
    }
    htmlParts.push(
      `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.85em;margin-bottom:16px;width:100%;">${EMAIL_TABLE_HEAD}`,
    );
    for (const h of block.hits) {
      textParts.push(formatScanEmailHitLine(h, block.market));
      htmlParts.push(renderHitRowHtml(h, block.market));
    }
    htmlParts.push("</table>");
    textParts.push("");
  }
  return { textParts, htmlParts };
}

/** @param {import("./golden-cross-scan-email-enrich.js").ScanEmailHit} h @param {"kr"|"us"} market */
function renderMa120HitRowHtml(h, market) {
  const cells = scanEmailHitCells(h, market);
  const chgNum = Number(h.changePercent);
  const chgStyle =
    Number.isFinite(chgNum) && chgNum >= 0
      ? "color:#15803d;font-weight:600"
      : Number.isFinite(chgNum)
        ? "color:#b91c1c;font-weight:600"
        : "";
  const dist = Number(h.distancePct);
  const distText = Number.isFinite(dist) ? `${dist.toFixed(2)}%` : "—";
  return `<tr>
<td>${escapeHtml(cells.name)}</td>
<td>${escapeHtml(cells.code)}</td>
<td style="text-align:right;font-family:monospace">${escapeHtml(cells.price)}</td>
<td style="text-align:right;font-family:monospace;${chgStyle}">${escapeHtml(cells.change)}</td>
<td style="text-align:right;font-family:monospace">${escapeHtml(distText)}</td>
<td>${escapeHtml(formatMa120ApproachLabel(h.ma120Approach))}</td>
<td>${escapeHtml(cells.industry)}</td>
</tr>`;
}

/** @param {import("./golden-cross-scan-email-enrich.js").ScanEmailHit} h @param {"kr"|"us"} market */
function renderSignalHitRowHtml(h, market) {
  const cells = scanEmailHitCells(h, market);
  const chgNum = Number(h.changePercent);
  const chgStyle =
    Number.isFinite(chgNum) && chgNum >= 0
      ? "color:#15803d;font-weight:600"
      : Number.isFinite(chgNum)
        ? "color:#b91c1c;font-weight:600"
        : "";
  const score = h.accumScore ?? h.bottomScore;
  const rvol = h.accumRvol ?? h.bottomRvol;
  const signalDate = h.signalDate ?? "—";
  return `<tr>
<td>${escapeHtml(cells.name)}</td>
<td>${escapeHtml(cells.code)}</td>
<td style="text-align:right;font-family:monospace">${escapeHtml(cells.price)}</td>
<td style="text-align:right;font-family:monospace;${chgStyle}">${escapeHtml(cells.change)}</td>
<td style="text-align:right;font-family:monospace">${escapeHtml(formatOptionalNumber(score, 0))}</td>
<td style="text-align:right;font-family:monospace">${escapeHtml(formatOptionalNumber(rvol, 2))}</td>
<td>${escapeHtml(signalDate)}</td>
<td>${escapeHtml(cells.industry)}</td>
</tr>`;
}

/** @param {import("./golden-cross-scan-email-enrich.js").ScanEmailHit} h @param {"kr"|"us"} market */
function renderBottomHitRowHtml(h, market) {
  const cells = scanEmailHitCells(h, market);
  const chgNum = Number(h.changePercent);
  const chgStyle =
    Number.isFinite(chgNum) && chgNum >= 0
      ? "color:#15803d;font-weight:600"
      : Number.isFinite(chgNum)
        ? "color:#b91c1c;font-weight:600"
        : "";
  return `<tr>
<td>${escapeHtml(cells.name)}</td>
<td>${escapeHtml(cells.code)}</td>
<td style="text-align:right;font-family:monospace">${escapeHtml(cells.price)}</td>
<td style="text-align:right;font-family:monospace;${chgStyle}">${escapeHtml(cells.change)}</td>
<td>${escapeHtml(h.bottomTag?.trim() || "—")}</td>
<td style="text-align:right;font-family:monospace">${escapeHtml(formatOptionalNumber(h.bottomScore, 0))}</td>
<td style="text-align:right;font-family:monospace">${escapeHtml(formatOptionalNumber(h.bottomRvol, 2))}</td>
<td>${escapeHtml(h.signalDate ?? "—")}</td>
<td>${escapeHtml(cells.industry)}</td>
</tr>`;
}

/**
 * @param {Ma120NearEmailMarket[]} markets
 */
function buildMa120NearSection(markets) {
  /** @type {string[]} */
  const textParts = ["[120선 근처] 일봉 MA120 ±3% 이내", ""];
  /** @type {string[]} */
  const htmlParts = [`<h2 style="color:#1e40af;">120선 근처</h2>`];

  for (const block of markets) {
    const marketKo = block.market === "kr" ? "국내 시총 300" : "S&P 500";
    const tfKo = timeframeLabel(block.timeframe);
    textParts.push(`${marketKo} · ${tfKo} · ${block.scanDate} · ${block.hits.length}건`);
    htmlParts.push(
      `<h3>${marketKo} · <strong>${tfKo}</strong> <small style="color:#64748b">${block.scanDate} · ${block.hits.length}건</small></h3>`,
    );
    if (!block.hits.length) {
      textParts.push("· 없음", "");
      htmlParts.push("<p>없음</p>");
      continue;
    }
    htmlParts.push(
      `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.85em;margin-bottom:16px;width:100%;">${MA120_TABLE_HEAD}`,
    );
    for (const h of block.hits) {
      const line = formatScanEmailHitLine(h, block.market);
      const dist = Number(h.distancePct);
      const distText = Number.isFinite(dist) ? `${dist.toFixed(2)}%` : "—";
      textParts.push(
        `${line} · 120선 ${distText} · ${formatMa120ApproachLabel(h.ma120Approach)}`,
      );
      htmlParts.push(renderMa120HitRowHtml(h, block.market));
    }
    htmlParts.push("</table>");
    textParts.push("");
  }
  return { textParts, htmlParts };
}

/**
 * @param {BookAccumEmailMarket[]} markets
 */
function buildBookAccumSection(markets) {
  /** @type {string[]} */
  const textParts = ["[매집봉] 책 매집봉 탐지", ""];
  /** @type {string[]} */
  const htmlParts = [`<h2 style="color:#1e40af;">매집봉</h2>`];

  for (const block of markets) {
    const marketKo = block.market === "kr" ? "국내 시총 300" : "S&P 500";
    const tfKo = timeframeLabel(block.timeframe);
    textParts.push(`${marketKo} · ${tfKo} · ${block.scanDate} · ${block.hits.length}건`);
    htmlParts.push(
      `<h3>${marketKo} · <strong>${tfKo}</strong> <small style="color:#64748b">${block.scanDate} · ${block.hits.length}건</small></h3>`,
    );
    if (!block.hits.length) {
      textParts.push("· 없음", "");
      htmlParts.push("<p>없음</p>");
      continue;
    }
    htmlParts.push(
      `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.85em;margin-bottom:16px;width:100%;">${SIGNAL_TABLE_HEAD}`,
    );
    for (const h of block.hits) {
      textParts.push(
        `${formatScanEmailHitLine(h, block.market)} · 점수 ${formatOptionalNumber(h.accumScore, 0)} · RVOL ${formatOptionalNumber(h.accumRvol, 2)} · ${h.signalDate ?? "—"}`,
      );
      htmlParts.push(renderSignalHitRowHtml(h, block.market));
    }
    htmlParts.push("</table>");
    textParts.push("");
  }
  return { textParts, htmlParts };
}

/**
 * @param {BottomCandleEmailMarket[]} markets
 */
function buildBottomCandleSection(markets) {
  /** @type {string[]} */
  const textParts = ["[바닥캔들] 세력 바닥 3캔들 탐지", ""];
  /** @type {string[]} */
  const htmlParts = [`<h2 style="color:#1e40af;">바닥캔들</h2>`];

  for (const block of markets) {
    const marketKo = block.market === "kr" ? "국내 시총 300" : "S&P 500";
    const tfKo = timeframeLabel(block.timeframe);
    textParts.push(`${marketKo} · ${tfKo} · ${block.scanDate} · ${block.hits.length}건`);
    htmlParts.push(
      `<h3>${marketKo} · <strong>${tfKo}</strong> <small style="color:#64748b">${block.scanDate} · ${block.hits.length}건</small></h3>`,
    );
    if (!block.hits.length) {
      textParts.push("· 없음", "");
      htmlParts.push("<p>없음</p>");
      continue;
    }
    htmlParts.push(
      `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.85em;margin-bottom:16px;width:100%;">${BOTTOM_TABLE_HEAD}`,
    );
    for (const h of block.hits) {
      textParts.push(
        `${formatScanEmailHitLine(h, block.market)} · ${h.bottomTag ?? "—"} · 점수 ${formatOptionalNumber(h.bottomScore, 0)} · RVOL ${formatOptionalNumber(h.bottomRvol, 2)} · ${h.signalDate ?? "—"}`,
      );
      htmlParts.push(renderBottomHitRowHtml(h, block.market));
    }
    htmlParts.push("</table>");
    textParts.push("");
  }
  return { textParts, htmlParts };
}

/**
 * @param {Array<{ market: "kr"|"us"; scanDate: string; goldenCross: Array<{ daily: { symbol: string; name: string; crosses?: string[] }; weekly: { crosses?: string[] } }>; maAlign: Array<{ daily: { symbol: string; name: string } }> }>} intersections
 */
function buildIntersectionSection(intersections) {
  /** @type {string[]} */
  const textParts = ["[일봉·주봉 교집합] 동일 종목이 일봉·주봉 모두 탐지", ""];
  /** @type {string[]} */
  const htmlParts = [
    `<h2 style="color:#7c3aed;">일봉·주봉 교집합</h2>`,
    `<p style="color:#64748b;font-size:0.9em">아래 종목은 <strong>일봉과 주봉 모두</strong> 해당 조건을 만족합니다.</p>`,
  ];

  let any = false;
  for (const block of intersections) {
    const marketKo = block.market === "kr" ? "국내 시총 300" : "S&P 500";
    const gcCount = block.goldenCross?.length ?? 0;
    const maCount = block.maAlign?.length ?? 0;
    if (!gcCount && !maCount) continue;
    any = true;
    textParts.push(`${marketKo} · ${block.scanDate}`);
    htmlParts.push(
      `<h3>${marketKo} <small style="color:#64748b">${block.scanDate}</small></h3>`,
    );

    if (gcCount) {
      textParts.push(`  골든크로스 교집합 (${gcCount})`);
      htmlParts.push(`<h4>골든크로스 (${gcCount})</h4>`);
      htmlParts.push(
        `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.85em;margin-bottom:16px;width:100%;"><tr style="background:#f1f5f9"><th>종목</th><th>일봉 교차</th><th>주봉 교차</th></tr>`,
      );
      for (const pair of block.goldenCross) {
        const dCross = (pair.daily.crosses ?? [])
          .map((c) => CROSS_LABEL[c] ?? c)
          .join(", ");
        const wCross = (pair.weekly.crosses ?? [])
          .map((c) => CROSS_LABEL[c] ?? c)
          .join(", ");
        textParts.push(
          `  · ${pair.daily.name} (${pair.daily.symbol}) · 일봉 ${dCross || "—"} · 주봉 ${wCross || "—"}`,
        );
        htmlParts.push(
          `<tr><td>${escapeHtml(pair.daily.name)}</td><td>${escapeHtml(dCross || "—")}</td><td>${escapeHtml(wCross || "—")}</td></tr>`,
        );
      }
      htmlParts.push("</table>");
    }

    if (maCount) {
      textParts.push(`  정배열 교집합 (${maCount})`);
      htmlParts.push(`<h4>정배열 (${maCount})</h4>`);
      htmlParts.push(
        `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.85em;margin-bottom:16px;width:100%;">${EMAIL_TABLE_HEAD}`,
      );
      for (const pair of block.maAlign) {
        textParts.push(
          `  · ${pair.daily.name} (${pair.daily.symbol}) · 일봉·주봉 정배열`,
        );
        htmlParts.push(renderHitRowHtml(pair.daily, block.market));
      }
      htmlParts.push("</table>");
    }
    textParts.push("");
  }

  if (!any) {
    textParts.push("· 없음", "");
    htmlParts.push("<p>없음</p>");
  }
  return { textParts, htmlParts };
}

/**
 * @param {{
 *   goldenCross?: GoldenCrossEmailMarket[];
 *   maAlign?: MaAlignEmailMarket[];
 *   ma120Near?: Ma120NearEmailMarket[];
 *   bookAccum?: BookAccumEmailMarket[];
 *   bottomCandle?: BottomCandleEmailMarket[];
 *   intersections?: ReturnType<typeof buildEmailTimeframeIntersections>;
 * }} input
 */
export function buildGoldenCrossScanEmailContent(input) {
  const goldenCross = Array.isArray(input.goldenCross) ? input.goldenCross : [];
  const maAlign = Array.isArray(input.maAlign) ? input.maAlign : [];
  const ma120Near = Array.isArray(input.ma120Near) ? input.ma120Near : [];
  const bookAccum = Array.isArray(input.bookAccum) ? input.bookAccum : [];
  const bottomCandle = Array.isArray(input.bottomCandle) ? input.bottomCandle : [];
  const intersections =
    input.intersections ?? buildEmailTimeframeIntersections(goldenCross, maAlign);
  const goldenCrossHits = goldenCross.reduce((s, m) => s + m.hits.length, 0);
  const maAlignHits = maAlign.reduce((s, m) => s + m.hits.length, 0);
  const ma120NearHits = ma120Near.reduce((s, m) => s + m.hits.length, 0);
  const bookAccumHits = bookAccum.reduce((s, m) => s + m.hits.length, 0);
  const bottomCandleHits = bottomCandle.reduce((s, m) => s + m.hits.length, 0);
  const intersectionGc = intersections.reduce(
    (s, m) => s + (m.goldenCross?.length ?? 0),
    0,
  );
  const intersectionMa = intersections.reduce(
    (s, m) => s + (m.maAlign?.length ?? 0),
    0,
  );
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const subject = `[YSTOCK] 탐색 리포트 — 골든 ${goldenCrossHits} · 정배열 ${maAlignHits} · 120선 ${ma120NearHits} · 매집 ${bookAccumHits} · 바닥 ${bottomCandleHits} · ${now}`;

  const ix = buildIntersectionSection(intersections);
  const gc = buildGoldenCrossSection(goldenCross);
  const ma = buildMaAlignSection(maAlign);
  const ma120 = buildMa120NearSection(ma120Near);
  const book = buildBookAccumSection(bookAccum);
  const bottom = buildBottomCandleSection(bottomCandle);

  /** @type {string[]} */
  const textParts = [
    `YSTOCK 탐색 리포트 (${now})`,
    "",
    "앱 「종목보관」 탭에서 일봉/주봉 필터와 골든크로스·정배열·120선·매집봉·바닥캔들 조건으로 확인할 수 있습니다.",
    "",
  ];
  /** @type {string[]} */
  const htmlParts = [
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title></head>`,
    `<body style="font-family:'Malgun Gothic',sans-serif;line-height:1.6;max-width:900px;margin:0 auto;padding:20px;">`,
    `<h1 style="color:#1e40af;font-size:1.2em;">탐색 리포트</h1>`,
    `<p>${now} · 골든 <strong>${goldenCrossHits}</strong> · 정배열 <strong>${maAlignHits}</strong> · 120선 <strong>${ma120NearHits}</strong> · 매집 <strong>${bookAccumHits}</strong> · 바닥 <strong>${bottomCandleHits}</strong> · 교집합 <strong>${intersectionGc + intersectionMa}</strong></p>`,
  ];

  if (goldenCross.length || maAlign.length) {
    textParts.push(...ix.textParts);
    htmlParts.push(...ix.htmlParts);
  }
  if (goldenCross.length) {
    textParts.push(...gc.textParts);
    htmlParts.push(...gc.htmlParts);
  }
  if (maAlign.length) {
    textParts.push(...ma.textParts);
    htmlParts.push(...ma.htmlParts);
  }
  if (ma120Near.length) {
    textParts.push(...ma120.textParts);
    htmlParts.push(...ma120.htmlParts);
  }
  if (bookAccum.length) {
    textParts.push(...book.textParts);
    htmlParts.push(...book.htmlParts);
  }
  if (bottomCandle.length) {
    textParts.push(...bottom.textParts);
    htmlParts.push(...bottom.htmlParts);
  }

  textParts.push("YSTOCK");
  htmlParts.push(
    `<p style="color:#888;font-size:0.85em;margin-top:24px;">YSTOCK · 종목보관</p>`,
    "</body></html>",
  );

  const text = textParts.join("\n");
  const html = htmlParts.join("\n");

  return {
    subject,
    text,
    html,
    goldenCrossHits,
    maAlignHits,
    ma120NearHits,
    bookAccumHits,
    bottomCandleHits,
    totalHits:
      goldenCrossHits +
      maAlignHits +
      ma120NearHits +
      bookAccumHits +
      bottomCandleHits,
  };
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{
 *   goldenCross?: GoldenCrossEmailMarket[];
 *   maAlign?: MaAlignEmailMarket[];
 *   ma120Near?: Ma120NearEmailMarket[];
 *   bookAccum?: BookAccumEmailMarket[];
 *   bottomCandle?: BottomCandleEmailMarket[];
 *   markets?: GoldenCrossEmailMarket[];
 *   dryRun?: boolean;
 *   to?: string | string[];
 * }} opts
 */
export async function sendGoldenCrossScanReportEmail(opts) {
  const goldenCross = Array.isArray(opts.goldenCross)
    ? opts.goldenCross
    : Array.isArray(opts.markets)
      ? opts.markets
      : [];
  const maAlign = Array.isArray(opts.maAlign) ? opts.maAlign : [];
  const ma120Near = Array.isArray(opts.ma120Near) ? opts.ma120Near : [];
  const bookAccum = Array.isArray(opts.bookAccum) ? opts.bookAccum : [];
  const bottomCandle = Array.isArray(opts.bottomCandle) ? opts.bottomCandle : [];
  const dryRun = Boolean(opts.dryRun);
  const recipients = opts.to
    ? (Array.isArray(opts.to) ? opts.to : [opts.to]).map((s) => String(s).trim()).filter(Boolean)
    : listGoldenCrossEmailRecipientsSync();

  if (!recipients.length) {
    throw new Error("탐색 리포트 수신 이메일이 없습니다.");
  }
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }

  const [
    goldenCrossEnriched,
    maAlignEnriched,
    ma120NearEnriched,
    bookAccumEnriched,
    bottomCandleEnriched,
  ] = await Promise.all([
    enrichScanEmailMarkets(goldenCross),
    enrichScanEmailMarkets(maAlign),
    enrichScanEmailMarkets(ma120Near),
    enrichScanEmailMarkets(bookAccum),
    enrichScanEmailMarkets(bottomCandle),
  ]);

  const {
    subject,
    text,
    html,
    goldenCrossHits,
    maAlignHits,
    ma120NearHits,
    bookAccumHits,
    bottomCandleHits,
    totalHits,
  } = buildGoldenCrossScanEmailContent({
    goldenCross: goldenCrossEnriched,
    maAlign: maAlignEnriched,
    ma120Near: ma120NearEnriched,
    bookAccum: bookAccumEnriched,
    bottomCandle: bottomCandleEnriched,
  });
  if (dryRun) {
    return {
      dryRun: true,
      recipients,
      subject,
      goldenCrossHits,
      maAlignHits,
      ma120NearHits,
      bookAccumHits,
      bottomCandleHits,
      totalHits,
      sent: 0,
    };
  }

  /** @type {{ email: string; status: string; error?: string }[]} */
  const results = [];
  let sent = 0;
  for (const to of recipients) {
    try {
      await sendTransactionalEmail({ to, subject, text, html });
      sent++;
      results.push({ email: to, status: "sent" });
    } catch (e) {
      results.push({
        email: to,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    dryRun: false,
    recipients,
    subject,
    goldenCrossHits,
    maAlignHits,
    ma120NearHits,
    bookAccumHits,
    bottomCandleHits,
    totalHits,
    sent,
    results,
  };
}
