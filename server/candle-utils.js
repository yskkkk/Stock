const KST = "Asia/Seoul";
const KST_OFFSET_SEC = 9 * 60 * 60;

function toSec(ts) {
  let sec = Number(ts);
  if (!Number.isFinite(sec)) return null;
  if (sec > 1e12) sec = Math.floor(sec / 1000);
  return sec;
}

/** UTC unix → KST 달력 날짜 (일봉용) */
function toKstBusinessDay(sec) {
  const kstMs = sec * 1000 + KST_OFFSET_SEC * 1000;
  const d = new Date(kstMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function isDailyInterval(interval) {
  return interval === "1d" || interval === "1wk" || interval === "5d";
}

/** 분봉: UTC 초 그대로 + 차트 포맷터에서 KST 표시 */
function toIntradayTime(sec) {
  return sec;
}

export function aggregateCandles(candles, factor) {
  if (factor <= 1 || candles.length === 0) return candles;

  const result = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    result.push({
      time: first.time,
      timeSec: first.timeSec,
      open: first.open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: last.close,
      volume: chunk.reduce((s, c) => s + (c.volume ?? 0), 0),
    });
  }
  return result.map(({ timeSec: _, ...rest }) => rest);
}

/**
 * @param {Array<{time:number, open, high, low, close, volume?}>} raw
 * @param {string} interval - Yahoo interval (1m, 5m, 60m, 1d...)
 * @param {number} [aggregate] - N개 봉 묶기 (4시간봉 등)
 */
export function normalizeCandles(raw, interval, aggregate = 1) {
  const daily = isDailyInterval(interval);
  const byKey = new Map();

  for (const c of raw) {
    if (c.open == null || c.close == null) continue;
    const sec = toSec(c.time);
    if (sec == null) continue;

    const time = daily ? toKstBusinessDay(sec) : toIntradayTime(sec);
    const key =
      typeof time === "number"
        ? String(time)
        : `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;

    byKey.set(key, {
      time,
      timeSec: sec,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
    });
  }

  let sorted = [...byKey.values()].sort((a, b) => a.timeSec - b.timeSec);

  if (aggregate > 1) {
    sorted = aggregateCandles(sorted, aggregate);
  }

  return sorted.map(({ timeSec: _, ...rest }) => rest);
}

export function formatKstFromUnix(sec, intraday) {
  return new Date(sec * 1000).toLocaleString("ko-KR", {
    timeZone: KST,
    ...(intraday
      ? {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }
      : { year: "numeric", month: "short", day: "numeric" }),
  });
}
