let active = 0;
const waiters = [];
let lastStartAt = 0;
let rateLimitUntil = 0;

/** @type {{ maxConcurrent?: number; minGapMs?: number } | null} */
let scanTune = null;

/**
 * 대량 스캔 구간 — Yahoo 동시성·간격 임시 상향 (스캔 종료 시 복원)
 * @param {{ maxConcurrent?: number; minGapMs?: number }} tune
 * @param {() => Promise<unknown> | unknown} fn
 */
export async function runWithYahooScanTune(tune, fn) {
  const prev = scanTune;
  scanTune = tune ?? null;
  try {
    return await fn();
  } finally {
    scanTune = prev;
  }
}

function maxConcurrent() {
  const tuned = scanTune?.maxConcurrent;
  if (tuned != null && Number.isFinite(tuned) && tuned >= 1) {
    return Math.min(8, Math.floor(tuned));
  }
  const n = Number(process.env.YAHOO_MAX_CONCURRENT);
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.floor(n)) : 3;
}

function minGapMs() {
  const tuned = scanTune?.minGapMs;
  if (tuned != null && Number.isFinite(tuned) && tuned >= 0) {
    return tuned;
  }
  const n = Number(process.env.YAHOO_REQUEST_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? n : 400;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function release() {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

async function acquire() {
  while (Date.now() < rateLimitUntil) {
    await sleep(200);
  }
  while (active >= maxConcurrent()) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  const gap = minGapMs() - (Date.now() - lastStartAt);
  if (gap > 0) await sleep(gap);
  lastStartAt = Date.now();
  active += 1;
}

export function markRateLimited(ms = 12_000) {
  rateLimitUntil = Math.max(rateLimitUntil, Date.now() + ms);
}

/** Yahoo API 호출 — 제한적 병렬 + 최소 간격 */
export function queueYahooRequest(task) {
  return (async () => {
    await acquire();
    try {
      return await task();
    } catch (err) {
      if (err?.code === "RATE_LIMIT") markRateLimited();
      throw err;
    } finally {
      release();
    }
  })();
}
