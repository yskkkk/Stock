/**
 * 박스권 탐지 목록 — 카탈로그(US/KR) + 프로그램 FSM 박스
 */
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import {
  CATALOG_MARKETS,
  readCatalogIndexSync,
  readSymbolCatalogSync,
} from "../box-range/catalog-store.js";
import { readBoxRangeStoreSync } from "../box-range/store.js";
import { readProgramsStoreSync } from "../live-trade-programs-store.js";
import { liveTradeCurrency } from "../live-trade-market.js";
import { DEFAULT_AUDIT_REPORT_TO } from "./box-range-v2-audit-report.js";

export { DEFAULT_AUDIT_REPORT_TO };

/**
 * @param {number} n
 * @param {"kr"|"us"|"crypto"} market
 */
function fmtPrice(n, market) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (liveTradeCurrency(market) === "USD") {
    return `$${v.toFixed(2)}`;
  }
  if (v >= 1000) return `${Math.round(v).toLocaleString("ko-KR")}원`;
  return `${v.toLocaleString("ko-KR")}원`;
}

function isValidCatalogBox(b) {
  return b.tradeEligible && !b.consumedAtMs;
}

/**
 * @returns {{
 *   catalog: { market: string; symbol: string; name: string; boxes: object[] }[];
 *   programBoxes: object[];
 *   stats: object;
 * }}
 */
export function collectBoxRangeDetectedListSync() {
  /** @type {{ market: string; symbol: string; name: string; boxes: object[] }[]} */
  const catalog = [];

  for (const market of CATALOG_MARKETS) {
    const index = readCatalogIndexSync(market);
    const rows = Array.isArray(index?.symbols) ? index.symbols : [];
    for (const row of rows) {
      if ((row.eligibleCount ?? 0) <= 0) continue;
      const sym = String(row.symbol ?? "").trim().toUpperCase();
      const cat = readSymbolCatalogSync(sym, market);
      if (!cat) continue;
      const boxes = cat.boxes.filter(isValidCatalogBox).map((b) => ({
        catalogBoxId: b.catalogBoxId,
        timeframe: b.timeframe,
        mid: b.mid,
        top: b.top,
        bottom: b.bottom,
        midFmt: fmtPrice(b.mid, market),
        topFmt: fmtPrice(b.top, market),
        bottomFmt: fmtPrice(b.bottom, market),
      }));
      if (!boxes.length) continue;
      catalog.push({
        market,
        symbol: sym,
        name: cat.name || sym,
        boxes,
      });
    }
  }

  const programs = readProgramsStoreSync().programs ?? [];
  const nameById = new Map(programs.map((p) => [p.id, p.name ?? p.id]));

  const programBoxes = readBoxRangeStoreSync().boxes
    .filter((b) => b.state !== "closed" && b.tradeEligible !== false)
    .map((b) => {
      const market =
        b.catalogMarket === "kr" || b.catalogMarket === "us"
          ? b.catalogMarket
          : b.catalogBoxId
            ? "us"
            : "crypto";
      return {
        programId: b.programId,
        programName: nameById.get(b.programId) ?? b.programId,
        symbol: b.symbol,
        timeframe: b.timeframe,
        state: b.state,
        market,
        mid: b.mid,
        top: b.top,
        bottom: b.bottom,
        midFmt: fmtPrice(b.mid, market),
        topFmt: fmtPrice(b.top, market),
        bottomFmt: fmtPrice(b.bottom, market),
        catalogBoxId: b.catalogBoxId,
      };
    });

  const catalogBoxCount = catalog.reduce((s, r) => s + r.boxes.length, 0);

  return {
    catalog,
    programBoxes,
    stats: {
      catalogSymbols: catalog.length,
      catalogBoxes: catalogBoxCount,
      programBoxes: programBoxes.length,
      usSymbols: catalog.filter((r) => r.market === "us").length,
      krSymbols: catalog.filter((r) => r.market === "kr").length,
    },
  };
}

