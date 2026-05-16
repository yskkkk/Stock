let active = 0;
const waiters = [];
let lastStartAt = 0;
let rateLimitUntil = 0;

function maxConcurrent() {
  const n = Number(process.env.YAHOO_MAX_CONCURRENT);
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.floor(n)) : 4;
}

function minGapMs() {
  const n = Number(process.env.YAHOO_REQUEST_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? n : 250;
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

export function markRateLimited(ms = 8000) {
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
