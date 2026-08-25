/**
 * 장 마감 보유 종목 브리핑 이메일
 */
import fs from "node:fs";
import path from "node:path";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import {
  findUserByEmailSync,
  getUserNotificationEmailSync,
  listUsersSync,
  normalizeUserEmail,
} from "../users-store.js";
import { resolveServerDataDir } from "../data-path.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";
import {
  buildHoldingsCloseDigest,
  holdingsCloseDigestEnabled,
  isHoldingsCloseDigestDue,
  listHoldingsCloseDigestRecipientEmailsSync,
} from "../holdings-close-digest.js";

function sentLogPath() {
  return path.join(resolveServerDataDir(), "holdings-close-digest-sent.json");
}

function readSentLogSync() {
  try {
    const p = sentLogPath();
    if (!fs.existsSync(p)) return { sent: {} };
    const o = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!o || typeof o !== "object") return { sent: {} };
    return { sent: o.sent && typeof o.sent === "object" ? o.sent : {} };
  } catch {
    return { sent: {} };
  }
}

function writeSentLogSync(log) {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = sentLogPath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(log, null, 0), "utf8");
  fs.renameSync(tmp, file);
}

/**
 * @param {string} userId
 * @param {string} sessionKey
 */
export function wasHoldingsCloseDigestSentSync(userId, sessionKey) {
  const uid = String(userId ?? "").trim();
  const key = String(sessionKey ?? "").trim();
  if (!uid || !key) return false;
  const row = readSentLogSync().sent[uid];
  return Boolean(row && row[key]);
}

/**
 * @param {string} userId
 * @param {string} sessionKey
 */
