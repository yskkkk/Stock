import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHoldingsNewsBrief,
  isBreakingHoldingsNewsItem,
} from "./holdings-news-brief.js";

test("buildHoldingsNewsBrief labels positive news as 호재", () => {
  const brief = buildHoldingsNewsBrief(
    {
      title: "삼성전자, 실적 호조에 목표가 상향 — 급등",
      type: "news",
      sentiment: "positive",
      publishedAt: Date.now() - 60_000,
      source: "테스트",
    },
    { symbol: "005930.KS", name: "삼성전자" },
  );
  assert.equal(brief.labelKo, "호재");
  assert.match(brief.explanation, /우호적/);
});

test("isBreakingHoldingsNewsItem accepts recent sentiment news", () => {
  const now = Date.now();
  assert.equal(
    isBreakingHoldingsNewsItem(
      {
        title: "어닝 쇼크에 급락",
        sentiment: "negative",
        publishedAt: now - 120_000,
      },
      now,
    ),
    true,
  );
  assert.equal(
    isBreakingHoldingsNewsItem(
      {
        title: "전망 리포트",
        sentiment: "neutral",
        publishedAt: now - 120_000,
      },
      now,
    ),
    false,
  );
});
