import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketFlowText,
  describeNewsPriceImpact,
  formatHoldingPrice,
  formatSignedPct,
  isHoldingsCloseDigestDue,
  pickSessionNewsItems,
} from "./holdings-close-digest.js";
import {
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

test("text email includes market, price, sentiment, impact, and link", () => {
  const text = buildHoldingsCloseDigestEmailText({
    market: "all",
    marketLabel: "국내·미국",
    dateLabel: "2026년 8월 25일 화",
    sessionKey: "test",
    generatedAt: Date.now(),
    marketFlow: "국내: 코스피 -0.40%.",
    indices: [],
    rows: [
      {
        symbol: "AAPL",
        name: "Apple",
        market: "us",
        priceLabel: "$188.50",
        changeLabel: "+1.20%",
        changePercent: 1.2,
        news: [
          {
            title: "Apple beats earnings",
            url: "https://example.com/aapl",
            source: "Reuters",
            publishedLabel: "8. 25. 22:00",
            labelKo: "호재",
            sentiment: "positive",
            impact: "당일 +1.20% 상승 — 호재와 같은 방향으로 움직였습니다.",
          },
        ],
      },
    ],
    truncated: false,
    userId: "x",
  });
  assert.match(text, /오늘 시장/);
  assert.match(text, /Apple \(AAPL\)/);
  assert.match(text, /\[호재\]/);
  assert.match(text, /https:\/\/example.com\/aapl/);
  assert.match(text, /호재와 같은 방향/);
});
