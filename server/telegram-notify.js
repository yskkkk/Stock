import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getTradingSessionKey, isMarketOpen } from "./market-hours.js";
import { MAX_TECH_SCORE } from "./technical.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(root, "server", ".data");
const SENT_PATH = join(DATA_DIR, "telegram-sent.json");
const SENT_LOCK_PATH = join(DATA_DIR, "telegram-sent.lock");

/** 만점 8점 기준 — 기본 6점 초과(7점+) 알림 */
const DEFAULT_MIN_SCORE = 6;
const LOCK_SPIN_MS = 25;
const LOCK_TIMEOUT_MS = 8_000;

/** @type {Record<string, TelegramSentEntry>} */
let sentCache = null;

/**
 * @typedef {{
 *   score: number;
 *   at: number;
 *   session?: string;
 *   symbol?: string;
 *   market?: string;
 *   name?: string;
 *   price?: number | null;
 *   changePercent?: number | null;
 *   currency?: string | null;
 * }} TelegramSentEntry
 */

/** 전송 완료 전 in-memory 예약 (동일 프로세스 내 즉시 중복 차단) */
const notifyInFlight = new Set();

function normalizeSymbol(symbol) {
  return String(symbol ?? "").toUpperCase();
}

function notifyFlightKey(symbol, market) {
  return `${market}:${normalizeSymbol(symbol)}`;
}

function minScore() {
  const n = Number(process.env.TELEGRAM_MIN_SCORE);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_SCORE;
}

export function isTelegramNotifyEnabled() {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.TELEGRAM_CHAT_ID?.trim(),
  );
}

