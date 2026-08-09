/**
 * 발표 인박스 — 텔레그램·메일 알림
 */
import {
  isTelegramNotifyEnabled,
  sendStockTelegramMessage,
} from "./telegram-notify.js";
import {
  isEmailSendingConfigured,
  sendTransactionalEmail,
} from "./email-sender.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

const KIND_KO = {
  guidance: "가이던스",
  consensus: "컨센변경",
  governance: "거버넌스",
  earnings: "실적",
};

/**
 * @param {import("./us-announcement-inbox-store.js").UsAnnouncementCard} card
 */
function formatPctLine(label, pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? "+" : "";
  return `${label}: ${sign}${pct.toFixed(1)}%`;
}

/**
 * @param {import("./us-announcement-inbox-store.js").UsAnnouncementCard} card
 */
export function buildAnnouncementNotifyText(card) {
  const kind = KIND_KO[card.kind] || card.kind;
  const lines = [
    `[발표] ${kind} · ${card.symbol}`,
    card.title,
  ];
  const m = card.metrics || {};
  const a = formatPctLine("컨센 대비", m.vsConsensusPct);
  const b = formatPctLine("전년 대비", m.yoyPct);
  const c = formatPctLine("컨센 변동", m.consensusChangePct);
  if (a) lines.push(a);
  if (b) lines.push(b);
  if (c) lines.push(c);
  if (card.ai?.summary) lines.push("", card.ai.summary);
  if (card.links?.edgar) lines.push("", `EDGAR: ${card.links.edgar}`);
  if (card.links?.yahooAnalysis) {
    lines.push(`Yahoo: ${card.links.yahooAnalysis}`);
  }
  return lines.join("\n");
}

function resolveNotifyEmailTo() {
  return String(process.env.AGENT_EMAIL_TO ?? process.env.STOCK_ANNOUNCEMENT_EMAIL_TO ?? "")
    .trim();
}

export function announcementNotifyEnabled() {
  return String(process.env.STOCK_US_ANNOUNCEMENT_NOTIFY ?? "1").trim() !== "0";
}

/**
 * @param {import("./us-announcement-inbox-store.js").UsAnnouncementCard} card
 */
export async function notifyUsAnnouncementCard(card) {
  /** @type {{ telegramAt: number | null; emailAt: number | null }} */
  const out = { telegramAt: null, emailAt: null };
  if (!announcementNotifyEnabled()) return out;

  const text = buildAnnouncementNotifyText(card);
  const kind = KIND_KO[card.kind] || card.kind;

  if (isTelegramNotifyEnabled()) {
    try {
      await sendStockTelegramMessage(text);
      out.telegramAt = Date.now();
      liveTradeLogInfo("[us-announcement] telegram ok", card.symbol, card.kind);
    } catch (e) {
      liveTradeLogWarn(
        "[us-announcement] telegram fail",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const to = resolveNotifyEmailTo();
  if (to && to.includes("@") && isEmailSendingConfigured()) {
    try {
      await sendTransactionalEmail({
        to,
        subject: `[YSTOCK 발표] ${kind} · ${card.symbol}`,
        text,
      });
      out.emailAt = Date.now();
      liveTradeLogInfo("[us-announcement] email ok", card.symbol, card.kind);
    } catch (e) {
      liveTradeLogWarn(
        "[us-announcement] email fail",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return out;
}
