/**
 * Yahoo API 호출 큐 — 제한적 병렬 + 최소 간격 + rate-limit 쿨다운.
 *
 * rate limit 시:
 *  - 전역 cool-down (Retry-After / 누적 백오프)
 *  - acquire() 가 cool-down 동안 신규 요청을 막음
 *  - waitForYahooQueueReady() 로 재시도 전에 안전하게 대기
 */

let active = 0;
const waiters = [];
let lastStartAt = 0;
let rateLimitUntil = 0;
let consecutiveRateLimits = 0;

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
    await sleep(Math.min(250, Math.max(50, rateLimitUntil - Date.now())));
  }
  while (active >= maxConcurrent()) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  // cool-down 해제 직후 웨이터가 한꺼번에 풀리면 다시 429 → 갭 재확인
  while (Date.now() < rateLimitUntil) {
    await sleep(Math.min(250, Math.max(50, rateLimitUntil - Date.now())));
  }
  const gap = minGapMs() - (Date.now() - lastStartAt);
  if (gap > 0) await sleep(gap);
  lastStartAt = Date.now();
  active += 1;
}

/**
 * @param {number} [ms] Retry-After(ms). 없으면 누적 백오프(12s·24s·…·최대 60s).
 */
export function markRateLimited(ms) {
  consecutiveRateLimits += 1;
  let waitMs;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
    // Retry-After 존중 + 반복 시 가산(너무 짧은 헤더는 3s 하한)
    const bonus = Math.min(30_000, Math.max(0, consecutiveRateLimits - 1) * 4_000);
    waitMs = Math.min(120_000, Math.max(3_000, ms) + bonus);
  } else {
    waitMs = Math.min(60_000, 12_000 * Math.max(1, consecutiveRateLimits));
  }
  rateLimitUntil = Math.max(rateLimitUntil, Date.now() + waitMs);
}

/** 성공 응답 시 누적 rate-limit 카운터 리셋 */
export function noteYahooSuccess() {
  consecutiveRateLimits = 0;
}

/** @returns {number} cool-down 남은 ms (0이면 즉시 가능) */
export function yahooRateLimitRemainingMs() {
  return Math.max(0, rateLimitUntil - Date.now());
}

/** 테스트 전용 — cool-down·카운터 초기화 */
export function resetYahooQueueForTests() {
  rateLimitUntil = 0;
  consecutiveRateLimits = 0;
  lastStartAt = 0;
}

/** 테스트 전용 — 정확한 cool-down ms 설정(백오프 무시) */
export function armYahooRateLimitForTests(ms) {
  const n = Number(ms);
  rateLimitUntil = Date.now() + (Number.isFinite(n) && n > 0 ? n : 0);
}

/**
 * rate-limit cool-down 이 풀릴 때까지 대기 + (선택) 최소 추가 대기·지터.
 * 재시도 루프에서 acquire 전에 호출해 짧은 sleep 으로 cool-down 을 무시하지 않게 함.
 * @param {{ minWaitMs?: number; jitterMs?: number }} [opts]
 */
export async function waitForYahooQueueReady(opts = {}) {
  const minWaitMs = Math.max(0, Number(opts.minWaitMs) || 0);
  const jitterMs = Math.max(0, Number(opts.jitterMs) || 0);
  while (Date.now() < rateLimitUntil) {
    await sleep(Math.min(250, Math.max(50, rateLimitUntil - Date.now())));
  }
  const extra = minWaitMs + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
  if (extra > 0) await sleep(extra);
}

/** Yahoo API 호출 — 제한적 병렬 + 최소 간격 */
export function queueYahooRequest(task) {
  return (async () => {
    await acquire();
    try {
      const result = await task();
      noteYahooSuccess();
      return result;
    } catch (err) {
      if (err?.code === "RATE_LIMIT") {
        const retryAfter =
          err && typeof err === "object" && typeof err.retryAfterMs === "number"
            ? err.retryAfterMs
            : undefined;
        markRateLimited(retryAfter);
      }
      throw err;
    } finally {
      release();
    }
  })();
}
