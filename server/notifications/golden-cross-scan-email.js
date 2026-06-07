import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { DEFAULT_AUDIT_REPORT_TO } from "./box-range-v2-audit-report.js";
import { listUsersSync, getUserNotificationEmailSync } from "../users-store.js";

export { DEFAULT_AUDIT_REPORT_TO };

const CROSS_LABEL = {
  "5>20": "5→20",
  "5>60": "5→60",
  "5>120": "5→120",
};

/**
 * @typedef {{
 *   market: "kr"|"us";
 *   scanDate: string;
 *   scanned: number;
 *   hits: Array<{ symbol: string; name: string; crosses: string[] }>;
 * }} GoldenCrossEmailMarket
 */

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
 * @param {GoldenCrossEmailMarket[]} markets
 */
export function buildGoldenCrossScanEmailContent(markets) {
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const totalHits = markets.reduce((s, m) => s + m.hits.length, 0);
  const subject = `[YSTOCK] 일봉 골든크로스 리포트 — ${totalHits}종목 · ${now}`;

  /** @type {string[]} */
  const textParts = [
    `YSTOCK 일봉 골든크로스 탐색 리포트 (${now})`,
    "",
    "MA5→20·60·120 골든크로스가 확인된 종목입니다.",
    "앱 「보관함」 탭에서 확인할 수 있습니다.",
    "",
  ];

  /** @type {string[]} */
  const htmlParts = [
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title></head>`,
    `<body style="font-family:'Malgun Gothic',sans-serif;line-height:1.6;max-width:900px;margin:0 auto;padding:20px;">`,
    `<h1 style="color:#1e40af;font-size:1.2em;">일봉 골든크로스 리포트</h1>`,
    `<p>${now} · 신규 <strong>${totalHits}</strong>종목</p>`,
  ];

  for (const block of markets) {
    const marketKo = block.market === "kr" ? "국내 시총 300" : "S&P 500";
    textParts.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    textParts.push(`${marketKo} · ${block.scanDate} · 스캔 ${block.scanned}종목 · ${block.hits.length}건`);
    textParts.push("");

    htmlParts.push(
      `<h2>${marketKo} <small style="color:#64748b">${block.scanDate} · ${block.hits.length}건</small></h2>`,
    );

    if (!block.hits.length) {
      textParts.push("· 신규 골든크로스 종목 없음");
      textParts.push("");
      htmlParts.push("<p>신규 골든크로스 종목 없음</p>");
      continue;
    }

    for (const cross of ["5>20", "5>60", "5>120"]) {
      const group = block.hits.filter((h) => h.crosses.includes(cross));
      if (!group.length) continue;
      const label = CROSS_LABEL[cross] ?? cross;
      textParts.push(`[${label}] ${group.length}종목`);
      htmlParts.push(`<h3>${label} (${group.length})</h3>`);
      htmlParts.push(
        `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:0.9em;margin-bottom:16px;width:100%;">`,
        `<tr style="background:#f1f5f9"><th>종목</th><th>코드</th></tr>`,
      );
      for (const h of group) {
        const code = h.symbol.replace(/\.(KS|KQ)$/i, "");
        textParts.push(`· ${h.name} (${code})`);
        htmlParts.push(
          `<tr><td>${escapeHtml(h.name)}</td><td>${escapeHtml(code)}</td></tr>`,
        );
      }
      htmlParts.push("</table>");
      textParts.push("");
    }
  }

  textParts.push("YSTOCK");
  htmlParts.push(
    `<p style="color:#888;font-size:0.85em;margin-top:24px;">YSTOCK · 보관함 탭</p>`,
    "</body></html>",
  );

  return {
    subject,
    text: textParts.join("\n"),
    html: htmlParts.join("\n"),
    totalHits,
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
 * @param {{ markets: GoldenCrossEmailMarket[]; dryRun?: boolean; to?: string | string[] }} opts
 */
export async function sendGoldenCrossScanReportEmail(opts) {
  const markets = Array.isArray(opts.markets) ? opts.markets : [];
  const dryRun = Boolean(opts.dryRun);
  const recipients = opts.to
    ? (Array.isArray(opts.to) ? opts.to : [opts.to]).map((s) => String(s).trim()).filter(Boolean)
    : listGoldenCrossEmailRecipientsSync();

  if (!recipients.length) {
    throw new Error("골든크로스 리포트 수신 이메일이 없습니다.");
  }
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }

  const { subject, text, html, totalHits } = buildGoldenCrossScanEmailContent(markets);
  if (dryRun) {
    return { dryRun: true, recipients, subject, totalHits, sent: 0 };
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
  return { dryRun: false, recipients, subject, totalHits, sent, results };
}
