/**
 * 경제 지표 발표 N분 전 텔레그램 예고 (스크리너 고득점 알림과 별도).
 * — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 필요
 * — TELEGRAM_MACRO_REMINDERS=0 이면 비활성
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getUpcomingMacroEvents } from "./macro-events.js";
import {
  isTelegramNotifyEnabled,
  resolveStockTelegramCreds,
  sendTelegramMessage,
} from "./telegram-notify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "server", ".data");
const SENT_PATH = join(DATA_DIR, "macro-reminder-sent.json");
const PRUNE_MS = 10 * 86400000;

/** @type {Record<string, { high: "positive" | "negative"; low: "positive" | "negative" }>} — src/lib/macroSentiment.ts 와 동기 */
const SCENARIO_BY_CODE = {
  CPI: { high: "negative", low: "positive" },
  PPI: { high: "negative", low: "positive" },
  PCE: { high: "negative", low: "positive" },
  KR_CPI: { high: "negative", low: "positive" },
  NFP: { high: "negative", low: "positive" },
  ADP: { high: "negative", low: "positive" },
  JOLTS: { high: "negative", low: "positive" },
  JOBLESS: { high: "negative", low: "positive" },
  FOMC: { high: "negative", low: "positive" },
  FOMC_MINUTES: { high: "negative", low: "positive" },
  KR_BOK: { high: "negative", low: "positive" },
  GDP: { high: "positive", low: "negative" },
  RETAIL: { high: "positive", low: "negative" },
  CONSUMER_CONF: { high: "positive", low: "negative" },
  ISM_MFG: { high: "positive", low: "negative" },
  ISM_SVC: { high: "positive", low: "negative" },
};

const SENT_KO = { positive: "긍정", negative: "부정" };

/** @param {string} s */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getScenario(code) {
  const c = String(code);
  const stripped = c.replace(/^KR_/, "");
  return SCENARIO_BY_CODE[c] ?? SCENARIO_BY_CODE[stripped] ?? null;
}

/** @returns {Record<string, number>} */
function loadSent() {
  try {
    if (existsSync(SENT_PATH)) {
      const raw = JSON.parse(readFileSync(SENT_PATH, "utf8"));
      return raw && typeof raw === "object" ? raw : {};
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** @param {Record<string, number>} obj */
function saveSent(obj) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SENT_PATH, JSON.stringify(obj, null, 2), "utf8");
}

/** @param {Record<string, number>} o */
function pruneSent(o) {
  const t = Date.now() - PRUNE_MS;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number" && v > t) out[k] = v;
  }
  return out;
}

/** @param {number} at */
function formatKst(at) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(at));
}

/** @param {number} at @param {string} tz */
function formatLocal(at, tz) {
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: tz || "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
  } catch {
    return formatKst(at);
  }
}

/**
 * @param {{ id: string; code: string; name: string; region: string; importance: string; category: string; at: number; timezone: string }} ev
 * @param {"1h" | "10m"} phase
 */
function buildMacroReminderHtml(ev, phase) {
  const phaseTitle = phase === "1h" ? "약 1시간 전" : "약 10분 전";
  const regionKo = ev.region === "kr" ? "한국" : "미국";
  const impKo = ev.importance === "high" ? "고" : "중";
  const scen = getScenario(ev.code);

  const lines = [
    `<b>📊 지표 발표 ${esc(phaseTitle)}</b>`,
    "",
    `• <b>지표</b>: ${esc(ev.code)} — ${esc(ev.name)}`,
    `• <b>지역</b>: ${regionKo} · 중요도: ${impKo}`,
    `• <b>발표(한국 시각)</b>: ${esc(formatKst(ev.at))}`,
    `• <b>현지 시각</b> (${esc(ev.timezone)}): ${esc(formatLocal(ev.at, ev.timezone))}`,
    "",
    `<b>시장 시나리오 요약</b> <i>(광범위 지수 관점, 자주 쓰이는 해석)</i>`,
  ];

  if (scen) {
    lines.push(
      `• 예상보다 <b>높게</b> 나오면 → <b>${SENT_KO[scen.high]}</b>`,
      `• 예상보다 <b>낮게</b> 나오면 → <b>${SENT_KO[scen.low]}</b>`,
    );
  } else {
    lines.push(
      "• 지표별 해석은 다릅니다. 앱 상단 <b>경제 지표</b> 카드에서 상세를 확인해 주세요.",
    );
  }

  lines.push("", `<i>id: ${esc(ev.id)}</i>`);
  return lines.join("\n");
}

export async function tickMacroReminders() {
  if (!isTelegramNotifyEnabled()) return;
  if (String(process.env.TELEGRAM_MACRO_REMINDERS ?? "").trim() === "0") return;

  const events = getUpcomingMacroEvents({ limit: 200, horizonDays: 14 });
  const now = Date.now();
  let sent = pruneSent(loadSent());

  for (const ev of events) {
    const msUntil = ev.at - now;
    if (msUntil < 0) continue;

    /** @type {Array<["1h" | "10m", { lo: number; hi: number }]>} */
    const windows = [
      ["1h", { lo: 56 * 60 * 1000, hi: 62 * 60 * 1000 }],
      ["10m", { lo: 7 * 60 * 1000, hi: 13 * 60 * 1000 }],
    ];

    for (const [phase, win] of windows) {
      if (msUntil < win.lo || msUntil > win.hi) continue;
      const key = `${ev.id}|${phase}`;
      if (sent[key]) continue;

      const html = buildMacroReminderHtml(ev, phase);
      const ok = await sendTelegramMessage(html, undefined, resolveStockTelegramCreds());
      if (ok) {
        sent[key] = Date.now();
        sent = pruneSent(sent);
        saveSent(sent);
        console.log(`[macro-tg] sent ${phase} ${ev.id}`);
      } else {
        console.warn(`[macro-tg] send failed ${phase} ${ev.id}`);
      }
    }
  }
}

export function startMacroReminderLoop() {
  if (!isTelegramNotifyEnabled()) {
    console.log("[macro-tg] reminders off (no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
    return;
  }
  if (String(process.env.TELEGRAM_MACRO_REMINDERS ?? "").trim() === "0") {
    console.log("[macro-tg] reminders disabled (TELEGRAM_MACRO_REMINDERS=0)");
    return;
  }

  const interval = Number(process.env.TELEGRAM_MACRO_REMINDER_INTERVAL_MS);
  const ms =
    Number.isFinite(interval) && interval >= 15_000 ? interval : 45_000;

  setInterval(() => {
    tickMacroReminders().catch((e) => {
      console.warn(
        "[macro-tg] tick error:",
        e instanceof Error ? e.message : e,
      );
    });
  }, ms);

  void tickMacroReminders().catch((e) => {
    console.warn(
      "[macro-tg] initial tick error:",
      e instanceof Error ? e.message : e,
    );
  });

  console.log(`[macro-tg] indicator reminders every ${ms}ms (1h & 10m windows)`);
}
