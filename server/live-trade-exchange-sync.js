/**
 * 실매매(armed) 사용자 — 빗썸 잔고·체결 10초마다 서버 포트폴리오 동기화
 * (거래소에서 수동 매도한 뒤에도 앱 보유가 남아 자동매도·매도 신호가 나가는 문제 방지)
 */
import { listArmedLiveTradeProgramsSync } from "./live-trade-programs-store.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { reconcileBithumbHoldingsForUser } from "./live-trade-bithumb-reconcile.js";
import { persistBithumbExchangeTradesForUser } from "./live-trade-bithumb-exchange-trades.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

const LOG_TAG = "[live-trade:exchange-sync]";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_LIVE_TRADE_EXCHANGE_SYNC_MS ?? 10_000);
  return Number.isFinite(n) && n >= 5_000 ? Math.min(n, 60_000) : 10_000;
})();

/**
 * @returns {Map<string, import("./live-trade-programs-store.js").LiveTradeProgram[]>}
 */
function armedProgramsByUser() {
  /** @type {Map<string, import("./live-trade-programs-store.js").LiveTradeProgram[]>} */
  const byUser = new Map();
  for (const p of listArmedLiveTradeProgramsSync()) {
    const uid = String(p.userId ?? "").trim();
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(p);
  }
  return byUser;
}

/**
 * @param {string} userId
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 */
export async function syncLiveTradeExchangeForUser(userId, programs) {
  const uid = String(userId ?? "").trim();
  if (!uid || !programs.length) {
    return { reconciled: 0, sellsRecorded: 0 };
  }

  const credentials = getDecryptedCredentialsSync(uid, "bithumb");
  if (!credentials?.apiKey || !credentials?.secretKey) {
    return { reconciled: 0, sellsRecorded: 0, skipped: "no_bithumb" };
  }

  const cryptoPrograms = programs.filter(
    (p) => p.markets?.crypto && p.status === "armed",
  );
  if (!cryptoPrograms.length) {
    return { reconciled: 0, sellsRecorded: 0, skipped: "no_crypto_armed" };
  }

  const reconcile = await reconcileBithumbHoldingsForUser(uid);
  const tradeSync = await persistBithumbExchangeTradesForUser(uid, cryptoPrograms);

  const recorded = reconcile.recorded?.length ?? 0;
  if (recorded > 0 || tradeSync.sellsRecorded > 0) {
    liveTradeLogInfo(
      LOG_TAG,
      uid,
      `reconcile=${recorded}`,
      `trades=${tradeSync.sellsRecorded}`,
    );
  }

  return {
    reconciled: recorded,
    sellsRecorded: tradeSync.sellsRecorded,
    symbolsChecked: tradeSync.symbolsChecked,
  };
}

export async function tickLiveTradeExchangeSync() {
  const byUser = armedProgramsByUser();
  if (!byUser.size) return { users: 0 };

  let users = 0;
  for (const [userId, programs] of byUser) {
    users += 1;
    try {
      await syncLiveTradeExchangeForUser(userId, programs);
    } catch (e) {
      liveTradeLogWarn(
        LOG_TAG,
        userId,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return { users };
}

export function startLiveTradeExchangeSyncPoller() {
  if (process.env.STOCK_LIVE_TRADE_EXCHANGE_SYNC === "0") return;

  const g = /** @type {typeof globalThis & { __stockLiveTradeExchangeSyncStarted?: boolean }} */ (
    globalThis
  );
  if (g.__stockLiveTradeExchangeSyncStarted) return;
  g.__stockLiveTradeExchangeSyncStarted = true;

  let running = false;

  const loop = () => {
    if (running) return;
    running = true;
    tickLiveTradeExchangeSync()
      .catch((e) => {
        liveTradeLogWarn(LOG_TAG, e instanceof Error ? e.message : e);
      })
      .finally(() => {
        running = false;
        setTimeout(loop, POLL_MS);
      });
  };

  liveTradeLogInfo(LOG_TAG, `poller ${POLL_MS}ms`);
  loop();
}