export function buildBoxRangeCatalogListEmailContent() {
  const data = collectBoxRangeDetectedListSync();
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const subject = `[YSTOCK] 박스권 탐지 목록 — ${data.stats.catalogBoxes}개 박스 · ${now}`;

  const catalogLines = [];
  for (const row of data.catalog) {
    const mkt = row.market === "kr" ? "국내" : "S&P500";
    catalogLines.push(`\n■ ${row.name} (${row.symbol}) [${mkt}]`);
    for (const b of row.boxes) {
      catalogLines.push(
        `  · ${b.timeframe} | 매수(중심) ${b.midFmt} | 익절 ${b.topFmt} | 손절 ${b.bottomFmt}`,
      );
    }
  }

  const programLines =
    data.programBoxes.length === 0
      ? "· (없음)"
      : data.programBoxes
          .map(
            (b) =>
              `· ${b.programName} | ${b.symbol} ${b.timeframe} | ${b.state} | 매수 ${b.midFmt} | TP ${b.topFmt} | SL ${b.bottomFmt}`,
          )
          .join("\n");

  const text = `YSTOCK 박스권 탐지 목록 (${now})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
요약
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
· 카탈로그 유효 박스: ${data.stats.catalogBoxes}개 (${data.stats.catalogSymbols}종목)
  - S&P500: ${data.stats.usSymbols}종목
  - 국내: ${data.stats.krSymbols}종목
· 프로그램 FSM 감시·보유 박스: ${data.programBoxes.length}개

매수 조건: 하단 이탈 후 중심선 재돌파
앱: 상단 「박스권」 탭에서 US/국내 선택


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
카탈로그 — 매매 가능 박스
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${catalogLines.length ? catalogLines.join("\n") : "· 유효 박스 없음"}


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
프로그램 연동 박스 (FSM)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${programLines}


YSTOCK`;

  let catalogHtml = "";
  if (data.catalog.length === 0) {
    catalogHtml = "<p>유효 박스 없음</p>";
  } else {
    catalogHtml = data.catalog
      .map((row) => {
        const mkt = row.market === "kr" ? "국내" : "S&P500";
        const rows = row.boxes
          .map(
            (b) =>
              `<tr><td>${b.timeframe}</td><td>${b.midFmt}</td><td>${b.topFmt}</td><td>${b.bottomFmt}</td></tr>`,
          )
          .join("");
        return `<h3>${row.name} (${row.symbol}) <small>${mkt}</small></h3>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.9em;margin-bottom:16px;">
<tr style="background:#f1f5f9"><th>봉</th><th>매수(중심)</th><th>익절</th><th>손절</th></tr>${rows}</table>`;
      })
      .join("");
  }

  const programHtml =
    data.programBoxes.length === 0
      ? "<p>(없음)</p>"
      : `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.85em;width:100%">
<tr style="background:#f1f5f9"><th>프로그램</th><th>종목</th><th>봉</th><th>상태</th><th>매수</th><th>익절</th><th>손절</th></tr>
${data.programBoxes
  .map(
    (b) =>
      `<tr><td>${b.programName}</td><td>${b.symbol}</td><td>${b.timeframe}</td><td>${b.state}</td><td>${b.midFmt}</td><td>${b.topFmt}</td><td>${b.bottomFmt}</td></tr>`,
  )
  .join("")}
</table>`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:'Malgun Gothic',sans-serif;line-height:1.6;max-width:900px;margin:0 auto;padding:20px;">
<h1 style="color:#1e40af;font-size:1.2em;">박스권 탐지 목록</h1>
<p>${now} · 카탈로그 <strong>${data.stats.catalogBoxes}</strong>박스 / ${data.stats.catalogSymbols}종목 · FSM ${data.programBoxes.length}개</p>
<h2>카탈로그 (US ${data.stats.usSymbols} · KR ${data.stats.krSymbols})</h2>
${catalogHtml}
<h2>프로그램 FSM 박스</h2>
${programHtml}
<p style="color:#888;font-size:0.85em;margin-top:24px;">YSTOCK</p>
</body></html>`;

  return { subject, text, html, data };
}

/**
 * @param {{ to?: string; dryRun?: boolean }} [opts]
 */
export async function sendBoxRangeCatalogListEmail(opts = {}) {
  const to = String(opts.to ?? DEFAULT_AUDIT_REPORT_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const { subject, text, html, data } = buildBoxRangeCatalogListEmailContent();
  if (dryRun) {
    return { to, dryRun: true, subject, stats: data.stats };
  }
  await sendTransactionalEmail({ to, subject, text, html });
  return { to, dryRun: false, subject, sent: true, stats: data.stats };
}
