/**
 * 빗썸 계좌 잔고 캐시(장부 보조) — 매도 시 주문가능 수량 기준, 매매 직후·주기 동기화
 */
import { listArmedLiveTradeProgramsSync } from "./live-trade-programs-store.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { fetchBithumbAccountsWithCredentials } from "./bithumb-trading-adapter.js";
import {
  bithumbAccountQtyMapsFromAccounts,
  getBithumbExchangeQtyMaps,
} from "./live-trade-bithumb-reconcile.js";
import { normalizeSellQuantity } from "./live-trade-market.js";
import { liveTradeLogWarn } from "./live-trade-log.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_BITHUMB_LEDGER_POLL_MS ?? 600_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 3_600_000) : 600_000;
})();

/** @typedef {{ total: number; available: number; locked: number; syncedAtMs: number }} BithumbBaseLedger */

/** @type {Map<string, Map<string, BithumbBaseLedger>>} */
const byUser = new Map();

/**
 * @param {string} userId
 * @param {{ total: Map<string, number>; available: Map<string, number> }} maps
 */
export function applyBithumbLedgerMaps(userId, maps) {
  const uid = String(userId ?? "").trim();
  if (!uid) return;
  /** @type {Map<string, BithumbBaseLedger>} */
  const next = new Map();
  const keys = new Set([...maps.total.keys(), ...maps.available.keys()]);
  const now = Date.now();
  for (const base of keys) {
    const total = maps.total.get(base) ?? 0;
    const available = maps.available.get(base) ?? 0;
    next.set(base, {
      total,
      available,
      locked: Math.max(0, total - available),
      syncedAtMs: now,
    });
  }
  byUser.set(uid, next);
}

/**
 * @param {import("./bithumb-trading-adapter.js").BithumbCredentials} credentials
 */
export async function refreshBithumbLedgerForUser(userId, credentials) {
  const uid = String(userId ?? "").trim();
  if (!uid || !credentials?.apiKey) return false;
  try {
    const maps = await getBithumbExchangeQtyMaps(credentials);
    applyBithumbLedgerMaps(uid, maps);
    return true;
  } catch (e) {
    liveTradeLogWarn(
      "[bithumb-ledger] sync failed",
      uid,
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}

/**
 * @param {string} userId
 * @param {string} base
 */
export function getBithumbLedgerAvailable(userId, base) {
  const b = String(base ?? "").trim().toUpperCase();
  const row = byUser.get(String(userId ?? "").trim())?.get(b);
  return row?.available ?? null;
}

/**
 * 매도 주문 전 장부에서 차감(낙관적) — 체결 실패 시 다음 sync에서 복구
 * @param {string} userId
 * @param {string} base
 * @param {number} qty
 */
export function deductBithumbLedgerAvailable(userId, base, qty) {
  const uid = String(userId ?? "").trim();
  const b = String(base ?? "").trim().toUpperCase();
  const m = byUser.get(uid);
  if (!m) return;
  const row = m.get(b);
  if (!row) return;
  const q = normalizeSellQuantity(qty, "crypto");
  if (q <= 0) return;
  row.available = Math.max(0, row.available - q);
  row.syncedAtMs = Date.now();
}

/**
 * @param {number} requestedVolume
 * @param {string} userId
 * @param {string} base
 * @param {number} [fallbackAvailable]
 */
export function resolveSellVolumeFromLedger(
  requestedVolume,
  userId,
  base,
  fallbackAvailable = 0,
) {
  const ledgerAvail = getBithumbLedgerAvailable(userId, base);
  const avail =
    ledgerAvail != null && Number.isFinite(ledgerAvail)
      ? ledgerAvail
      : Number(fallbackAvailable);
  const app = Number(requestedVolume);
  if (!Number.isFinite(app) || app <= 0) return { volume: 0, clamped: false };
  const volume = normalizeSellQuantity(Math.min(app, Math.max(0, avail)), "crypto");
  return { volume, clamped: volume + 1e-8 < app };
}

export async function tickBithumbLedgerPoll() {
  const uids = new Set();
  for (const p of listArmedLiveTradeProgramsSync()) {
    if (!p.markets?.crypto) continue;
    const uid = String(p.userId ?? "").trim();
    if (uid) uids.add(uid);
  }
  for (const uid of uids) {
    const creds = getDecryptedCredentialsSync(uid, "bithumb");
    if (creds?.apiKey && creds?.secretKey) {
      await refreshBithumbLedgerForUser(uid, creds);
    }
  }
  return { users: uids.size };
}

export function startBithumbLedgerPoller() {
  if (process.env.STOCK_BITHUMB_LEDGER_POLL === "0") return;
  const g = /** @type {typeof globalThis & { __stockBithumbLedgerPoll?: boolean }} */ (
    globalThis
  );
  if (g.__stockBithumbLedgerPoll) return;
  g.__stockBithumbLedgerPoll = true;
  const loop = () => {
    tickBithumbLedgerPoll().catch((e) => {
      liveTradeLogWarn(
        "[bithumb-ledger]",
        e instanceof Error ? e.message : e,
      );
    });
  };
  loop();
  setInterval(loop, POLL_MS);
}

export { fetchBithumbAccountsWithCredentials };
