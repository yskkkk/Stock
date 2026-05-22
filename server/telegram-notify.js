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
  getMaxTechScore,
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

/** @type {{ atMs: number; message: string; status?: number } | null} */
let lastTelegramSendError = null;

function normalizeSymbol(symbol) {
  return String(symbol ?? "").toUpperCase();
}

function notifyFlightKey(symbol, market, modelId) {
  const mid = String(modelId ?? "default").trim() || "default";
  return `${market}:${normalizeSymbol(symbol)}:${mid}`;
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

/** 종목 추천·경제지표 예고 — @YSK_STOCK_RECOMMEND_BOT (TELEGRAM_BOT_TOKEN 만) */
export function resolveStockTelegramCreds() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
    chatId: process.env.TELEGRAM_CHAT_ID?.trim() || "",
  };
}

export function isTelegramNotifyEnabled() {
  const { token, chatId } = resolveStockTelegramCreds();
  return Boolean(token && chatId);
}

/** @param {{ token: string; chatId: string; label: string }} cfg */
async function probeTelegramCreds(cfg) {
  const { token, chatId, label } = cfg;
  if (!token || !chatId) return { ok: false, reason: "disabled" };
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meBody = await meRes.json();
    if (!meBody?.ok) {
      const msg = humanizeTelegramError(String(meBody?.description ?? ""), "");
      lastTelegramSendError = { atMs: Date.now(), message: msg, status: meRes.status };
      console.warn(`[telegram:${label}] getMe failed:`, msg);
      return { ok: false, reason: msg };
    }
    const chatRes = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`,
    );
    const chatBody = await chatRes.json();
    if (!chatBody?.ok) {
      const msg = humanizeTelegramError(String(chatBody?.description ?? ""), "");
      lastTelegramSendError = { atMs: Date.now(), message: msg, status: chatRes.status };
      console.warn(`[telegram:${label}] getChat failed:`, msg);
      return { ok: false, reason: msg };
    }
    const username = meBody.result?.username ?? null;
    console.info(
      `[telegram:${label}] ready @${username ?? "?"} → chat ${chatId}`,
    );
    return { ok: true, bot: username };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lastTelegramSendError = { atMs: Date.now(), message: msg, status: null };
    console.warn(`[telegram:${label}] probe error:`, msg);
    return { ok: false, reason: msg };
  }
}

/** 종목 추천 봇(@YSK_STOCK_RECOMMEND_BOT) 연결 검증 */
export async function probeStockTelegramSetup() {
  const { token, chatId } = resolveStockTelegramCreds();
  const out = await probeTelegramCreds({
    token,
    chatId,
    label: "stock",
  });
  if (out.ok) lastTelegramSendError = null;
  return out;
}

/** @deprecated probeStockTelegramSetup 사용 */
export async function probeTelegramSetup() {
  return probeStockTelegramSetup();
}

/** 웹 에이전트·서버 ON/OFF 봇 연결 검증 */
export async function probeOpsTelegramSetup() {
  if (!isOpsTelegramNotifyEnabled()) return { ok: false, reason: "disabled" };
  const { token, chatId } = resolveOpsTelegramCreds();
  return probeTelegramCreds({ token, chatId, label: "ops" });
}

/** 운영 탭 웹(Cursor) 에이전트 완료 알림 — 종목 추천 봇과 분리 */
export function resolveOpsTelegramCreds() {
  return {
    token: process.env.TELEGRAM_OPS_BOT_TOKEN?.trim() || "",
    chatId:
      process.env.TELEGRAM_OPS_CHAT_ID?.trim() ||
      process.env.TELEGRAM_CHAT_ID?.trim() ||
      "",
  };
}

export function isOpsTelegramNotifyEnabled() {
  const { token, chatId } = resolveOpsTelegramCreds();
  return Boolean(token && chatId);
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
    const parts = k.split(":");
    const market = parts[0] === "kr" || parts[0] === "us" ? parts[0] : null;
    if (market && parts.length >= 2) {
      const symbol = normalizeSymbol(parts[1]);
      const modelId =
        parts.length >= 3
          ? String(parts[2] ?? "").trim() || null
          : entry?.techModelId != null
            ? String(entry.techModelId).trim()
            : null;
      return { market, symbol, modelId };
    }
  }

  const symbol = normalizeSymbol(k);

  const market = symbol.endsWith(".KS") || symbol.endsWith(".KQ") ? "kr" : "us";

  return { market, symbol };

}



function isNotifyPending(symbol, market, modelId) {
  return notifyInFlight.has(notifyFlightKey(symbol, market, modelId));
}

/** 같은 시장·종목·모델·거래일에 이미 발송했는지 */

function wasSentThisSession(symbol, market, session, sent, modelId) {

  const sym = normalizeSymbol(symbol);

  const mid = String(modelId ?? "default").trim() || "default";

  const canonical = notifyFlightKey(sym, market, mid);

  if (sent[canonical]?.session === session) return true;

  for (const [key, entry] of Object.entries(sent)) {

    if (entry?.session !== session) continue;

    const parsed = parseSentKey(key, entry);

    const em =
      entry?.techModelId != null ? String(entry.techModelId).trim() : parsed.modelId;

    if (parsed.market === market && parsed.symbol === sym && em === mid) return true;

  }

  return false;

}



function purgeDuplicateSentKeys(symbol, market, session, sent, keepKey, modelId) {

  const sym = normalizeSymbol(symbol);

  const mid = String(modelId ?? "default").trim() || "default";

  for (const key of Object.keys(sent)) {

    if (key === keepKey) continue;

    const entry = sent[key];

    if (entry?.session !== session) continue;

    const parsed = parseSentKey(key, entry);

    const em =
      entry?.techModelId != null ? String(entry.techModelId).trim() : parsed.modelId;

    if (parsed.market === market && parsed.symbol === sym && em === mid) {

      delete sent[key];

    }

  }

}



function writeSentEntry(pick, sent) {

  const sym = normalizeSymbol(pick.symbol);

  const market = pick.market;

  const modelId = String(pick.techModelId ?? "default").trim() || "default";

  const key = notifyFlightKey(sym, market, modelId);

  const session = getTradingSessionKey(market);



  const signalIds = Array.isArray(pick.signalIds)
    ? pick.signalIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];

  sent[key] = {

    score: pick.score,

    signalIds: signalIds.length ? signalIds : undefined,

    at: Date.now(),

    session,

    symbol: sym,

    market,

    techModelId: modelId,

    techModelName: String(pick.techModelName ?? modelId).trim() || modelId,

    name: pick.name ?? sym,

    price: snapshotAlertPrice(pick),

    changePercent:
      pick.changePercent != null && Number.isFinite(Number(pick.changePercent))
        ? Number(pick.changePercent)
        : null,

    currency: pick.currency ?? null,

  };

  purgeDuplicateSentKeys(sym, market, session, sent, key, modelId);

}



/**
 * 전송 슬롯 예약(파일 기록은 전송 성공 후) — API 실패 시 재시도 가능
 * @returns {boolean}
 */
function tryReserveNotify(pick) {
  const sym = normalizeSymbol(pick.symbol);
  const market = pick.market;
  const modelId = String(pick.techModelId ?? "default").trim() || "default";
  const key = notifyFlightKey(sym, market, modelId);

  if (notifyInFlight.has(key)) return false;

  let reserved = false;
  try {
    reserved = withSentFileLock(() => {
      const sent = loadSentFresh();
      const session = getTradingSessionKey(market);
      if (wasSentThisSession(sym, market, session, sent, modelId)) {
        return false;
      }
      if (isNotifyPending(sym, market, modelId)) return false;
      return true;
    });
  } catch (err) {
    console.warn(
      "[telegram] reserve failed:",
      err instanceof Error ? err.message : err,
    );
    reserved = false;
  }

  if (!reserved) return false;
  notifyInFlight.add(key);
  return true;
}

/** @param {object} pick */
function confirmNotifySent(pick) {
  const sym = normalizeSymbol(pick.symbol);
  const market = pick.market;
  const modelId = String(pick.techModelId ?? "default").trim() || "default";
  const key = notifyFlightKey(sym, market, modelId);
  try {
    withSentFileLock(() => {
      const sent = loadSentFresh();
      writeSentEntry(pick, sent);
      saveSent();
    });
    lastTelegramSendError = null;
  } catch (err) {
    console.warn(
      "[telegram] confirm sent failed:",
      err instanceof Error ? err.message : err,
    );
  } finally {
    notifyInFlight.delete(key);
  }
}

/** @param {object} pick */
function releaseNotifyReserve(pick) {
  notifyInFlight.delete(
    notifyFlightKey(
      normalizeSymbol(pick.symbol),
      pick.market,
      String(pick.techModelId ?? "default").trim() || "default",
    ),
  );
}

function humanizeTelegramError(description, errText) {
  const raw =
    description ||
    (typeof errText === "string" && errText.trim()
      ? errText.trim().slice(0, 240)
      : "unknown");
  const s = raw.toLowerCase();
  if (s.includes("chat not found")) {
    return "TELEGRAM_CHAT_ID 오류 또는 봇이 채팅에 없음 — 그룹/채널에 봇 초대 후 /start, chat_id 재확인";
  }
  if (s.includes("bot was blocked")) {
    return "사용자가 봇을 차단함 — 텔레그램에서 봇 차단 해제 필요";
  }
  if (s.includes("unauthorized") || s.includes("invalid token")) {
    return "TELEGRAM_BOT_TOKEN이 잘못됨 — @BotFather 토큰 재확인";
  }
  if (s.includes("button_url_invalid") || s.includes("wrong http url")) {
    return "종목 보기 URL 오류 — APP_PUBLIC_BASE_URL은 HTTPS 공개 주소만";
  }
  if (s.includes("can't parse entities") || s.includes("parse entities")) {
    return "메시지 HTML 파싱 오류(자동 재시도 후에도 실패)";
  }
  return raw;
}

function recordTelegramSendError(status, description, errText) {
  const message = humanizeTelegramError(description, errText);
  lastTelegramSendError = { atMs: Date.now(), message, status };
}

function htmlToPlainText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isHtmlEntityParseError(description, errText) {
  const s = `${description ?? ""} ${errText ?? ""}`.toLowerCase();
  return (
    s.includes("can't parse entities") ||
    s.includes("cant parse entities") ||
    s.includes("parse entities")
  );
}

function isBadReplyMarkupError(description, errText) {
  const s = `${description ?? ""} ${errText ?? ""}`.toLowerCase();
  return (
    s.includes("reply markup") ||
    s.includes("inline keyboard") ||
    s.includes("button_url_invalid") ||
    s.includes("wrong http url") ||
    s.includes("invalid url")
  );
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ token: string; chatId: string }} creds
 */
async function postTelegramSendMessage(payload, creds) {
  const url = `https://api.telegram.org/bot${creds.token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const errText = await res.text();
  let description = "";
  try {
    const j = JSON.parse(errText);
    description = String(j?.description ?? "");
  } catch {
    /* raw text */
  }
  if (!res.ok) {
    return { ok: false, status: res.status, description, errText };
  }
  return { ok: true, status: res.status, description: "", errText: "" };
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
    maxTechScore: getMaxTechScore(),
    minTelegramScoreRatio: MIN_TELEGRAM_SCORE_RATIO,
    todaySentCount: countTodayTelegramSent(),
    lastError: lastTelegramSendError
      ? {
          message: lastTelegramSendError.message,
          atMs: lastTelegramSendError.atMs,
          status: lastTelegramSendError.status ?? null,
        }
      : null,
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



/** 텔레그램 inline URL 버튼 — HTTPS 공개 URL만 허용 (localhost·http 는 API 400) */
function isValidTelegramInlineUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return false;
    }
    if (
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
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
    const href = u.toString();
    return isValidTelegramInlineUrl(href) ? href : null;
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

  const modelName = String(pick.techModelName ?? pick.techModelId ?? "").trim();
  const weights = pick.techModelWeights;
  const maxScore = getMaxTechScore(weights);
  const minScore = minTelegramScoreRequired(weights);

  return [

    `<b>${flag} ${marketLabel} · 점수 ${Math.round(MIN_TELEGRAM_SCORE_RATIO * 100)}%+ 알림</b>`,

    "",

    modelName ? `🧠 <b>모델</b>  ${escHtml(modelName)}` : "",

    modelName ? "" : null,

    `<b>${escHtml(pick.name)}</b>`,

    `<code>${escHtml(pick.symbol)}</code>`,

    "",

    `📊 조건  <b>${conditionsMet}</b> / ${conditionsTotal} (${conditionsPct}%, 기준 ${minMet}개+)`,

    `<code>${bar}</code>`,

    `📈 가중 점수  <b>${pick.score}</b> / ${maxScore} (알림 기준 ${minScore}점 초과)`,

    "",

    `💰 가격  <b>${escHtml(price)}</b>${chg ? `\n📈 등락  <b>${escHtml(chg)}</b>` : ""}`,

    "",

    `<b>충족 이유</b> (${reasons.length}개)`,

    reasonLines,

    "",

    `<i>🕐 ${time} KST</i>`,

  ]
    .filter((line) => line != null)
    .join("\n");

}



