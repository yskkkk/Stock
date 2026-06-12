/**
 * 토스 Open API — 직렬·간격·429(요청 한도) 재시도
 */

let active = 0;
/** @type {(() => void)[]} */
const waiters = [];
let lastStartAt = 0;
let rateLimitUntil = 0;

function maxConcurrent() {
  const n = Number(process.env.TOSS_API_MAX_CONCURRENT);
  return Number.isFinite(n) && n >= 1 ? Math.min(3, Math.floor(n)) : 1;
}

function minGapMs() {
  const n = Number(process.env.TOSS_API_REQUEST_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? Math.min(5000, Math.floor(n)) : 400;
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
    await sleep(250);
  }
  while (active >= maxConcurrent()) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  const gap = minGapMs() - (Date.now() - lastStartAt);
  if (gap > 0) await sleep(gap);
  lastStartAt = Date.now();
  active += 1;
}

/** @param {unknown} err */
export function isTossRateLimitError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /요청 한도|rate.?limit|too many|429/i.test(msg);
}

/** @param {unknown} err */
export function isTossInvalidTokenError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /유효하지 않은 토큰|토큰이 유효하지|invalid.*token|unauthorized|CE1000|40101/i.test(
    msg,
  );
}

/** @param {number} [ms] */
export function markTossRateLimited(ms = 12_000) {
  rateLimitUntil = Math.max(rateLimitUntil, Date.now() + ms);
}

/**
 * @template T
 * @param {() => Promise<T>} task
 * @param {{ retries?: number }} [opts]
 */
export function queueTossApiRequest(task, opts = {}) {
  const retries = Number.isFinite(opts.retries) ? Math.max(0, opts.retries) : 3;
  return (async () => {
    let attempt = 0;
    for (;;) {
      await acquire();
      try {
        return await task();
      } catch (err) {
        if (isTossRateLimitError(err)) {
          markTossRateLimited(10_000 + attempt * 4000);
          if (attempt < retries) {
            attempt += 1;
            await sleep(1200 * attempt);
            continue;
          }
        }
        throw err;
      } finally {
        release();
      }
    }
  })();
}
