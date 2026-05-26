/**
 * 빗썸 계좌 잔고 캐시(장부) — 파일 영속 + 메모리, UI는 요청·화면 노출 시 동기화
 */
import fs from "node:fs";
import path from "node:path";
import { listArmedLiveTradeProgramsSync } from "./live-trade-programs-store.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { fetchBithumbAccountsWithCredentials } from "./bithumb-trading-adapter.js";
import {
  bithumbAccountQtyMapsFromAccounts,
  getBithumbExchangeQtyMaps,
} from "./live-trade-bithumb-reconcile.js";
import {
  enrichBithumbSnapshotWithMarketQuotes,
  summarizeBithumbAccountsForDisplay,
} from "./bithumb-accounts-summary.js";
import { normalizeSellQuantity } from "./live-trade-market.js";
import { liveTradeLogWarn } from "./live-trade-log.js";
import { resolveServerDataDir } from "./data-path.js";

/** @typedef {{ total: number; available: number; locked: number; syncedAtMs: number }} BithumbBaseLedger */

/** @typedef {{
 *   ledger?: Record<string, BithumbBaseLedger>;
 *   snapshot?: object | null;
 *   feeLabelKo?: string | null;
 *   snapshotSyncedAtMs?: number;
 * }} BithumbLedgerUserRow */

function ledgerFilePath() {
  return path.join(resolveServerDataDir(), "live-trade-bithumb-ledger.json");
}

function ensureDataDirSync() {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function defaultStore() {
  return { users: /** @type {Record<string, BithumbLedgerUserRow>} */ ({}) };
}

function readStoreSync() {
  const fp = ledgerFilePath();
  try {
    if (!fs.existsSync(fp)) return defaultStore();
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (!parsed || typeof parsed !== "object") return defaultStore();
    if (!parsed.users || typeof parsed.users !== "object") {
      return { users: {} };
    }
    return /** @type {{ users: Record<string, BithumbLedgerUserRow> }} */ (parsed);
  } catch {
    return defaultStore();
  }
}

function writeStoreSync(store) {
  ensureDataDirSync();
  const fp = ledgerFilePath();
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, fp);
}

/** @type {Map<string, Map<string, BithumbBaseLedger>>} */
const byUser = new Map();

function serializeLedgerMap(ledgerMap) {
  /** @type {Record<string, BithumbBaseLedger>} */
  const ledger = {};
  for (const [base, row] of ledgerMap) {
    ledger[base] = { ...row };
  }
  return ledger;
}

function persistUserRow(userId, patch) {
  const uid = String(userId ?? "").trim();
  if (!uid) return;
  const store = readStoreSync();
  const prev = store.users[uid] ?? {};
  store.users[uid] = { ...prev, ...patch };
  writeStoreSync(store);
}

function persistLedgerMaps(userId) {
  const uid = String(userId ?? "").trim();
  const m = byUser.get(uid);
  if (!m) return;
  persistUserRow(uid, { ledger: serializeLedgerMap(m) });
}

function hydrateMemoryFromDisk() {
  const store = readStoreSync();
  for (const [uid, row] of Object.entries(store.users ?? {})) {
    const ledger = row.ledger;
    if (!ledger || typeof ledger !== "object") continue;
    /** @type {Map<string, BithumbBaseLedger>} */
    const next = new Map();
    for (const [base, entry] of Object.entries(ledger)) {
      if (!entry || typeof entry !== "object") continue;
      next.set(String(base).toUpperCase(), {
        total: Number(entry.total) || 0,
        available: Number(entry.available) || 0,
        locked: Number(entry.locked) || 0,
        syncedAtMs: Number(entry.syncedAtMs) || 0,
      });
    }
    if (next.size > 0) byUser.set(uid, next);
  }
}

hydrateMemoryFromDisk();

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
  persistLedgerMaps(uid);
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
  persistLedgerMaps(uid);
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

/**
 * 파일 캐시 — UI 즉시 표시용(거래소 미호출)
 * @param {string} userId
 */
export function getBithumbLedgerSnapshotCacheSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  const row = readStoreSync().users[uid];
  if (!row?.snapshot) return null;
  return {
    ready: true,
    snapshot: row.snapshot,
    feeLabelKo: row.feeLabelKo ?? null,
    syncedAtMs: row.snapshotSyncedAtMs ?? null,
    fromCache: true,
  };
}

/**
 * 빗썸 /v1/accounts 폴링 → 장부·스냅샷 파일·메모리 갱신
 * @param {string} userId
 */
export async function refreshBithumbLedgerSnapshotForUserAsync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) {
    return { ready: false, messageKo: "로그인이 필요합니다." };
  }
  const { getCredentialMetaSync } = await import("./user-credentials-store.js");
  const meta = getCredentialMetaSync(uid, "bithumb");
  if (!meta.ready) {
    return {
      ready: false,
      messageKo:
        meta.messageKo ?? "빗썸 API Key·Secret을 실거래 탭에서 저장하세요.",
    };
  }
  const creds = getDecryptedCredentialsSync(uid, "bithumb");
  if (!creds?.apiKey || !creds?.secretKey) {
    return { ready: false, messageKo: "빗썸 API 키를 저장하세요." };
  }

  try {
    const accounts = await fetchBithumbAccountsWithCredentials(creds);
    const maps = bithumbAccountQtyMapsFromAccounts(accounts);
    applyBithumbLedgerMaps(uid, maps);

    const snapshot = await enrichBithumbSnapshotWithMarketQuotes(
      summarizeBithumbAccountsForDisplay(accounts),
    );
    let feeLabelKo = null;
    try {
      const { ensureUserTradingFeesFreshAsync, getUserTradingFeeRatesForApiSync } =
        await import("./exchange-trading-fees.js");
      await ensureUserTradingFeesFreshAsync(uid);
      feeLabelKo = getUserTradingFeeRatesForApiSync(uid).bithumb?.labelKo ?? null;
    } catch {
      /* 수수료 라벨 없어도 잔고·보유는 표시 */
    }

    const syncedAtMs = Date.now();
    persistUserRow(uid, {
      snapshot,
      feeLabelKo,
      snapshotSyncedAtMs: syncedAtMs,
    });

    return {
      ready: true,
      snapshot,
      feeLabelKo,
      syncedAtMs,
      fromCache: false,
    };
  } catch (e) {
    const cached = getBithumbLedgerSnapshotCacheSync(uid);
    if (cached) {
      return {
        ...cached,
        stale: true,
        messageKo: e instanceof Error ? e.message : String(e),
      };
    }
    return {
      ready: false,
      error: e instanceof Error ? e.message : String(e),
      messageKo: e instanceof Error ? e.message : String(e),
    };
  }
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
      await refreshBithumbLedgerSnapshotForUserAsync(uid);
    }
  }
  return { users: uids.size };
}

/** @deprecated 백그라운드 주기 폴링 제거 — UI 노출 시 클라이언트가 refresh=1 로 요청 */
export function startBithumbLedgerPoller() {
  hydrateMemoryFromDisk();
}

export { fetchBithumbAccountsWithCredentials };
