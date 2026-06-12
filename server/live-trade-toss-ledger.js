/**
 * 토스 계좌 스냅샷 캐시 — UI·좌측 레일 표시용
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { fetchTossAccountRawWithCredentials } from "./toss-openapi.js";
import { summarizeTossAccountsForDisplay } from "./toss-accounts-summary.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { resolveServerDataDir } from "./data-path.js";
import { markPollerBootStarted, pollerGuardAsync, pollerGuardSync } from "./poller-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {{ snapshot?: object | null; feeLabelKo?: string | null; tossRoundTripFeeRate?: number | null; snapshotSyncedAtMs?: number }} TossLedgerUserRow */

function ledgerFilePath() {
  return path.join(resolveServerDataDir(), "live-trade-toss-ledger.json");
}

function ensureDataDirSync() {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function defaultStore() {
  return { users: /** @type {Record<string, TossLedgerUserRow>} */ ({}) };
}

function readStoreSync() {
  const fp = ledgerFilePath();
  try {
    if (!fs.existsSync(fp)) return defaultStore();
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (!parsed?.users || typeof parsed.users !== "object") return defaultStore();
    return /** @type {{ users: Record<string, TossLedgerUserRow> }} */ (parsed);
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

function persistUserRow(userId, patch) {
  const uid = String(userId ?? "").trim();
  if (!uid) return;
  const store = readStoreSync();
  const prev = store.users[uid] ?? {};
  store.users[uid] = { ...prev, ...patch };
  writeStoreSync(store);
}

/**
 * @param {string} userId
 */
export function getTossLedgerSnapshotCacheSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  const row = readStoreSync().users[uid];
  if (!row?.snapshot) return null;
  return {
    ready: true,
    snapshot: row.snapshot,
    feeLabelKo: row.feeLabelKo ?? null,
    tossRoundTripFeeRate: row.tossRoundTripFeeRate ?? null,
    syncedAtMs: row.snapshotSyncedAtMs ?? null,
    fromCache: true,
  };
}

/**
 * @param {string} userId
 */
export async function refreshTossLedgerSnapshotForUserAsync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) {
    return { ready: false, messageKo: "로그인이 필요합니다." };
  }

  const { getCredentialMetaSync } = await import("./user-credentials-store.js");
  const meta = getCredentialMetaSync(uid, "toss");
  if (!meta.ready) {
    return {
      ready: false,
      messageKo:
        meta.messageKo ??
        "토스 API Key·Secret·계좌 ID를 실거래 탭에서 저장하세요.",
    };
  }

  const creds = getDecryptedCredentialsSync(uid, "toss");
  if (!creds?.apiKey || !creds?.secretKey) {
    return { ready: false, messageKo: "토스 API Key·Secret Key를 저장하세요." };
  }

  try {
    const raw = await fetchTossAccountRawWithCredentials(creds);
    if (raw.accountSeq) {
      const { saveTossAccountIdIfMissingSync } = await import(
        "./user-credentials-store.js"
      );
      saveTossAccountIdIfMissingSync(uid, raw.accountSeq);
    }
    const snapshot = summarizeTossAccountsForDisplay(raw);

    let feeLabelKo = null;
    let tossRoundTripFeeRate = null;
    try {
      const {
        ensureUserTradingFeesFreshAsync,
        getUserTradingFeeRatesForApiSync,
        refreshTossFeesForUserAsync,
      } = await import("./exchange-trading-fees.js");
      await refreshTossFeesForUserAsync(uid).catch(() => null);
      await ensureUserTradingFeesFreshAsync(uid);
      const tossFees = getUserTradingFeeRatesForApiSync(uid).toss;
      feeLabelKo = tossFees?.labelKo ?? null;
      tossRoundTripFeeRate = tossFees?.roundTripFeeRate ?? null;
    } catch {
      /* 수수료 라벨 없어도 잔고·보유는 표시 */
    }

    const syncedAtMs = Date.now();
    persistUserRow(uid, {
      snapshot,
      feeLabelKo,
      tossRoundTripFeeRate,
      snapshotSyncedAtMs: syncedAtMs,
    });

    return {
      ready: true,
      snapshot,
      feeLabelKo,
      tossRoundTripFeeRate,
      syncedAtMs,
      fromCache: false,
    };
  } catch (e) {
    liveTradeLogWarn(
      "[toss-ledger] sync failed",
      uid,
      e instanceof Error ? e.message : e,
    );
    const cached = getTossLedgerSnapshotCacheSync(uid);
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

const TOSS_LEDGER_CACHE_TICK_MS = (() => {
  const n = Number(process.env.STOCK_TOSS_LEDGER_CACHE_MS ?? 1_000);
  return Number.isFinite(n) && n >= 500 ? Math.min(n, 5_000) : 1_000;
})();

const TOSS_LEDGER_API_REFRESH_MS = (() => {
  const n = Number(process.env.STOCK_TOSS_LEDGER_API_MS ?? 15_000);
  return Number.isFinite(n) && n >= 5_000 ? Math.min(n, 120_000) : 15_000;
})();

/**
 * 파일 캐시 터치 — 클라이언트 1초 폴링 시 디스크에서 즉시 읽기
 * @param {string} userId
 */
export function touchTossLedgerSnapshotCacheSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return false;
  const cached = getTossLedgerSnapshotCacheSync(uid);
  if (!cached?.snapshot) return false;
  persistUserRow(uid, {
    snapshot: cached.snapshot,
    feeLabelKo: cached.feeLabelKo ?? null,
    tossRoundTripFeeRate: cached.tossRoundTripFeeRate ?? null,
    snapshotSyncedAtMs: cached.syncedAtMs ?? Date.now(),
  });
  return true;
}

export async function tickTossLedgerApiRefreshAsync() {
  const { listTossReadyUserIdsSync } = await import("./user-credentials-store.js");
  const uids = listTossReadyUserIdsSync();
  for (const uid of uids) {
    try {
      await refreshTossLedgerSnapshotForUserAsync(uid);
    } catch {
      /* 개별 사용자 실패는 다음 턴 */
    }
  }
  return { users: uids.length };
}

export function tickTossLedgerCacheTouch() {
  const store = readStoreSync();
  let touched = 0;
  for (const uid of Object.keys(store.users ?? {})) {
    if (touchTossLedgerSnapshotCacheSync(uid)) touched += 1;
  }
  return { touched };
}

/** 토스 장부 — 파일 캐시 1초 터치 + Open API 주기 갱신 */
export function startTossLedgerSnapshotPoller() {
  if (process.env.STOCK_TOSS_LEDGER_POLL === "0") return;

  const g = /** @type {typeof globalThis & { __stockTossLedgerPollerStarted?: boolean }} */ (
    globalThis
  );
  if (g.__stockTossLedgerPollerStarted) return;
  g.__stockTossLedgerPollerStarted = true;

  let apiRunning = false;

  markPollerBootStarted("toss-ledger-cache");
  markPollerBootStarted("toss-ledger-api");

  setInterval(() => {
    pollerGuardSync("toss-ledger-cache", () => {
      tickTossLedgerCacheTouch();
    });
  }, TOSS_LEDGER_CACHE_TICK_MS);

  const loopApi = () => {
    if (apiRunning) return;
    apiRunning = true;
    pollerGuardAsync("toss-ledger-api", () => tickTossLedgerApiRefreshAsync())
      .catch((e) => {
        liveTradeLogWarn(
          "[toss-ledger] poller",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        apiRunning = false;
        setTimeout(loopApi, TOSS_LEDGER_API_REFRESH_MS);
      });
  };

  liveTradeLogInfo(
    "[toss-ledger] poller",
    `cache ${TOSS_LEDGER_CACHE_TICK_MS}ms · api ${TOSS_LEDGER_API_REFRESH_MS}ms`,
  );
  loopApi();
}
