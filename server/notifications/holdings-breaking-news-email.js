/**
 * 보유 종목 속보 — 회원별 이메일 (호재/악재 요약)
 */
import fs from "node:fs";
import path from "node:path";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { getUserNotificationEmailSync, listUsersSync } from "../users-store.js";
import { loadNews } from "../news.js";
import { isStockMovingNewsItem } from "../news-filter.js";
import { collectUserHeldSymbolsAsync } from "../holdings-news-symbols.js";
import {
  buildHoldingsNewsBrief,
  isBreakingHoldingsNewsItem,
} from "../holdings-news-brief.js";
import { resolveServerDataDir } from "../data-path.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";

function sentLogPath() {
  return path.join(resolveServerDataDir(), "holdings-news-email-sent.json");
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
 * @param {string} articleKey
 */
export function wasHoldingsNewsEmailSentSync(userId, articleKey) {
  const uid = String(userId ?? "").trim();
  const key = String(articleKey ?? "").trim();
  if (!uid || !key) return false;
  const row = readSentLogSync().sent[uid];
  return Boolean(row && row[key]);
}

/**
 * @param {string} userId
 * @param {string} articleKey
 */
export function markHoldingsNewsEmailSentSync(userId, articleKey) {
  const uid = String(userId ?? "").trim();
  const key = String(articleKey ?? "").trim();
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

/**
 * @param {ReturnType<typeof buildHoldingsNewsBrief>} brief
 * @param {{ symbol: string; name: string; url: string; source?: string }} payload
 */
export function buildHoldingsBreakingNewsEmailHtml(brief, payload) {
  const toneColor =
    brief.sentiment === "positive"
      ? "#15803d"
      : brief.sentiment === "negative"
        ? "#b91c1c"
        : "#475569";
  const toneBg =
    brief.sentiment === "positive"
      ? "#ecfdf5"
      : brief.sentiment === "negative"
        ? "#fef2f2"
        : "#f8fafc";

  return `<!DOCTYPE html><html lang="ko"><body style="margin:0;padding:0;background:#f1f5f9;font-family:'Pretendard',system-ui,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;padding:20px 16px">
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;box-shadow:0 4px 18px rgba(15,23,42,.06)">
    <p style="margin:0 0 6px;font-size:12px;color:#64748b">YSTOCK · 보유 종목 속보</p>
    <p style="margin:0 0 10px;font-size:18px;font-weight:800;line-height:1.35">${escapeHtml(payload.name)} <span style="font-weight:600;color:#64748b">(${escapeHtml(payload.symbol)})</span></p>
    <p style="margin:0 0 14px;display:inline-block;padding:4px 10px;border-radius:999px;background:${toneBg};color:${toneColor};font-size:13px;font-weight:800">${escapeHtml(brief.labelKo)}</p>
    <p style="margin:0 0 8px;font-size:15px;font-weight:700;line-height:1.5">${escapeHtml(brief.headline)}</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#334155">${escapeHtml(brief.explanation)}</p>
    <p style="margin:0 0 14px;font-size:12px;color:#64748b">게시: ${escapeHtml(brief.publishedLabel)}${payload.source ? ` · ${escapeHtml(payload.source)}` : ""}</p>
    <a href="${escapeHtml(payload.url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#1e5fc4;color:#fff;text-decoration:none;font-weight:700;font-size:14px">원문 보기</a>
  </div>
  <p style="margin:14px 0 0;font-size:11px;line-height:1.5;color:#94a3b8">투자 판단은 본인 책임입니다. 제목·키워드 기반 자동 요약이며 사실과 다를 수 있습니다.</p>
</div></body></html>`;
}

/**
 * @param {string} to
 * @param {ReturnType<typeof buildHoldingsNewsBrief>} brief
 * @param {{ symbol: string; name: string; url: string; source?: string }} payload
 */
export async function sendHoldingsBreakingNewsEmail(to, brief, payload) {
  const subject = `[YSTOCK][${brief.labelKo}] ${payload.name} — ${brief.headline}`.slice(
    0,
    180,
  );
  const text = [
    `${payload.name} (${payload.symbol})`,
    `구분: ${brief.labelKo}`,
    "",
    brief.headline,
    "",
    brief.explanation,
    "",
    `게시: ${brief.publishedLabel}`,
    `원문: ${payload.url}`,
  ].join("\n");

  await sendTransactionalEmail({
    to,
    subject,
    text,
    html: buildHoldingsBreakingNewsEmailHtml(brief, payload),
  });
}

/**
 * @param {unknown} item
 */
function articleDedupeKey(item) {
  const id = String(item?.id ?? "").trim();
  if (id) return id;
  const url = String(item?.url ?? "").trim();
  if (url) return `url:${url}`;
  const title = String(item?.title ?? "").trim();
  return title ? `title:${title}` : "";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {{ dryRun?: boolean; userId?: string }} [opts]
 */
export async function tickHoldingsBreakingNewsEmail(opts = {}) {
  if (!isEmailSendingConfigured()) {
    return { ok: false, reason: "smtp_not_configured", sent: 0 };
  }

  const dryRun = opts.dryRun === true;
  const onlyUserId = String(opts.userId ?? "").trim();
  const delayMs = (() => {
    const n = Number(process.env.STOCK_HOLDINGS_NEWS_EMAIL_DELAY_MS ?? 120);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 2000) : 120;
  })();

  let sent = 0;
  let checkedUsers = 0;
  let checkedSymbols = 0;
  /** @type {Map<string, Awaited<ReturnType<typeof loadNews>>>} */
  const newsBySymbol = new Map();

  for (const user of listUsersSync()) {
    if (onlyUserId && user.id !== onlyUserId) continue;
    const email = getUserNotificationEmailSync(user);
    if (!email) continue;
    checkedUsers += 1;

    const holdings = await collectUserHeldSymbolsAsync(user.id);
    if (!holdings.length) continue;

    for (const h of holdings) {
      checkedSymbols += 1;
      let news = newsBySymbol.get(h.symbol);
      if (!news) {
        try {
          news = await loadNews(h.symbol, h.name, { bypassCache: true });
          newsBySymbol.set(h.symbol, news);
        } catch (e) {
          liveTradeLogWarn(
            "[holdings-news] loadNews failed",
            h.symbol,
            e instanceof Error ? e.message : e,
          );
          continue;
        }
      }

      for (const item of news.items ?? []) {
        if (!isStockMovingNewsItem(item)) continue;
        if (!isBreakingHoldingsNewsItem(item)) continue;

        const articleKey = articleDedupeKey(item);
        if (!articleKey) continue;
        if (wasHoldingsNewsEmailSentSync(user.id, articleKey)) continue;

        const brief = buildHoldingsNewsBrief(item, h);
        const url = String(item?.url ?? "").trim();
        if (!url) continue;

        if (dryRun) {
          liveTradeLogInfo("[holdings-news] dry-run", email, h.symbol, brief.labelKo, item.title);
          markHoldingsNewsEmailSentSync(user.id, articleKey);
          sent += 1;
          continue;
        }

        try {
          await sendHoldingsBreakingNewsEmail(email, brief, {
            symbol: h.symbol,
            name: h.name,
            url,
            source: String(item?.source ?? "").trim() || undefined,
          });
          markHoldingsNewsEmailSentSync(user.id, articleKey);
          sent += 1;
          liveTradeLogInfo("[holdings-news] sent", email, h.symbol, brief.labelKo);
        } catch (e) {
          liveTradeLogWarn(
            "[holdings-news] send failed",
            email,
            e instanceof Error ? e.message : e,
          );
        }

        if (delayMs > 0) await sleep(delayMs);
      }
    }
  }

  return { ok: true, sent, checkedUsers, checkedSymbols, dryRun };
}

export function holdingsBreakingNewsEmailEnabled() {
  return String(process.env.STOCK_HOLDINGS_NEWS_EMAIL ?? "0").trim() === "1";
}
