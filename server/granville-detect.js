/**
 * 그랜빌(Granville) 이동평균 8법칙 탐지 — 일봉 기준선(기본 MA200).
 * 최신 봉에서 매수1~4·매도1~4 중 하나를 판별한다.
 *
 * 규칙 요약(기준 이평선 = MA, 주가 = P):
 *  - 매수1 전환 돌파: MA 하락 멈춤·전환 국면 + P가 MA 상향 돌파
 *  - 매수2 눌림목 지지: MA 상승 + P가 MA 부근까지 눌렸다 재반등(이탈X)
 *  - 매수3 지지 반등: MA 상승 + P가 MA 잠깐 하향 이탈 후 회복
 *  - 매수4 이격 반등: MA 하락 + P가 MA 아래로 과대 이격 후 반등
 *  - 매도1 전환 이탈: MA 상승 멈춤·전환 국면 + P가 MA 하향 이탈
 *  - 매도2 반등 실패: MA 하락 + P가 MA 부근까지 반등했으나 넘지 못하고 하락
 *  - 매도3 일시 돌파: MA 하락 + P가 MA 잠깐 상향 돌파 후 되밀림
 *  - 매도4 이격 조정: MA 상승 + P가 MA 위로 과대 이격 후 하락
 */

import { sma, candleTimeToDateKey } from "./golden-cross-detect.js";
import { GRANVILLE_MA_PERIOD_DEFAULT, getGranvilleRule } from "../shared/granville-rules.js";

/** @typedef {import("../shared/granville-rules.js").GranvilleSignalId} GranvilleSignalId */

/**
 * @typedef {{
 *   maPeriod?: number;       // 기준 이평선 기간 (기본 200)
 *   slopeLookback?: number;  // 기울기 계산 봉 수 (기본 5)
 *   slopeEpsPct?: number;    // 상승/하락 판정 최소 기울기 % (기본 0.05)
 *   nearBandPct?: number;    // 이평선 근접 대역 % (기본 3)
 *   farBandPct?: number;     // 과대 이격 대역 % (기본 12)
 * }} GranvilleDetectOpts
 */

export const GRANVILLE_MIN_CANDLES = GRANVILLE_MA_PERIOD_DEFAULT + 10;

/**
 * @param {Array<{ close?: number; time?: unknown }>} candles
 * @param {number} [barIndex]
 * @param {GranvilleDetectOpts} [opts]
 */
export function detectGranvilleAtBar(
  candles,
  barIndex = (Array.isArray(candles) ? candles.length : 0) - 1,
  opts = {},
) {
  const empty = {
    signal: /** @type {GranvilleSignalId|null} */ (null),
    side: /** @type {"buy"|"sell"|null} */ (null),
    code: 0,
    maPeriod: Number(opts.maPeriod) || GRANVILLE_MA_PERIOD_DEFAULT,
    ma: null,
    disparityPct: null,
    slopePct: null,
    signalDate: /** @type {string|null} */ (null),
  };

  if (!Array.isArray(candles) || candles.length === 0) return empty;

  const maPeriod = Number.isFinite(Number(opts.maPeriod)) && Number(opts.maPeriod) > 0
    ? Math.round(Number(opts.maPeriod))
    : GRANVILLE_MA_PERIOD_DEFAULT;
  const slopeLookback = Number.isFinite(Number(opts.slopeLookback)) && Number(opts.slopeLookback) >= 1
    ? Math.round(Number(opts.slopeLookback))
    : 5;
  const slopeEps = Number.isFinite(Number(opts.slopeEpsPct)) ? Math.abs(Number(opts.slopeEpsPct)) : 0.05;
  const nearBand = Number.isFinite(Number(opts.nearBandPct)) ? Math.abs(Number(opts.nearBandPct)) : 3;
  const farBand = Number.isFinite(Number(opts.farBandPct)) ? Math.abs(Number(opts.farBandPct)) : 12;

  const i = barIndex;
  if (i < maPeriod + slopeLookback || i >= candles.length) return { ...empty, maPeriod };

  const closes = candles.map((c) => Number(c?.close));
  const maArr = sma(closes, maPeriod);

  const maNow = maArr[i];
  const maPrev = maArr[i - 1];
  const maRef = maArr[i - slopeLookback];
  const pNow = closes[i];
  const pPrev = closes[i - 1];

  if (
    !Number.isFinite(maNow) ||
    !Number.isFinite(maPrev) ||
    !Number.isFinite(maRef) ||
    maNow <= 0 ||
    maPrev <= 0 ||
    maRef <= 0 ||
    !Number.isFinite(pNow) ||
    !Number.isFinite(pPrev)
  ) {
    return { ...empty, maPeriod };
  }

  const slopePct = ((maNow - maRef) / maRef) * 100;
  const rising = slopePct > slopeEps;
  const falling = slopePct < -slopeEps;

  const above = pNow >= maNow;
  const abovePrev = pPrev >= maPrev;
  const crossUp = !abovePrev && above;
  const crossDown = abovePrev && !above;

  const disp = (pNow / maNow) * 100; // 이격도(%) — 100 = 이평선
  const dispPrev = (pPrev / maPrev) * 100;
  const up = pNow > pPrev;
  const down = pNow < pPrev;

  /** @type {GranvilleSignalId|null} */
  let signal = null;

  if (crossUp && slopePct >= -slopeEps) {
    signal = "buy1"; // 전환 돌파
  } else if (crossDown && slopePct <= slopeEps) {
    signal = "sell1"; // 전환 이탈
  } else if (falling && disp <= 100 - farBand && up) {
    signal = "buy4"; // 이격 반등
  } else if (rising && disp >= 100 + farBand && down) {
    signal = "sell4"; // 이격 조정
  } else if (rising && above && dispPrev >= 100 && dispPrev <= 100 + nearBand && up) {
    signal = "buy2"; // 눌림목 지지
  } else if (falling && !above && dispPrev <= 100 && dispPrev >= 100 - nearBand && down) {
    signal = "sell2"; // 반등 실패
  } else if (rising && !above && disp >= 100 - nearBand && up) {
    signal = "buy3"; // 지지 반등
  } else if (falling && above && disp <= 100 + nearBand && down) {
    signal = "sell3"; // 일시 돌파
  }

  if (!signal) return { ...empty, maPeriod, ma: maNow, disparityPct: disp, slopePct };

  const rule = getGranvilleRule(signal);
  return {
    signal,
    side: rule ? rule.side : null,
    code: rule ? rule.num : 0,
    maPeriod,
    ma: maNow,
    disparityPct: disp,
    slopePct,
    signalDate: candleTimeToDateKey(candles[i]?.time),
  };
}

/**
 * @param {Array<{ close?: number; time?: unknown }>} candles
 * @param {GranvilleDetectOpts} [opts]
 */
export function detectGranvilleLatest(candles, opts = {}) {
  return detectGranvilleAtBar(
    candles,
    (Array.isArray(candles) ? candles.length : 0) - 1,
    opts,
  );
}