function todaySessionKeys() {
  return new Set([
    getTradingSessionKey("kr"),
    getTradingSessionKey("us"),
  ]);
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function withSentFileLock(fn) {
  mkdirSync(DATA_DIR, { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd = null;
  while (Date.now() < deadline) {
    try {
      fd = openSync(SENT_LOCK_PATH, "wx");
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      sleepMs(LOCK_SPIN_MS);
    }
  }
  if (fd == null) {
    console.warn("[telegram] sent lock timeout");
    return fn();
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(SENT_LOCK_PATH);
    } catch {
      /* ignore */
    }
  }
}

function loadSentFresh() {
  sentCache = null;
  return loadSent();
}

function loadSent() {
  if (sentCache) return sentCache;
  try {
    if (existsSync(SENT_PATH)) {
      const raw = JSON.parse(readFileSync(SENT_PATH, "utf8"));
      sentCache = {};
      for (const [key, entry] of Object.entries(raw)) {
        const k = String(key ?? "");
        const nk = k.includes(":")
          ? k
          : `legacy:${normalizeSymbol(k)}`;
        sentCache[nk] = entry;
      }
      return sentCache;
    }
  } catch {
    /* ignore */
  }
  sentCache = {};

  return sentCache;

}



function saveSent() {

  try {

    mkdirSync(DATA_DIR, { recursive: true });

    writeFileSync(SENT_PATH, JSON.stringify(sentCache, null, 2), "utf8");

  } catch (err) {

    console.warn("[telegram] sent cache save failed:", err?.message ?? err);

  }

}



function parseSentKey(key, entry) {

  if (entry?.market && entry?.symbol) {

    return { market: entry.market, symbol: normalizeSymbol(entry.symbol) };

  }

  const k = String(key ?? "");

  if (k.startsWith("legacy:")) {

    const symbol = normalizeSymbol(k.slice(7));

    const market =

      symbol.endsWith(".KS") || symbol.endsWith(".KQ") ? "kr" : "us";

    return { market, symbol };

  }

  if (k.includes(":")) {

    const [market, symbol] = k.split(":");

    return { market, symbol: normalizeSymbol(symbol) };

  }

  const symbol = normalizeSymbol(k);

  const market = symbol.endsWith(".KS") || symbol.endsWith(".KQ") ? "kr" : "us";

  return { market, symbol };

}



/** 같은 시장·같은 종목·같은 거래일에 이미 발송했는지 (모든 키 형식 검사) */

function wasSentThisSession(symbol, market, session, sent) {

  const sym = normalizeSymbol(symbol);

  const canonical = notifyFlightKey(sym, market);



  if (sent[canonical]?.session === session) return true;

  if (sent[`legacy:${sym}`]?.session === session) return true;



  for (const [key, entry] of Object.entries(sent)) {

    if (entry?.session !== session) continue;

    const parsed = parseSentKey(key, entry);

    if (parsed.market === market && parsed.symbol === sym) return true;

  }

  return false;

}



function purgeDuplicateSentKeys(symbol, market, session, sent, keepKey) {

  const sym = normalizeSymbol(symbol);

  for (const key of Object.keys(sent)) {

    if (key === keepKey) continue;

    const entry = sent[key];

    if (entry?.session !== session) continue;

    const parsed = parseSentKey(key, entry);

    if (parsed.market === market && parsed.symbol === sym) {

      delete sent[key];

    }

  }

}



function writeSentEntry(pick, sent) {

  const sym = normalizeSymbol(pick.symbol);

  const market = pick.market;

  const key = notifyFlightKey(sym, market);

  const session = getTradingSessionKey(market);



  sent[key] = {

    score: pick.score,

    at: Date.now(),

    session,

    symbol: sym,

    market,

    name: pick.name ?? sym,

    price: pick.price ?? null,

    changePercent: pick.changePercent ?? null,

    currency: pick.currency ?? null,

  };

  purgeDuplicateSentKeys(sym, market, session, sent, key);

}



/**

 * 종목당 1회만 전송 슬롯 확보 (메모리 + 파일 동기화)

 * @returns {boolean}

 */

function tryClaimNotify(pick) {

  const sym = normalizeSymbol(pick.symbol);

  const market = pick.market;

  const key = notifyFlightKey(sym, market);



  if (notifyInFlight.has(key)) return false;

  notifyInFlight.add(key);



  let claimed = false;

  try {

    claimed = withSentFileLock(() => {

      const sent = loadSentFresh();

      const session = getTradingSessionKey(market);

      if (wasSentThisSession(sym, market, session, sent)) {

        return false;

      }

      writeSentEntry(pick, sent);

      saveSent();

      return true;

    });

  } catch (err) {

    console.warn(

      "[telegram] claim failed:",

      err instanceof Error ? err.message : err,

    );

    claimed = false;

  }



  if (!claimed) {

    notifyInFlight.delete(key);

  }

  return claimed;

}



export function countTodayTelegramSent() {

  const sessions = todaySessionKeys();

  const seen = new Set();

  const sent = loadSentFresh();



  for (const [key, entry] of Object.entries(sent)) {

    if (!entry?.session || !sessions.has(entry.session)) continue;

    const { market, symbol } = parseSentKey(key, entry);

    seen.add(`${market}:${symbol}`);

  }

  return seen.size;

}



/** 오늘(각 시장 정규장 거래일) 텔레그램 발송 이력 제거 → 동일 종목 재알림 가능 */

export function clearTodayTelegramSent() {

  return withSentFileLock(() => {

    const sent = loadSentFresh();

    const sessions = todaySessionKeys();

    let removed = 0;

    for (const key of Object.keys(sent)) {

      if (sessions.has(sent[key]?.session)) {

        delete sent[key];

        removed += 1;

      }

    }

    saveSent();

    return { ok: true, removed };

  });

}



export function getTelegramNotifyStatus() {

  return {

    enabled: isTelegramNotifyEnabled(),

    minScore: minScore(),

    minAlertScore: minScore() + 1,

    todaySentCount: countTodayTelegramSent(),

  };

}



/** 오늘(정규장 거래일) 텔레그램 발송 종목 목록 */

export function listTodayTelegramSent() {

  const sessions = todaySessionKeys();

  const sent = loadSentFresh();

  const bySymbol = new Map();



  for (const [key, entry] of Object.entries(sent)) {

    if (!entry?.session || !sessions.has(entry.session)) continue;

    const { market, symbol } = parseSentKey(key, entry);

    const dedupeKey = `${market}:${symbol}`;

    const existing = bySymbol.get(dedupeKey);

    const item = {

      market,

      symbol,

      name: entry.name?.trim() || symbol,

      score: entry.score ?? 0,

      sentAt: entry.at ?? 0,

      price: entry.price ?? null,

      changePercent: entry.changePercent ?? null,

      currency: entry.currency ?? null,

    };

    if (!existing || (item.sentAt ?? 0) > (existing.sentAt ?? 0)) {

      bySymbol.set(dedupeKey, item);

    }

  }



  return [...bySymbol.values()].sort((a, b) => b.sentAt - a.sentAt);

}



function escHtml(s) {

  return String(s)

    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;");

}



function formatPrice(pick) {

  const { price, currency } = pick;

  if (price == null) return "—";

  if (currency === "KRW") {

    return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(price)}원`;

  }

  return `${price.toFixed(2)} ${currency ?? ""}`.trim();

}



function formatChangeLine(pick) {

  const ch = pick.changePercent;

  if (ch == null) return "";

  const sign = ch >= 0 ? "+" : "";

  const arrow = ch >= 0 ? "▲" : "▼";

  return `${arrow} ${sign}${ch.toFixed(2)}%`;

}



function scoreBar(score, max = MAX_TECH_SCORE, width = 10) {

  const filled = Math.max(0, Math.min(width, Math.round((score / max) * width)));

  return "█".repeat(filled) + "░".repeat(width - filled);

}



function buildMessage(pick) {

  const isKr = pick.market === "kr";

  const flag = isKr ? "🇰🇷" : "🇺🇸";

  const marketLabel = isKr ? "국내" : "미국";

  const chg = formatChangeLine(pick);

  const price = formatPrice(pick);

  const bar = scoreBar(pick.score);

  const time = new Date().toLocaleString("ko-KR", {

    timeZone: "Asia/Seoul",

    month: "2-digit",

    day: "2-digit",

    hour: "2-digit",

    minute: "2-digit",

    hour12: false,

  });



  const signalLines =

    pick.signals?.length > 0

      ? pick.signals

          .slice(0, 8)

          .map((s) => `  • ${escHtml(s)}`)

          .join("\n")

      : "  • —";



  const more =

    pick.signals?.length > 8

      ? `\n  <i>외 ${pick.signals.length - 8}개 신호</i>`

      : "";



  return [

    `<b>${flag} ${marketLabel} · 고득점 알림</b>`,

    "",

    `<b>${escHtml(pick.name)}</b>`,

    `<code>${escHtml(pick.symbol)}</code>`,

    "",

    `📊 점수  <b>${pick.score}</b> / ${MAX_TECH_SCORE}`,

    `<code>${bar}</code>`,

    "",

    `💰 가격  <b>${escHtml(price)}</b>${chg ? `\n📈 등락  <b>${escHtml(chg)}</b>` : ""}`,

    "",

    `<b>신호</b>`,

    signalLines + more,

    "",

    `<i>🕐 ${time} KST · 정규장</i>`,

  ].join("\n");

}



async function sendTelegramMessage(text) {

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) return false;



  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({

      chat_id: chatId,

      text: text.slice(0, 4096),

      parse_mode: "HTML",

      disable_web_page_preview: true,

    }),

  });



  if (!res.ok) {

    const errText = await res.text();

    console.error("[telegram] send failed:", res.status, errText);

    return false;

  }

  return true;

}



/** 스캔 중 고득점 + 정규장 개장 시에만 텔레그램 알림 */

export function notifyHighScorePick(pick) {

  if (!isTelegramNotifyEnabled()) return;

  if (pick.score <= minScore()) return;

  if (!isMarketOpen(pick.market, pick.marketState)) return;



  const sym = normalizeSymbol(pick.symbol);

  const key = notifyFlightKey(sym, pick.market);

  if (!tryClaimNotify(pick)) {

    return;

  }



  const text = buildMessage(pick);

  const session = getTradingSessionKey(pick.market);

  void sendTelegramMessage(text)

    .then((ok) => {

      if (ok) {

        console.log(

          `[telegram] sent ${sym} score=${pick.score} session=${session}`,

        );

      } else {

        console.warn(`[telegram] send failed ${sym} score=${pick.score}`);

      }

    })

    .catch((err) => {

      console.warn(

        "[telegram] send error:",

        err instanceof Error ? err.message : err,

      );

    })

    .finally(() => {

      notifyInFlight.delete(key);

    });

}


