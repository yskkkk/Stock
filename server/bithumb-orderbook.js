/**
 * 빗썸 호가창(Upbit 호환 v1) — 시장가 매도 슬리피지 추정
 */

const DEFAULT_API_BASE = "https://api.bithumb.com";

/**
 * @param {unknown[]} units
 * @returns {{ price: number; size: number }[]}
 */
export function collectBidLevelsFromOrderbookUnits(units) {
  if (!Array.isArray(units)) return [];
  /** @type {{ price: number; size: number }[]} */
  const levels = [];
  for (const u of units) {
    if (!u || typeof u !== "object") continue;
    const price = Number(/** @type {{ bid_price?: string | number }} */ (u).bid_price);
    const size = Number(/** @type {{ bid_size?: string | number }} */ (u).bid_size);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(size) || size <= 0) continue;
    levels.push({ price, size });
  }
  levels.sort((a, b) => b.price - a.price);
  return levels;
}

/**
 * 매도(ask) 시 매수 호가(bid)를 먹으며 체결가 가중평균 추정
 * @param {{ price: number; size: number }[]} bidLevels — bid 가격 내림차순
 * @param {number} sellVolume
 */
export function estimateMarketSellAvgFillPrice(bidLevels, sellVolume) {
  const vol = Number(sellVolume);
  if (!Number.isFinite(vol) || vol <= 0) {
    return {
      ok: false,
      reason: "invalid_volume",
      avgPrice: null,
      bestBid: null,
      filled: 0,
      remaining: vol,
    };
  }
  if (!bidLevels.length) {
    return {
      ok: false,
      reason: "empty_orderbook",
      avgPrice: null,
      bestBid: null,
      filled: 0,
      remaining: vol,
    };
  }

  const bestBid = bidLevels[0].price;
  let remaining = vol;
  let funds = 0;
  let filled = 0;

  for (const { price, size } of bidLevels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, size);
    funds += take * price;
    filled += take;
    remaining -= take;
  }

  const avgPrice = filled > 0 ? funds / filled : null;
  const depthOk = remaining <= vol * 1e-6 || remaining <= 1e-8;

  return {
    ok: depthOk && avgPrice != null,
    reason: depthOk ? null : "insufficient_depth",
    avgPrice,
    bestBid,
    filled,
    remaining: depthOk ? 0 : remaining,
  };
}

/**
 * 최우선 매수 호가 대비 예상 체결가 괴리율(%)
 * @param {number} bestBid
 * @param {number} avgFillPrice
 */
export function sellSlippagePctFromBestBid(bestBid, avgFillPrice) {
  const bid = Number(bestBid);
  const avg = Number(avgFillPrice);
  if (!Number.isFinite(bid) || bid <= 0 || !Number.isFinite(avg) || avg <= 0) {
    return null;
  }
  return ((bid - avg) / bid) * 100;
}

/**
 * @param {string} market e.g. KRW-BTC
 * @param {string} [apiBaseUrl]
 */
export async function fetchBithumbOrderbook(market, apiBaseUrl = DEFAULT_API_BASE) {
  const mk = String(market ?? "").trim();
  if (!mk) throw new Error("호가 조회 마켓이 없습니다.");
  const base = String(apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const url = `${base}/v1/orderbook?markets=${encodeURIComponent(mk)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  /** @type {unknown} */
  let body = [];
  try {
    body = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(`빗썸 호가 응답 파싱 실패: ${mk}`);
  }
  if (!res.ok) {
    throw new Error(`빗썸 호가 HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  const row = Array.isArray(body) ? body[0] : null;
  if (!row || typeof row !== "object") {
    throw new Error(`빗썸 호가 형식 오류: ${mk}`);
  }
  const units = /** @type {{ orderbook_units?: unknown[] }} */ (row).orderbook_units;
  return {
    market: mk,
    orderbook_units: Array.isArray(units) ? units : [],
  };
}
