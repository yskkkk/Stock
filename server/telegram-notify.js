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
import { buildBullishReasons } from "./bullish-reasons.js";
import { getTradingSessionKey } from "./market-hours.js";
import {
  MAX_TECH_SCORE,
  SIGNAL_CONDITION_TOTAL,
  MIN_TELEGRAM_SCORE_RATIO,
  meetsTelegramNotifyScore,
  minConditionsRequired,
  minTelegramScoreRequired,
} from "./technical.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(root, "server", ".data");
const SENT_PATH = join(DATA_DIR, "telegram-sent.json");
const SENT_LOCK_PATH = join(DATA_DIR, "telegram-sent.lock");

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

/** 알림 발송·저장용 단일 시점 가격(당일 고저 범위 사용 안 함) */
function snapshotAlertPrice(pick) {
  const p = Number(pick?.price);
  if (Number.isFinite(p) && p > 0) return p;
  return null;
}

/**
 * 예전에 dayHigh/dayLow 등으로 저장된 항목을 단일 price로 정리.
 * @param {Record<string, unknown>} entry
 */
function sanitizeSentEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const out = { ...entry };
  delete out.dayHigh;
  delete out.dayLow;
  delete out.priceMin;
  delete out.priceMax;
  delete out.priceHigh;
  delete out.priceLow;
  const p = Number(out.price);
  if (Number.isFinite(p) && p > 0) {
    out.price = p;
    return out;
  }
  const legacy = Number(out.alertPrice ?? out.sentPrice);
  if (Number.isFinite(legacy) && legacy > 0) {
    out.price = legacy;
    delete out.alertPrice;
    delete out.sentPrice;
    return out;
  }
  out.price = null;
  return out;
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

