/**
 * 추천 이력 slim·메타·텔레그램 발송 기록 통합 보강
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchScanCandles } from "./stock-data.js";
import { analyzeTechnicals } from "./technical.js";
import { readRecommendationMeta, recommendationMetaKey, upsertRecommendationMeta } from "./picks-recommendation-meta.js";
import { kstYmd, readHistorySync, writeHistorySync } from "./picks-history-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const SIGNAL_CACHE_FILE = path.join(DATA_DIR, "picks-recommendation-signal-cache.json");

/** @type {Map<string, { score?: number | null; price?: number | null }> | null} */
let telegramIndexCache = null;

/**
 * @param {Record<string, unknown>} sent
 * @returns {Map<string, { score: number | null; price: number | null; at: number }>}
 */
function buildTelegramIndexFromSent(sent) {
  const index = new Map();
  for (const [key, entry] of Object.entries(sent)) {
    if (!entry || typeof entry !== "object") continue;
    const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0;
    if (at <= 0) continue;
    const date = kstYmd(at);
    let market = entry.market === "kr" || entry.market === "us" ? entry.market : null;
    let symbol = String(entry.symbol ?? "").trim().toUpperCase();
    const k = String(key ?? "");
    if (k.includes(":")) {
      const [m, s] = k.split(":");
      if (!market && (m === "kr" || m === "us")) market = m;
      if (!symbol) symbol = String(s ?? "").trim().toUpperCase();
    }
    if (!market || !symbol) continue;
    const idxKey = recommendationMetaKey(date, market, symbol);
    const score =
      typeof entry.score === "number" && Number.isFinite(entry.score)
        ? Math.round(entry.score)
        : null;
    const price =
      typeof entry.price === "number" && Number.isFinite(entry.price) && entry.price > 0
        ? entry.price
        : null;
    const prev = index.get(idxKey);
    if (!prev || at < prev.at) {
      index.set(idxKey, { score, price, at });
    }
  }
  return index;
}

