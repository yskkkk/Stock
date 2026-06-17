import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildBottomCandleScanStartTelegramHtml,
  buildVaultScanStartTelegramHtml,
} from "./golden-cross-telegram.js";

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