/** 발송 시각 기준 한국 날짜(YYYY-MM-DD) — 이력 목록·초기화를 KST 자정 기준으로 통일 */
function kstYmdFromMs(ms) {
  if (!ms || !Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function kstTodayYmd() {
  return kstYmdFromMs(Date.now());
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
        sentCache[nk] = sanitizeSentEntry(entry);
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

    price: snapshotAlertPrice(pick),

    changePercent:
      pick.changePercent != null && Number.isFinite(Number(pick.changePercent))
        ? Number(pick.changePercent)
        : null,

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
  const today = kstTodayYmd();
  const seen = new Set();
  const sent = loadSentFresh();

  for (const [key, entry] of Object.entries(sent)) {
    if (kstYmdFromMs(entry?.at ?? 0) !== today) continue;
    const { market, symbol } = parseSentKey(key, entry);
    seen.add(`${market}:${symbol}`);
  }

  return seen.size;
}



/** 오늘(KST 달력일) 텔레그램 발송 이력 제거 → 동일 종목 재알림 가능 */

export function clearTodayTelegramSent() {

  return withSentFileLock(() => {

    const sent = loadSentFresh();

    const today = kstTodayYmd();

    let removed = 0;

    for (const key of Object.keys(sent)) {

      if (kstYmdFromMs(sent[key]?.at ?? 0) !== today) continue;

      delete sent[key];

      removed += 1;

    }

    saveSent();

    return { ok: true, removed };

  });

}



export function getTelegramNotifyStatus() {
  const minMet = minConditionsRequired();
  const minScore = minTelegramScoreRequired();
  return {
    enabled: isTelegramNotifyEnabled(),
    minConditionsRequired: minMet,
    minAlertScore: minScore,
    maxTechScore: MAX_TECH_SCORE,
    minTelegramScoreRatio: MIN_TELEGRAM_SCORE_RATIO,
    todaySentCount: countTodayTelegramSent(),
  };
}



/** 오늘(KST 달력일) 발송한 종목 목록 */

export function listTodayTelegramSent() {

  const today = kstTodayYmd();

  const sent = loadSentFresh();

  const bySymbol = new Map();



  for (const [key, entry] of Object.entries(sent)) {

    if (kstYmdFromMs(entry?.at ?? 0) !== today) continue;

    const { market, symbol } = parseSentKey(key, entry);

    const dedupeKey = `${market}:${symbol}`;

    const existing = bySymbol.get(dedupeKey);

    const item = {

      market,

      symbol,

      name: entry.name?.trim() || symbol,

      score: entry.score ?? 0,

      sentAt: entry.at ?? 0,

      price:
        typeof entry.price === "number" && Number.isFinite(entry.price)
          ? entry.price
          : null,

      changePercent:
        typeof entry.changePercent === "number" &&
        Number.isFinite(entry.changePercent)
          ? entry.changePercent
          : null,

      currency: entry.currency ?? null,

    };

    if (!existing || (item.sentAt ?? 0) > (existing.sentAt ?? 0)) {

      bySymbol.set(dedupeKey, item);

    }

  }



  return [...bySymbol.values()].sort((a, b) => b.sentAt - a.sentAt);

}



function buildAppDeepLink(pick) {
  const raw = (process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (!raw) return null;
  try {
    const base = raw.includes("://") ? raw : `https://${raw}`;
    const u = new URL(base);
    u.searchParams.set("symbol", normalizeSymbol(pick.symbol));
    u.searchParams.set("market", pick.market === "kr" ? "kr" : "us");
    return u.toString();
  } catch {
    return null;
  }
}



function escHtml(s) {

  return String(s)

    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;");

}



function formatPrice(pick) {
  const price = snapshotAlertPrice(pick);
  const currency = pick.currency;

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



function conditionBar(met, total = SIGNAL_CONDITION_TOTAL, width = 10) {
  const filled = Math.max(
    0,
    Math.min(width, Math.round((met / total) * width)),
  );
  return "█".repeat(filled) + "░".repeat(width - filled);
}



function buildMessage(pick) {

  const isKr = pick.market === "kr";

  const flag = isKr ? "🇰🇷" : "🇺🇸";

  const marketLabel = isKr ? "국내" : "미국";

  const chg = formatChangeLine(pick);

  const price = formatPrice(pick);

  const conditionsMet = Array.isArray(pick.signalIds) ? pick.signalIds.length : 0;
  const conditionsTotal = SIGNAL_CONDITION_TOTAL;
  const conditionsPct = Math.round((conditionsMet / conditionsTotal) * 100);
  const bar = conditionBar(conditionsMet, conditionsTotal);
  const minMet = minConditionsRequired();

  const time = new Date().toLocaleString("ko-KR", {

    timeZone: "Asia/Seoul",

    month: "2-digit",

    day: "2-digit",

    hour: "2-digit",

    minute: "2-digit",

    hour12: false,

  });



  const reasons = buildBullishReasons(pick);
  const reasonLines =
    reasons.length > 0
      ? reasons.map((r, i) => `  ${i + 1}. ${escHtml(r)}`).join("\n")
      : "  • —";

  return [

    `<b>${flag} ${marketLabel} · 점수 ${Math.round(MIN_TELEGRAM_SCORE_RATIO * 100)}%+ 알림</b>`,

    "",

    `<b>${escHtml(pick.name)}</b>`,

    `<code>${escHtml(pick.symbol)}</code>`,

    "",

    `📊 조건  <b>${conditionsMet}</b> / ${conditionsTotal} (${conditionsPct}%, 기준 ${minMet}개+)`,

    `<code>${bar}</code>`,

    `📈 가중 점수  <b>${pick.score}</b> / ${MAX_TECH_SCORE} (알림 기준 ${minTelegramScoreRequired()}점 초과)`,

    "",

    `💰 가격  <b>${escHtml(price)}</b>${chg ? `\n📈 등락  <b>${escHtml(chg)}</b>` : ""}`,

    "",

    `<b>충족 이유</b> (${reasons.length}개)`,

    reasonLines,

    "",

    `<i>🕐 ${time} KST</i>`,

  ].join("\n");

}



export async function sendTelegramMessage(text, replyMarkup) {

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) return false;



  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const payload = {

    chat_id: chatId,

    text: text.slice(0, 4096),

    parse_mode: "HTML",

    disable_web_page_preview: true,

  };

  if (replyMarkup && typeof replyMarkup === "object") {

    payload.reply_markup = replyMarkup;

  }

  const res = await fetch(url, {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify(payload),

  });



  if (!res.ok) {

    const errText = await res.text();

    console.error("[telegram] send failed:", res.status, errText);

    return false;

  }

  return true;

}



/** 스캔 중 고득점(임계 초과)이면 텔레그램 알림 — 정규장 여부와 무관 */

export function notifyHighScorePick(pick) {

  if (!isTelegramNotifyEnabled()) return;

  if (!meetsTelegramNotifyScore(pick.score)) return;

  const sym = normalizeSymbol(pick.symbol);

  const key = notifyFlightKey(sym, pick.market);

  if (!tryClaimNotify(pick)) {

    return;

  }



  const text = buildMessage(pick);

  const session = getTradingSessionKey(pick.market);

  const openUrl = buildAppDeepLink(pick);

  const replyMarkup = openUrl

    ? { inline_keyboard: [[{ text: "📈 종목 보기", url: openUrl }]] }

    : undefined;

  void sendTelegramMessage(text, replyMarkup)

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

/**
 * 운영(Cursor) 웹 에이전트 작업 종료 시 텔레그램 안내 — 요청자·제목·내용 형식.
 * TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 가 있을 때만 전송.
 *
 * @param {{ requester: string; title: string; body: string }} opts
 */
export function notifyOpsAgentCompleted(opts) {
  if (!isTelegramNotifyEnabled()) return;

  const requester = String(opts.requester ?? "").trim() || "—";
  const title = String(opts.title ?? "").trim() || "웹 에이전트";
  let body = String(opts.body ?? "").trim() || "—";
  const max = 3200;
  if (body.length > max) body = `${body.slice(0, max - 1)}…`;

  const text = [
    `<b>웹 에이전트 작업 알림</b>`,
    "",
    `<b>요청자</b>`,
    escHtml(requester),
    "",
    `<b>제목</b>`,
    escHtml(title),
    "",
    `<b>내용</b>`,
    escHtml(body),
  ].join("\n");

  void sendTelegramMessage(text)
    .then((ok) => {
      if (ok) {
        console.log("[telegram] ops-agent completion notice sent");
      } else {
        console.warn("[telegram] ops-agent completion notice failed");
      }
    })
    .catch((err) => {
      console.warn(
        "[telegram] ops-agent notify error:",
        err instanceof Error ? err.message : err,
      );
    });
}


