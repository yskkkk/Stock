/**
 * 실매매 매도 단일 비행 락 — 종목(유저·시장·심볼) 단위.
 * 박스권 FSM · 토스 수동 매도 등이 await 중 겹치지 않게 한다.
 */

/** @type {Set<string>} */
const inflight = new Set();

/**
 * @param {string} userId
 * @param {string} market
 * @param {string} symbol
 */
export function liveTradeSellLockKey(userId, market, symbol) {
  const uid = String(userId ?? "").trim() || "_";
  const m = String(market ?? "").trim().toLowerCase() || "_";
  const sym = String(symbol ?? "").trim().toUpperCase() || "_";
  return `${uid}:${m}:${sym}`;
}

/** @param {string} key */
export function tryAcquireLiveTradeSellLock(key) {
  const k = String(key ?? "").trim();
  if (!k) return false;
  if (inflight.has(k)) return false;
  inflight.add(k);
  return true;
}

/** @param {string} key */
export function releaseLiveTradeSellLock(key) {
  const k = String(key ?? "").trim();
  if (k) inflight.delete(k);
}

/**
 * @template T
 * @param {string} key
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<{ ok: true; value: T } | { ok: false; error: string }>}
 */
export async function withLiveTradeSellLock(key, fn) {
  if (!tryAcquireLiveTradeSellLock(key)) {
    return { ok: false, error: "같은 종목 매도가 이미 진행 중입니다." };
  }
  try {
    const value = await fn();
    return { ok: true, value };
  } finally {
    releaseLiveTradeSellLock(key);
  }
}

/** @param {string} key */
export function isLiveTradeSellLocked(key) {
  return inflight.has(String(key ?? "").trim());
}
