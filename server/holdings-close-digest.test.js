import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketFlowText,
  describeNewsPriceImpact,
  formatHoldingPrice,
  formatSessionMove,
  formatSignedPct,
  isCombinedDigestDue,
  isHoldingsCloseDigestDue,
  pickSessionNewsItems,
  splitDigestRowsByStyle,
} from "./holdings-close-digest.js";
import {
  buildHoldingsCloseDigestEmailHtml,
  buildHoldingsCloseDigestEmailText,
} from "./notifications/holdings-close-digest-email.js";

test("formats prices and percents", () => {
  assert.equal(formatSignedPct(1.234), "+1.23%");
  assert.equal(formatSignedPct(-0.5), "-0.50%");
  assert.equal(formatSignedPct(null), "—");
  assert.equal(formatHoldingPrice(71200, "KRW", "kr"), "71,200원");
  assert.equal(formatHoldingPrice(188.5, "USD", "us"), "$188.50");
});

test("describes news vs same-day move without claiming causation", () => {
  assert.match(
    describeNewsPriceImpact({ sentiment: "positive", changePercent: 2.1 }),
    /호재와 같은 방향/,
  );
  assert.match(
    describeNewsPriceImpact({ sentiment: "positive", changePercent: -1.4 }),
    /호재로 분류됐지만/,
  );
  assert.match(
    describeNewsPriceImpact({ sentiment: "negative", changePercent: -3 }),
    /악재와 같은 방향/,
  );
  assert.match(
    describeNewsPriceImpact({ sentiment: "negative", changePercent: 1.2 }),
    /악재로 분류됐지만/,
  );
  assert.match(
    describeNewsPriceImpact({ sentiment: "neutral", changePercent: 0.02 }),
    /참고만/,
  );
});

test("builds market flow from index rows", () => {
  const text = buildMarketFlowText(
    [
      { id: "kospi", label: "코스피", changePercent: -0.82, region: "kr" },
      { id: "kosdaq", label: "코스닥", changePercent: 0.11, region: "kr" },
      { id: "nasdaq", label: "나스닥", changePercent: 0.54, region: "us" },
      { id: "sp500", label: "S&P500", changePercent: 0.21, region: "us" },
      { id: "dow", label: "다우", changePercent: 0.05, region: "us" },
      {
        id: "usdkrw",
        label: "원/달러",
        kind: "fx",
        price: 1392.4,
        changePercent: 0.18,
      },
    ],
    "kr",
  );
  assert.match(text, /코스피 -0.82%/);
  assert.match(text, /나스닥 \+0.54%/);
  assert.match(text, /국내 증시는 하락 마감/);
});

test("keeps session news inside the lookback window", () => {
  const now = Date.parse("2026-08-25T06:45:00Z");
  const items = pickSessionNewsItems(
    [
      { title: "old", publishedAt: now - 30 * 3600_000, url: "https://a" },
      { title: "fresh", publishedAt: now - 2 * 3600_000, url: "https://b" },
    ],
    { sinceMs: now - 24 * 3600_000, limit: 5 },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "fresh");
});

test("is due after KR 15:40 KST on a business day", () => {
  assert.equal(
    isHoldingsCloseDigestDue("kr", new Date("2026-08-25T06:40:00Z")),
    true,
  );
  assert.equal(
    isHoldingsCloseDigestDue("kr", new Date("2026-08-25T06:20:00Z")),
    false,
  );
});

test("is due after US 16:10 ET on a weekday", () => {
  assert.equal(
    isHoldingsCloseDigestDue("us", new Date("2026-08-25T20:10:00Z")),
    true,
  );
  assert.equal(
    isHoldingsCloseDigestDue("us", new Date("2026-08-25T19:50:00Z")),
    false,
  );
});

test("session move uses open-to-close, not previous-close percent", () => {
  const move = formatSessionMove({
    open: 100,
    close: 102,
    changePercent: 5,
    currency: "USD",
    market: "us",
  });
  assert.equal(move.openLabel, "$100.00");
  assert.equal(move.closeLabel, "$102.00");
  assert.equal(move.changeLabel, "+2.00%");
  assert.equal(move.diffLabel, "+$2.00");
});

test("splits holdings into value and growth columns", () => {
  const split = splitDigestRowsByStyle([
    { symbol: "PG", style: "value" },
    { symbol: "GOOGL", style: "growth" },
    { symbol: "V", style: "value" },
  ]);
  assert.equal(split.value.map((r) => r.symbol).join(","), "PG,V");
  assert.equal(split.growth.map((r) => r.symbol).join(","), "GOOGL");
});

test("combined digest waits until every held market has closed", () => {
  const afterKrBeforeUs = new Date("2026-08-25T06:45:00Z");
  const afterUs = new Date("2026-08-25T20:15:00Z");
  assert.equal(isCombinedDigestDue(afterKrBeforeUs, ["us"]), false);
  assert.equal(isCombinedDigestDue(afterKrBeforeUs, ["kr"]), true);
  assert.equal(isCombinedDigestDue(afterKrBeforeUs, ["kr", "us"]), false);
  assert.equal(isCombinedDigestDue(afterUs, ["kr", "us"]), true);
  assert.equal(isCombinedDigestDue(afterUs, ["kr"]), false);
});

test("text email uses style columns, open/close, and omits quantity", () => {
  const digest = {
    market: "all",
    marketLabel: "국내·미국",
    dateLabel: "2026년 8월 25일 화",
    sessionKey: "test",
    generatedAt: Date.now(),
    marketFlow: "국내: 코스피 -0.40%.",
    indices: [],
    rows: [
      {
        symbol: "PG",
        name: "Procter",
        market: "us",
        style: "value",
        openLabel: "$160.00",
        closeLabel: "$161.20",
        changeLabel: "+0.75%",
        diffLabel: "+$1.20",
        changePercent: 0.75,
        news: [],
      },
      {
        symbol: "AAPL",
        name: "Apple",
        market: "us",
        style: "growth",
        openLabel: "$186.00",
        closeLabel: "$188.50",
        changeLabel: "+1.34%",
        diffLabel: "+$2.50",
        changePercent: 1.34,
        news: [
          {
            title: "Apple beats earnings",
            url: "https://example.com/aapl",
            source: "Reuters",
            publishedLabel: "8. 25. 22:00",
            labelKo: "호재",
            sentiment: "positive",
            impact: "종가 등락 +1.34% 상승 — 호재와 같은 방향으로 움직였습니다.",
          },
        ],
      },
    ],
    truncated: false,
    userId: "x",
  };
  const text = buildHoldingsCloseDigestEmailText(digest);
  assert.match(text, /오늘 시장/);
  assert.match(text, /【가치·방어주】/);
  assert.match(text, /【성장주】/);
  assert.match(text, /시가 \$186\.00 → 종가 \$188\.50/);
  assert.match(text, /등락 \+1\.34%/);
  assert.match(text, /Apple \(AAPL\)/);
  assert.match(text, /\[호재\]/);
  assert.match(text, /https:\/\/example.com\/aapl/);
  assert.match(text, /호재와 같은 방향/);
  assert.doesNotMatch(text, /\d+주/);

  const html = buildHoldingsCloseDigestEmailHtml(digest);
  assert.match(html, /가치·방어주/);
  assert.match(html, /성장주/);
  assert.match(html, /width="50%"/);
  assert.match(html, /width="33%"/);
  assert.match(html, /시가/);
  assert.match(html, /종가/);
  assert.match(html, /등락/);
  assert.doesNotMatch(html, /\d+주/);
});
