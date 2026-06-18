import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildBottomCandleScanDoneTelegramHtml,
  buildBottomCandleScanStartTelegramHtml,
  buildVaultScanDoneTelegramHtml,
  buildVaultScanStartTelegramHtml,
  formatScanDurationMs,
} from "./golden-cross-telegram.js";

test("formatScanDurationMs formats seconds and minutes", () => {
  assert.equal(formatScanDurationMs(0), "0초");
  assert.equal(formatScanDurationMs(45_000), "45초");
  assert.equal(formatScanDurationMs(60_000), "1분");
  assert.equal(formatScanDurationMs(192_000), "3분 12초");
});

test("buildVaultScanStartTelegramHtml lists manual all-market scan items", () => {
  const html = buildVaultScanStartTelegramHtml({
    trigger: "manual",
    market: "all",
    scanDate: "2026-06-17",
  });
  assert.match(html, /종목보관 탐색 시작/);
  assert.match(html, /수동 탐색/);
  assert.match(html, /국내 시총 상위 · 미국 S&amp;P500/);
  assert.match(html, /120선 근처/);
  assert.match(html, /매집봉/);
});

test("buildVaultScanStartTelegramHtml lists scheduled single market", () => {
  const html = buildVaultScanStartTelegramHtml({
    trigger: "scheduled",
    market: "kr",
    scanDate: "2026-06-17",
  });
  assert.match(html, /자동 탐색/);
  assert.match(html, /국내 시총 상위/);
  assert.doesNotMatch(html, /S&amp;P500/);
});

test("buildBottomCandleScanStartTelegramHtml lists bottom candle scan", () => {
  const html = buildBottomCandleScanStartTelegramHtml({
    trigger: "scheduled",
    scanDate: "2026-06-17",
  });
  assert.match(html, /바닥캔들 탐색 시작/);
  assert.match(html, /일봉·주봉 세력 바닥 3캔들/);
});

test("buildVaultScanDoneTelegramHtml lists per-scan durations and hits", () => {
  const html = buildVaultScanDoneTelegramHtml({
    trigger: "manual",
    market: "all",
    scanDate: "2026-06-17",
    totalDurationMs: 1_102_000,
    rows: [
      {
        market: "kr",
        timeframe: "1d",
        kind: "goldenCross",
        durationMs: 192_000,
        hitCount: 5,
        ok: true,
      },
      {
        market: "kr",
        timeframe: "1d",
        kind: "maAlign",
        durationMs: 118_000,
        hitCount: 2,
        ok: true,
      },
      {
        market: "us",
        timeframe: "1wk",
        kind: "goldenCross",
        durationMs: 62_000,
        ok: false,
      },
    ],
  });
  assert.match(html, /종목보관 탐색 완료/);
  assert.match(html, /총 18분 22초/);
  assert.match(html, /국내 · 일봉/);
  assert.match(html, /골든크로스 3분 12초 · 5건/);
  assert.match(html, /정배열 1분 58초 · 2건/);
  assert.match(html, /미국 · 주봉/);
  assert.match(html, /골든크로스 1분 2초 · 실패/);
});

test("buildBottomCandleScanDoneTelegramHtml lists four bottom candle rows", () => {
  const html = buildBottomCandleScanDoneTelegramHtml({
    trigger: "scheduled",
    scanDate: "2026-06-17",
    totalDurationMs: 600_000,
    rows: [
      {
        market: "kr",
        timeframe: "1d",
        kind: "bottomCandle",
        durationMs: 120_000,
        hitCount: 3,
        ok: true,
      },
      {
        market: "kr",
        timeframe: "1wk",
        kind: "bottomCandle",
        durationMs: 90_000,
        hitCount: 1,
        ok: true,
      },
      {
        market: "us",
        timeframe: "1d",
        kind: "bottomCandle",
        durationMs: 200_000,
        hitCount: 0,
        ok: true,
      },
      {
        market: "us",
        timeframe: "1wk",
        kind: "bottomCandle",
        durationMs: 190_000,
        hitCount: 2,
        ok: true,
      },
    ],
  });
  assert.match(html, /바닥캔들 탐색 완료/);
  assert.match(html, /총 10분/);
  assert.match(html, /국내 · 일봉/);
  assert.match(html, /바닥캔들 2분 · 3건/);
  assert.match(html, /미국 · 주봉/);
  assert.match(html, /바닥캔들 3분 10초 · 2건/);
});
