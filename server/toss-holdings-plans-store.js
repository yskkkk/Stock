/**
 * 토스 보유 종목별 목표 매수·매도·손절 계획 (사용자별)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveServerDataDir } from "./data-path.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function storePath() {
  return path.join(resolveServerDataDir(), "toss-holdings-plans.json");
}

function defaultStore() {
  return { users: /** @type {Record<string, { plans: Record<string, object> }>} */ ({}) };
}

function readStoreSync() {
  const fp = storePath();
  try {
    if (!fs.existsSync(fp)) return defaultStore();
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (!parsed?.users || typeof parsed.users !== "object") return defaultStore();
    return parsed;
  } catch {
    return defaultStore();
  }
}

function writeStoreSync(store) {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = storePath();
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, fp);
}

/**
 * @param {string} symbol
 */
function normSymbol(symbol) {
  return String(symbol ?? "").trim().toUpperCase();
}

/**
 * @param {number | null | undefined} v
 */
function clampPrice(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {string} userId
 * @param {string} symbol
 */
export function getTossHoldingPlanSync(userId, symbol) {
  const uid = String(userId ?? "").trim();
  const sym = normSymbol(symbol);
  if (!uid || !sym) return null;
  const row = readStoreSync().users[uid]?.plans?.[sym];
  if (!row || typeof row !== "object") return null;
  return {
    symbol: sym,
    targetBuyPrice: clampPrice(row.targetBuyPrice),
    targetBuyAmountKrw: clampPrice(row.targetBuyAmountKrw),
    targetBuyAmountUsd: clampPrice(row.targetBuyAmountUsd),
    targetSellPrice: clampPrice(row.targetSellPrice),
    stopLossPrice: clampPrice(row.stopLossPrice),
    notes: String(row.notes ?? "").trim() || null,
    updatedAtMs: Number(row.updatedAtMs) || null,
  };
}

/**
 * @param {string} userId
 */
export function listTossHoldingPlansSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return {};
  const plans = readStoreSync().users[uid]?.plans ?? {};
  /** @type {Record<string, ReturnType<typeof getTossHoldingPlanSync>>} */
  const out = {};
  for (const sym of Object.keys(plans)) {
    const p = getTossHoldingPlanSync(uid, sym);
    if (p) out[sym] = p;
  }
  return out;
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {object} patch
 */
export function upsertTossHoldingPlanSync(userId, symbol, patch) {
  const uid = String(userId ?? "").trim();
  const sym = normSymbol(symbol);
  if (!uid || !sym) throw new Error("잘못된 요청입니다.");

  const store = readStoreSync();
  if (!store.users[uid]) store.users[uid] = { plans: {} };
  if (!store.users[uid].plans) store.users[uid].plans = {};

  const prev = store.users[uid].plans[sym] ?? {};
  const market = String(patch?.market ?? prev.market ?? "kr").trim().toLowerCase();

  const row = {
    symbol: sym,
    market: market === "us" ? "us" : "kr",
    targetBuyPrice:
      patch.targetBuyPrice !== undefined
        ? clampPrice(patch.targetBuyPrice)
        : clampPrice(prev.targetBuyPrice),
    targetBuyAmountKrw:
      patch.targetBuyAmountKrw !== undefined
        ? clampPrice(patch.targetBuyAmountKrw)
        : clampPrice(prev.targetBuyAmountKrw),
    targetBuyAmountUsd:
      patch.targetBuyAmountUsd !== undefined
        ? clampPrice(patch.targetBuyAmountUsd)
        : clampPrice(prev.targetBuyAmountUsd),
    targetSellPrice:
      patch.targetSellPrice !== undefined
        ? clampPrice(patch.targetSellPrice)
        : clampPrice(prev.targetSellPrice),
    stopLossPrice:
      patch.stopLossPrice !== undefined
        ? clampPrice(patch.stopLossPrice)
        : clampPrice(prev.stopLossPrice),
    notes:
      patch.notes !== undefined
        ? String(patch.notes ?? "").trim() || null
        : String(prev.notes ?? "").trim() || null,
    updatedAtMs: Date.now(),
  };

  store.users[uid].plans[sym] = row;
  writeStoreSync(store);
  return getTossHoldingPlanSync(uid, sym);
}