/**
 * @param {string} text
 * @param {object} [replyMarkup]
 * @param {{ token?: string; chatId?: string }} [creds] — 미지정 시 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
 */
export async function sendTelegramMessage(text, replyMarkup, creds) {
  const token = (creds?.token ?? process.env.TELEGRAM_BOT_TOKEN)?.trim();
  const chatId = (creds?.chatId ?? process.env.TELEGRAM_CHAT_ID)?.trim();
  if (!token || !chatId) return false;

  const auth = { token, chatId };
  const base = {
    chat_id: chatId,
    disable_web_page_preview: true,
  };

  /** @type {Record<string, unknown>[]} */
  const attempts = [];
  const trimmed = text.slice(0, 4096);
  if (replyMarkup && typeof replyMarkup === "object") {
    attempts.push({
      ...base,
      text: trimmed,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    attempts.push({ ...base, text: trimmed, parse_mode: "HTML" });
    attempts.push({ ...base, text: htmlToPlainText(trimmed) });
  } else {
    attempts.push({ ...base, text: trimmed, parse_mode: "HTML" });
    attempts.push({ ...base, text: htmlToPlainText(trimmed) });
  }

  let lastFail = null;
  for (let i = 0; i < attempts.length; i += 1) {
    const payload = attempts[i];
    const result = await postTelegramSendMessage(payload, auth);
    if (result.ok) {
      if (i > 0) {
        console.info("[telegram] send ok after fallback", i + 1);
      }
      lastTelegramSendError = null;
      return true;
    }
    lastFail = result;
    const htmlErr = isHtmlEntityParseError(result.description, result.errText);
    const markupErr = isBadReplyMarkupError(result.description, result.errText);
    if (i === 0 && markupErr && attempts.length > 1) continue;
    if (payload.parse_mode === "HTML" && htmlErr && i + 1 < attempts.length) continue;
    if (i + 1 < attempts.length) continue;
    break;
  }

  recordTelegramSendError(
    lastFail?.status,
    lastFail?.description,
    lastFail?.errText,
  );
  console.error(
    "[telegram] send failed:",
    lastFail?.status,
    lastFail?.description || lastFail?.errText?.slice(0, 200),
  );
  return false;
}



/** 스캔 중 고득점(임계 초과)이면 텔레그램 알림 — 정규장 여부와 무관 */

export function notifyHighScorePick(pick) {

  if (!isTelegramNotifyEnabled()) return;

  const weights = pick.techModelWeights;

  if (!meetsTelegramNotifyScore(pick.score, weights)) return;

  const sym = normalizeSymbol(pick.symbol);

  const modelId = String(pick.techModelId ?? "default").trim() || "default";

  if (!tryReserveNotify(pick)) {
    return;
  }

  const text = buildMessage(pick);
  const session = getTradingSessionKey(pick.market);
  const openUrl = buildAppDeepLink(pick);
  const replyMarkup = openUrl
    ? { inline_keyboard: [[{ text: "📈 종목 보기", url: openUrl }]] }
    : undefined;

  const stockCreds = resolveStockTelegramCreds();
  void sendTelegramMessage(text, replyMarkup, stockCreds)
    .then((ok) => {
      if (ok) {
        confirmNotifySent(pick);
        console.log(
          `[telegram:stock] sent ${sym} model=${modelId} score=${pick.score} session=${session}`,
        );
        void import("./live-trade-runner.js")
          .then((m) => m.onHighScorePickForLiveTrading(pick))
          .catch((err) => {
            console.warn(
              "[live-trade:notify]",
              err instanceof Error ? err.message : err,
            );
          });
      } else {
        releaseNotifyReserve(pick);
        console.warn(
          `[telegram:stock] send failed ${sym} score=${pick.score}`,
          lastTelegramSendError?.message ?? "",
        );
      }
    })
    .catch((err) => {
      releaseNotifyReserve(pick);
      recordTelegramSendError(
        undefined,
        err instanceof Error ? err.message : String(err),
        "",
      );
      console.warn(
        "[telegram:stock] send error:",
        err instanceof Error ? err.message : err,
      );
    });
}

/**
 * 운영(Cursor) 웹 에이전트 작업 종료 시 텔레그램 안내 — 요청자·제목·내용 형식.
 * TELEGRAM_OPS_BOT_TOKEN (+ TELEGRAM_OPS_CHAT_ID 또는 TELEGRAM_CHAT_ID) 가 있을 때만 전송.
 *
 * @param {{ requester: string; title: string; body: string }} opts
 */
export function notifyOpsAgentCompleted(opts) {
  if (!isOpsTelegramNotifyEnabled()) return;
  const opsCreds = resolveOpsTelegramCreds();

  const requester = String(opts.requester ?? "").trim() || "—";
  const title = String(opts.title ?? "").trim() || "웹 에이전트";
  let body = String(opts.body ?? "").trim() || "—";
  const max = 3800;
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
    escHtml(body),
  ].join("\n");

  void sendTelegramMessage(text, undefined, opsCreds)
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


