/** 일봉 MA5·20·60·120 완전 정배열 (5 > 20 > 60 > 120) */

import { sma } from "./golden-cross-detect.js";

export const MA_ALIGN_PERIODS = [5, 20, 60, 120];
export const MA_ALIGN_MIN_CANDLES = Math.max(...MA_ALIGN_PERIODS);

/**
 * @param {Array<{ close?: number }>} candles
 * @param {number} [barIndex] — 기본: 마지막 봉
 */
export function detectDailyMaAlignment(candles, barIndex) {
  if (!Array.isArray(candles) || candles.length < MA_ALIGN_MIN_CANDLES) {
    return false;
  }
  const closes = candles
    .map((c) => Number(c?.close))
    .filter((v) => Number.isFinite(v));
  if (closes.length < MA_ALIGN_MIN_CANDLES) return false;

  const i =
    barIndex == null
      ? closes.length - 1
      : Math.min(Math.max(0, barIndex), closes.length - 1);

  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const ma120 = sma(closes, 120);

  const v5 = ma5[i];
  const v20 = ma20[i];
  const v60 = ma60[i];
  const v120 = ma120[i];
  if (
    v5 == null ||
    v20 == null ||
    v60 == null ||
    v120 == null ||
    !Number.isFinite(v5) ||
    !Number.isFinite(v20) ||
    !Number.isFinite(v60) ||
    !Number.isFinite(v120)
  ) {
    return false;
  }
  return v5 > v20 && v20 > v60 && v60 > v120;
}