export function markHoldingsCloseDigestSentSync(userId, sessionKey) {
  const uid = String(userId ?? "").trim();
  const key = String(sessionKey ?? "").trim();
  if (!uid || !key) return;
  const log = readSentLogSync();
  const prev = log.sent[uid] && typeof log.sent[uid] === "object" ? log.sent[uid] : {};
  log.sent[uid] = { ...prev, [key]: Date.now() };
  writeSentLogSync(log);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toneColor(labelKo) {
  if (labelKo === "호재") return { fg: "#15803d", bg: "#ecfdf5" };
  if (labelKo === "악재") return { fg: "#b91c1c", bg: "#fef2f2" };
  return { fg: "#475569", bg: "#f8fafc" };
}

function changeColor(changePercent) {
  const n = Number(changePercent);
  if (!Number.isFinite(n) || n === 0) return "#475569";
  return n > 0 ? "#15803d" : "#b91c1c";
}

/**
 * @param {Awaited<ReturnType<typeof buildHoldingsCloseDigest>>} digest
 */
export function buildHoldingsCloseDigestEmailHtml(digest) {
  const rowsHtml = (digest.rows ?? [])
    .map((row) => {
      const newsHtml =
        row.news.length === 0
          ? `<p style="margin:8px 0 0;font-size:13px;color:#64748b">최근 24시간 주요 뉴스 없음.</p>`
          : row.news
              .map((n) => {
                const t = toneColor(n.labelKo);
                const link = n.url
                  ? `<a href="${escapeHtml(n.url)}" style="color:#1e5fc4;font-weight:700;text-decoration:none">원문</a>`
                  : "";
                return `<div style="margin:10px 0 0;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#fafafa">
  <p style="margin:0 0 6px"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${t.bg};color:${t.fg};font-size:12px;font-weight:800">${escapeHtml(n.labelKo)}</span>
  <span style="margin-left:8px;font-size:12px;color:#64748b">${escapeHtml(n.publishedLabel)}${n.source ? ` · ${escapeHtml(n.source)}` : ""}</span></p>
  <p style="margin:0 0 6px;font-size:14px;font-weight:700;line-height:1.45">${escapeHtml(n.title)}</p>
  <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#334155">${escapeHtml(n.impact)}</p>
  ${link}
</div>`;
              })
              .join("");
      return `<div style="margin:0 0 18px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff">
  <p style="margin:0 0 4px;font-size:16px;font-weight:800">${escapeHtml(row.name)} <span style="font-weight:600;color:#64748b">(${escapeHtml(row.symbol)})</span></p>
  <p style="margin:0;font-size:14px">${row.qtyLabel ? `${escapeHtml(row.qtyLabel)} · ` : ""}최근가 ${escapeHtml(row.priceLabel)} · <span style="font-weight:800;color:${changeColor(row.changePercent)}">${escapeHtml(row.changeLabel)}</span></p>
  ${newsHtml}
</div>`;
    })
    .join("");

  const emptyHoldings =
    (digest.rows ?? []).length === 0
      ? `<p style="margin:0 0 12px;font-size:14px;color:#64748b">토스 실계좌에서 수량 있는 주식을 찾지 못했습니다. 종목보관함·시뮬 포지션은 넣지 않습니다.</p>`
      : "";

  return `<!DOCTYPE html><html lang="ko"><body style="margin:0;padding:0;background:#f1f5f9;font-family:'Pretendard',system-ui,sans-serif;color:#0f172a">
<div style="max-width:640px;margin:0 auto;padding:20px 16px">
  <p style="margin:0 0 8px;font-size:12px;color:#64748b">YSTOCK · 실계좌 장 마감 브리핑 · ${escapeHtml(digest.marketLabel)}</p>
  <h1 style="margin:0 0 14px;font-size:20px;font-weight:800;line-height:1.35">${escapeHtml(digest.dateLabel)} 장 마감</h1>
  <div style="margin:0 0 18px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff">
    <p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#334155">오늘 시장</p>
    <p style="margin:0;font-size:14px;line-height:1.7;color:#0f172a">${escapeHtml(digest.marketFlow)}</p>
  </div>
  ${emptyHoldings}
  ${rowsHtml}
  <p style="margin:14px 0 0;font-size:11px;line-height:1.5;color:#94a3b8">투자 판단은 본인 책임입니다. 뉴스 호재/악재는 제목 키워드 기반 자동 분류이며, 주가 영향은 당일 등락 방향과의 일치 여부입니다. 사실과 다를 수 있습니다.</p>
</div></body></html>`;
}

/**
 * @param {Awaited<ReturnType<typeof buildHoldingsCloseDigest>>} digest
 */
export function buildHoldingsCloseDigestEmailText(digest) {
  /** @type {string[]} */
  const lines = [
    `YSTOCK 실계좌 장 마감 브리핑 · ${digest.marketLabel}`,
    digest.dateLabel,
    "",
    "[오늘 시장]",
    digest.marketFlow,
    "",
  ];
  if (!digest.rows.length) {
    lines.push("토스 실계좌에서 수량 있는 주식을 찾지 못했습니다. 종목보관함·시뮬 포지션은 넣지 않습니다.");
  }
  for (const row of digest.rows) {
    lines.push("————————————————");
    lines.push(`${row.name} (${row.symbol})`);
    lines.push(`${row.qtyLabel ? `${row.qtyLabel} · ` : ""}가격 ${row.priceLabel} · 당일 ${row.changeLabel}`);
    if (!row.news.length) {
      lines.push("최근 24시간 주요 뉴스 없음.");
    }
    for (const n of row.news) {
      lines.push("");
      lines.push(`[${n.labelKo}] ${n.title}`);
      lines.push(`${n.publishedLabel}${n.source ? ` · ${n.source}` : ""}`);
      lines.push(n.impact);
      if (n.url) lines.push(n.url);
    }
    lines.push("");
  }
  lines.push(
    "투자 판단은 본인 책임입니다. 호재/악재는 제목 키워드 자동 분류이며 주가 영향은 당일 등락 방향과의 일치 여부입니다.",
  );
  return lines.join("\n");
}

/**
 * @param {string} to
 * @param {Awaited<ReturnType<typeof buildHoldingsCloseDigest>>} digest
 */
export async function sendHoldingsCloseDigestEmail(to, digest) {
  const subject =
    `[YSTOCK] 장 마감 브리핑 · ${digest.marketLabel} · ${digest.dateLabel}`.slice(
      0,
      180,
    );
  await sendTransactionalEmail({
    to,
    subject,
    text: buildHoldingsCloseDigestEmailText(digest),
    html: buildHoldingsCloseDigestEmailHtml(digest),
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @returns {{ userId: string; email: string }[]}
 */
export function resolveHoldingsCloseDigestTargetsSync(emailFilter) {
  const only = String(emailFilter ?? "").trim().toLowerCase();
  const allMembers =
    String(process.env.STOCK_HOLDINGS_CLOSE_DIGEST_ALL_MEMBERS ?? "0").trim() ===
    "1";

  /** @type {{ userId: string; email: string }[]} */
  const out = [];

  if (only) {
    const user = findUserByEmailSync(only);
    const email = user ? getUserNotificationEmailSync(user) || user.email : only;
    if (user && email) out.push({ userId: user.id, email });
    return out;
  }

  if (allMembers) {
    for (const user of listUsersSync()) {
      const email = getUserNotificationEmailSync(user);
      if (email) out.push({ userId: user.id, email });
    }
    return out;
  }

  for (const addr of listHoldingsCloseDigestRecipientEmailsSync()) {
    const user = findUserByEmailSync(addr);
    if (!user) {
      liveTradeLogWarn("[holdings-close-digest] no user for", addr);
      continue;
    }
    const email = getUserNotificationEmailSync(user) || normalizeUserEmail(user.email);
    if (email) out.push({ userId: user.id, email });
  }
  return out;
}

/**
 * @param {{
 *   dryRun?: boolean;
 *   force?: boolean;
 *   market?: "kr"|"us"|"all";
 *   email?: string;
 *   now?: Date;
 * }} [opts]
 */
export async function tickHoldingsCloseDigestEmail(opts = {}) {
  if (!isEmailSendingConfigured()) {
    return { ok: false, reason: "smtp_not_configured", sent: 0 };
  }

  const dryRun = opts.dryRun === true;
  const force = opts.force === true;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const requested = opts.market;

  /** @type {Array<"kr"|"us"|"all">} */
  let markets;
  if (requested === "all" || force) {
    markets = requested === "kr" || requested === "us" ? [requested] : ["all"];
  } else if (requested === "kr" || requested === "us") {
    markets = [requested];
  } else {
    markets = /** @type {Array<"kr"|"us">} */ (
      ["kr", "us"].filter((m) => isHoldingsCloseDigestDue(m, now))
    );
  }

  if (!markets.length) {
    return { ok: true, reason: "not_due", sent: 0, markets: [] };
  }

  const targets = resolveHoldingsCloseDigestTargetsSync(opts.email);
  if (!targets.length) {
    return { ok: false, reason: "no_recipients", sent: 0 };
  }

  let sent = 0;
  /** @type {Array<{ email: string; market: string; reason?: string }>} */
  const errors = [];

  for (const market of markets) {
    for (const t of targets) {
      try {
        const digest = await buildHoldingsCloseDigest({
          userId: t.userId,
          market,
          now,
        });
        if (!force && wasHoldingsCloseDigestSentSync(t.userId, digest.sessionKey)) {
          continue;
        }
        if (!dryRun) {
          await sendHoldingsCloseDigestEmail(t.email, digest);
          markHoldingsCloseDigestSentSync(t.userId, digest.sessionKey);
        }
        sent += 1;
        liveTradeLogInfo(
          "[holdings-close-digest] sent",
          t.email,
          digest.sessionKey,
          `holdings=${digest.rows.length}`,
          dryRun ? "dryRun" : "",
        );
        await sleep(150);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ email: t.email, market, reason: msg });
        liveTradeLogWarn("[holdings-close-digest] send fail", t.email, market, msg);
      }
    }
  }

  return {
    ok: errors.length === 0,
    sent,
    dryRun,
    markets,
    targets: targets.length,
    errors,
  };
}

export { holdingsCloseDigestEnabled };
