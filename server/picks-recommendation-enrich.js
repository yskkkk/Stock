/**
 * 추천 이력 slim·메타·텔레그램 발송 기록 통합 보강
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchScanCandles } from "./stock-data.js";
import { analyzeTechnicals, weightedScoreFromSignalIds } from "./technical.js";
import { readRecommendationMeta, recommendationMetaKey, upsertRecommendationMeta } from "./picks-recommendation-meta.js";
import { kstYmd, readHistorySync, writeHistorySync } from "./picks-history-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const SIGNAL_CACHE_FILE = path.join(DATA_DIR, "picks-recommendation-signal-cache.json");

/** @type {Map<string, { score?: number | null; price?: number | null; signalIds?: string[]; at: number }> | null} */
let telegramIndexCache = null;

/**
 * @param {string[]} ids
 */
function pickRicherSignalIds(...ids) {
  /** @type {string[]} */
  let best = [];
  let bestW = -1;
  for (const raw of ids) {
    const list = Array.isArray(raw)
      ? raw.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    const w = weightedScoreFromSignalIds(list);
    if (list.length > best.length || (list.length === best.length && w > bestW)) {
      best = list;
      bestW = w;
    }
  }
  return best;
}

/**
 * @param {Record<string, unknown>} sent
 * @returns {Map<string, { score: number | null; price: number | null; signalIds?: string[]; at: number }>}
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
    const signalIds = Array.isArray(entry.signalIds)
      ? entry.signalIds.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    const prev = index.get(idxKey);
    if (!prev || at < prev.at) {
      index.set(idxKey, {
        score,
        price,
        signalIds: signalIds.length ? signalIds : undefined,
        at,
      });
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

/**
 * 추천 이력 일자(KST)·시장·심볼에 텔레그램 알림이 나갔는지.
 * @param {string} date YYYY-MM-DD
 * @param {"kr"|"us"} market
 * @param {string} symbol
 * @returns {{ atMs: number } | null}
 */
export function lookupTelegramNotifyForRecommendation(date, market, symbol) {
  const list = listTelegramNotifiesForRecommendation(date, market, symbol);
  if (!list.length) return null;
  return { atMs: list[0].atMs };
}

/**
 * @param {string} date YYYY-MM-DD
 * @param {"kr"|"us"} market
 * @param {string} symbol
 * @returns {{ modelId: string; modelName: string; atMs: number; score: number | null; signalIds: string[] }[]}
 */
export function listTelegramNotifiesForRecommendation(date, market, symbol) {
  const d = String(date ?? "").trim();
  const m = market === "kr" || market === "us" ? market : null;
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!d || !m || !sym) return [];

  const sent = loadTelegramSentRaw();
  /** @type {{ modelId: string; modelName: string; atMs: number; score: number | null; signalIds: string[] }[]} */
  const out = [];

  for (const [key, entry] of Object.entries(sent)) {
    if (!entry || typeof entry !== "object") continue;
    const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0;
    if (at <= 0 || kstYmd(at) !== d) continue;

    let em = entry.market === "kr" || entry.market === "us" ? entry.market : null;
    let es = String(entry.symbol ?? "").trim().toUpperCase();
    const k = String(key ?? "");
    if (k.includes(":")) {
      const parts = k.split(":");
      if (!em && (parts[0] === "kr" || parts[0] === "us")) em = parts[0];
      if (!es && parts[1]) es = normalizeSymbol(parts[1]);
    }
    if (em !== m || es !== sym) continue;

    const modelId =
      entry.techModelId != null
        ? String(entry.techModelId).trim()
        : k.split(":").length >= 3
          ? String(k.split(":")[2]).trim()
          : "legacy";
    const modelName =
      entry.techModelName != null
        ? String(entry.techModelName).trim()
        : modelId;
    const score =
      typeof entry.score === "number" && Number.isFinite(entry.score)
        ? Math.round(entry.score)
        : null;
    const signalIds = Array.isArray(entry.signalIds)
      ? entry.signalIds.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];

    out.push({
      modelId: modelId || "legacy",
      modelName: modelName || modelId,
      atMs: at,
      score,
      signalIds,
    });
  }

  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "").trim().toUpperCase();
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

  const mergedIds = pickRicherSignalIds(
    slim.signalIds,
    meta?.signalIds,
    tg?.signalIds,
  );
  if (mergedIds.length) slim.signalIds = mergedIds;

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
/**
 * @param {import("./picks-history-store.js").SlimPick} slim
 * @param {string} date
 * @param {"kr"|"us"} market
 */
function recommendationNeedsSignalRefresh(slim, date, market) {
  if (!slim?.symbol) return false;
  const ids = slim.signalIds ?? [];
  if (!ids.length) return true;
  const sc = slim.score;
  if (typeof sc !== "number" || !Number.isFinite(sc) || sc < 8) return false;
  return weightedScoreFromSignalIds(ids) + 3 <= sc;
}

export async function backfillMissingSignalIdsFromTechnical(maxSymbols = 80) {
  const data = readHistorySync();
  const tg = getTelegramBackfillIndex();
  const need = new Set();
  for (const day of data.days) {
    const date = String(day.date ?? "").trim();
    if (!date) continue;
    for (const market of /** @type {const} */ (["kr", "us"])) {
      const arr = market === "kr" ? day.kr : day.us;
      for (const p of arr) {
        if (!p?.symbol) continue;
        if (recommendationNeedsSignalRefresh(p, date, market)) {
          need.add(String(p.symbol).trim().toUpperCase());
        }
      }
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
          const sym = String(slim.symbol).trim().toUpperCase();
          const idxKey = recommendationMetaKey(date, market, sym);
          const meta = readRecommendationMeta(date, market, sym);
          const tgHit = tg.get(idxKey);
          const merged = pickRicherSignalIds(
            slim.signalIds,
            meta?.signalIds,
            tgHit?.signalIds,
          );
          if (merged.length) slim.signalIds = merged;
          if (!recommendationNeedsSignalRefresh(slim, date, market)) {
            upsertRecommendationMeta(date, market, {
              symbol: slim.symbol,
              score: slim.score,
              signalIds: slim.signalIds,
            });
            continue;
          }
          const cache = readSignalCacheSync();
          const hit = cache[sym];
          if (hit?.signalIds?.length) {
            slim.signalIds = pickRicherSignalIds(slim.signalIds, hit.signalIds);
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