function loadTelegramSentRaw() {
  try {
    const p = path.join(DATA_DIR, "telegram-sent.json");
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function getTelegramBackfillIndex() {
  if (!telegramIndexCache) {
    telegramIndexCache = buildTelegramIndexFromSent(loadTelegramSentRaw());
  }
  return telegramIndexCache;
}

function readSignalCacheSync() {
  try {
    if (!fs.existsSync(SIGNAL_CACHE_FILE)) return {};
    const o = JSON.parse(fs.readFileSync(SIGNAL_CACHE_FILE, "utf8"));
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function writeSignalCacheSync(cache) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SIGNAL_CACHE_FILE, JSON.stringify(cache, null, 0), "utf8");
}

/**
 * @param {string} symbol
 * @returns {Promise<string[] | null>}
 */
async function fetchSignalIdsForSymbol(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  const cache = readSignalCacheSync();
  if (Array.isArray(cache[sym]?.signalIds)) {
    return cache[sym].signalIds;
  }
  try {
    const data = await fetchScanCandles(sym);
    const analysis = analyzeTechnicals(data.candles);
    const signalIds = Array.isArray(analysis.signalIds)
      ? analysis.signalIds.map((x) => String(x).trim()).filter(Boolean)
      : [];
    cache[sym] = {
      signalIds,
      score:
        typeof analysis.score === "number" && Number.isFinite(analysis.score)
          ? Math.round(analysis.score)
          : null,
      at: Date.now(),
    };
    writeSignalCacheSync(cache);
    return signalIds;
  } catch {
    cache[sym] = { signalIds: [], score: null, at: Date.now() };
    writeSignalCacheSync(cache);
    return [];
  }
}

/**
 * @param {import("./picks-history-store.js").SlimPick} slim
 * @param {"kr"|"us"} market
 * @param {string} date
 */
export function enrichSlimPickFromBackfill(slim, market, date) {
  if (!slim?.symbol) return slim;
  const key = recommendationMetaKey(date, market, slim.symbol);
  const meta = readRecommendationMeta(date, market, slim.symbol);
  const tg = getTelegramBackfillIndex().get(key);

  if (slim.score == null && meta?.score != null) slim.score = meta.score;
  if (slim.score == null && tg?.score != null) slim.score = tg.score;

  if ((!slim.signalIds || slim.signalIds.length === 0) && meta?.signalIds?.length) {
    slim.signalIds = [...meta.signalIds];
  }

  if (
    (slim.price == null || !(slim.price > 0)) &&
    tg?.price != null &&
    Number.isFinite(tg.price) &&
    tg.price > 0
  ) {
    slim.price = tg.price;
  }

  return slim;
}

/** 디스크 이력·메타·텔레그램 기준 1회 보강(서버 기동·트래커 직전) */
export function reconcileRecommendationHistoryEnrichmentSync() {
  const tg = getTelegramBackfillIndex();
  const data = readHistorySync();
  let changed = false;

  for (const day of data.days) {
    const date = String(day.date ?? "").trim();
    if (!date) continue;
    for (const market of /** @type {const} */ (["kr", "us"])) {
      const arr = market === "kr" ? day.kr : day.us;
      for (const slim of arr) {
        if (!slim?.symbol) continue;
        const key = recommendationMetaKey(date, market, slim.symbol);
        const meta = readRecommendationMeta(date, market, slim.symbol);
        const hit = tg.get(key);

        if (slim.score == null && meta?.score != null) {
          slim.score = meta.score;
          changed = true;
        }
        if (slim.score == null && hit?.score != null) {
          slim.score = hit.score;
          changed = true;
        }
        if ((!slim.signalIds || slim.signalIds.length === 0) && meta?.signalIds?.length) {
          slim.signalIds = [...meta.signalIds];
          changed = true;
        }
        if (
          (slim.price == null || !(slim.price > 0)) &&
          hit?.price != null &&
          hit.price > 0
        ) {
          slim.price = hit.price;
          changed = true;
        }

        upsertRecommendationMeta(date, market, {
          symbol: slim.symbol,
          score: slim.score,
          signalIds: slim.signalIds,
        });
      }
    }
  }

  if (changed) writeHistorySync(data);
  return changed;
}

/**
 * 근거 미기록 건 — 심볼당 1회 기술분석(캐시). 과거 시점 추정이나 새 스캔 반영용.
 * @param {number} [maxSymbols]
 */
export async function backfillMissingSignalIdsFromTechnical(maxSymbols = 80) {
  const data = readHistorySync();
  const need = new Set();
  for (const day of data.days) {
    for (const p of [...(day.kr ?? []), ...(day.us ?? [])]) {
      if (!p?.symbol) continue;
      if (p.signalIds?.length) continue;
      need.add(String(p.symbol).trim().toUpperCase());
    }
  }
  const list = [...need].slice(0, maxSymbols);
  let updated = 0;
  for (const sym of list) {
    const ids = await fetchSignalIdsForSymbol(sym);
    if (!ids) continue;
    updated++;
  }

  if (updated > 0) {
    for (const day of data.days) {
      const date = String(day.date ?? "").trim();
      if (!date) continue;
      for (const market of /** @type {const} */ (["kr", "us"])) {
        const arr = market === "kr" ? day.kr : day.us;
        for (const slim of arr) {
          if (slim.signalIds?.length) continue;
          const cache = readSignalCacheSync();
          const hit = cache[String(slim.symbol).trim().toUpperCase()];
          if (hit?.signalIds?.length) {
            slim.signalIds = [...hit.signalIds];
            if (slim.score == null && hit.score != null) slim.score = hit.score;
          }
          upsertRecommendationMeta(date, market, {
            symbol: slim.symbol,
            score: slim.score,
            signalIds: slim.signalIds,
          });
        }
      }
    }
    writeHistorySync(data);
  }
  return { symbolsProcessed: list.length, cacheUpdated: updated };
}
