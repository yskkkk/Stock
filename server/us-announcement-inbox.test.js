import { describe, expect, it } from "vitest";
import {
  buildAnnouncementAiSummary,
  buildAnnouncementMetrics,
  pctChange,
} from "./us-announcement-analyze.js";
import {
  buildAnnouncementDedupeKey,
  dedupeRegisteredAnnouncementCards,
  emptyUsAnnouncementStore,
  hasSeenAnnouncementKey,
  insertAnnouncementCard,
  isQuietAnnouncementForm,
  isSymbolAnnouncementPrimed,
  listAnnouncementCards,
  markAnnouncementAlerted,
  markSymbolAnnouncementPrimed,
  shouldNotifyAnnouncement,
  shouldSendAnnouncementAlert,
  wasAnnouncementAlerted,
} from "./us-announcement-inbox-store.js";
import { classifySecForm, buildEdgarDocumentUrl } from "./us-announcement-edgar.js";
import { consensusEpsChangedEnough, metricsFromYahooSnapshot } from "./us-announcement-consensus.js";
import { buildAnnouncementNotifyText } from "./us-announcement-notify.js";
import { buildFilingHeadlineAndDetail, extractFilingNumberLines, buildArticleFromFiling, buildDeepAnalysisFromFiling, pickFilingExcerpts } from "./us-announcement-summarize.js";
import { htmlToPlainText } from "./us-announcement-filing-text.js";

describe("us-announcement-analyze", () => {
  it("pctChange and vs consensus / yoy", () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(1, 0)).toBe(null);

    const m = buildAnnouncementMetrics({
      kind: "guidance",
      guidanceEps: 5,
      consensusEps: 5.5,
      trailingEps: 4,
    });
    expect(m.vsConsensusPct).toBeCloseTo(-9.1, 0);
    expect(m.yoyPct).toBeCloseTo(25, 0);
  });

  it("AI summary mentions conservative guidance", () => {
    const metrics = buildAnnouncementMetrics({
      kind: "guidance",
      guidanceEps: 4,
      consensusEps: 5,
      trailingEps: 3.5,
    });
    const s = buildAnnouncementAiSummary({
      kind: "guidance",
      symbol: "AAPL",
      title: "8-K",
      metrics,
    });
    expect(s).toContain("AAPL");
    expect(s).toMatch(/보수|하향|컨센/);
  });

  it("consensus up summary", () => {
    const metrics = buildAnnouncementMetrics({
      kind: "consensus",
      consensusEps: 6,
      priorConsensusEps: 5,
      trailingEps: 4,
    });
    const s = buildAnnouncementAiSummary({
      kind: "consensus",
      symbol: "NVDA",
      metrics,
    });
    expect(s).toMatch(/상향|NVDA/);
  });

  it("earnings summary explains empty vs consensus and yoy label", () => {
    const metrics = buildAnnouncementMetrics({
      kind: "earnings",
      yoyPct: -26.1,
      yoyLabel:
        "당분기 컨센 EPS(2.00) vs 전년 동기 EPS(2.70)",
      vsConsensusPct: null,
      consensusChangePct: null,
    });
    const s = buildAnnouncementAiSummary({
      kind: "earnings",
      symbol: "GOOGL",
      form: "10-Q",
      title: "10-Q",
      metrics,
    });
    expect(s).toContain("GOOGL");
    expect(s).toMatch(/전년 대비|당분기 컨센/);
    expect(s).toMatch(/컨센 대비|Beat|Miss|비어/);
    expect(s.length).toBeGreaterThan(180);
  });
});

describe("metricsFromYahooSnapshot", () => {
  it("uses last reported surprise and quarter vs yearAgo", () => {
    const m = metricsFromYahooSnapshot(
      "earnings",
      {
        symbol: "GOOGL",
        forwardEps: 8,
        trailingEps: 7,
        periods: {
          "0q": {
            epsAvg: 2.0,
            yearAgoEps: 2.7,
            numAnalysts: 40,
            growthPct: null,
          },
        },
        lastReported: {
          epsActual: 2.1,
          epsEstimate: 2.0,
          surprisePct: 5,
        },
        at: Date.now(),
      },
      { priorQuarterEpsAvg: 1.9, priorForwardEps: 7.5 },
    );
    expect(m.vsConsensusPct).toBe(5);
    expect(m.vsConsensusLabel).toMatch(/확정 EPS/);
    expect(m.yoyPct).toBeCloseTo(-25.9, 0);
    expect(m.yoyLabel).toMatch(/전년 동기/);
    expect(m.consensusChangePct).toBeCloseTo(5.3, 0);
    expect(m.consensusChangeLabel).toMatch(/당분기 컨센/);
  });
});

describe("us-announcement-store dedupe", () => {
  it("inserts once per dedupe key", () => {
    let store = emptyUsAnnouncementStore();
    const key = buildAnnouncementDedupeKey("AAPL", "guidance", "acc-1");
    const card = {
      id: "c1",
      symbol: "AAPL",
      kind: /** @type {const} */ ("guidance"),
      title: "8-K",
      form: "8-K",
      accession: "acc-1",
      filedAt: Date.now(),
      source: "test",
      metrics: {},
      ai: { summary: "x", generatedAt: Date.now() },
      links: {},
      createdAt: Date.now(),
    };
    const a = insertAnnouncementCard(store, card, [key]);
    expect(a.inserted).toBe(true);
    expect(hasSeenAnnouncementKey(store, key)).toBe(true);
    const b = insertAnnouncementCard(store, { ...card, id: "c2" }, [key]);
    expect(b.inserted).toBe(false);
    expect(listAnnouncementCards(store, { symbol: "AAPL" })).toHaveLength(1);
  });

  it("blocks same day same kind even with different accession", () => {
    const store = emptyUsAnnouncementStore();
    const day = Date.parse("2026-07-30T16:00:00-04:00");
    const a = insertAnnouncementCard(
      store,
      {
        id: "a",
        symbol: "AAPL",
        kind: "guidance",
        title: "8-K",
        form: "8-K",
        accession: "acc-a",
        filedAt: day,
        source: "t",
        metrics: {},
        ai: { summary: "", generatedAt: 0 },
        links: {},
        createdAt: day,
      },
      [],
    );
    expect(a.inserted).toBe(true);
    const b = insertAnnouncementCard(
      store,
      {
        id: "b",
        symbol: "AAPL",
        kind: "guidance",
        title: "8-K/A",
        form: "8-K/A",
        accession: "acc-b",
        filedAt: day,
        source: "t",
        metrics: {},
        ai: { summary: "", generatedAt: 0 },
        links: {},
        createdAt: day,
      },
      [],
    );
    expect(b.inserted).toBe(false);
  });

  it("blocks identical demo titles", () => {
    const store = emptyUsAnnouncementStore();
    const filedAt = Date.now();
    const mk = (id) => ({
      id,
      symbol: "AAPL",
      kind: /** @type {const} */ ("guidance"),
      title: "Demo · 가이던스 vs 컨센",
      form: null,
      accession: null,
      filedAt,
      source: "seed",
      metrics: {},
      ai: { summary: "", generatedAt: 0 },
      links: {},
      createdAt: filedAt,
    });
    expect(insertAnnouncementCard(store, mk("1"), []).inserted).toBe(true);
    expect(insertAnnouncementCard(store, mk("2"), []).inserted).toBe(false);
  });
});

describe("primed backfill — no notify until primed", () => {
  it("blocks notify before prime, allows after", () => {
    const store = emptyUsAnnouncementStore();
    expect(isSymbolAnnouncementPrimed(store, "AAPL")).toBe(false);
    expect(shouldNotifyAnnouncement(true, store, "AAPL")).toBe(false);
    expect(shouldNotifyAnnouncement(false, store, "AAPL")).toBe(false);
    markSymbolAnnouncementPrimed(store, "AAPL");
    expect(isSymbolAnnouncementPrimed(store, "AAPL")).toBe(true);
    expect(shouldNotifyAnnouncement(true, store, "AAPL")).toBe(true);
    expect(shouldNotifyAnnouncement(false, store, "AAPL")).toBe(false);
  });
});

describe("notify once per announcement", () => {
  it("skips Form 4 alerts", () => {
    expect(isQuietAnnouncementForm("4")).toBe(true);
    expect(isQuietAnnouncementForm("DEF 14A")).toBe(false);
    const store = emptyUsAnnouncementStore();
    markSymbolAnnouncementPrimed(store, "AAPL");
    const r = shouldSendAnnouncementAlert({
      notifyOpt: true,
      store,
      symbol: "AAPL",
      form: "4",
      dedupeKey: "AAPL|governance|acc-4",
    });
    expect(r.send).toBe(false);
    expect(r.reason).toBe("quiet_form");
  });

  it("allows different filings, blocks same filing twice", () => {
    const store = emptyUsAnnouncementStore();
    markSymbolAnnouncementPrimed(store, "MSFT");
    const key1 = buildAnnouncementDedupeKey("MSFT", "governance", "acc-1");
    const key2 = buildAnnouncementDedupeKey("MSFT", "governance", "acc-2");
    const first = shouldSendAnnouncementAlert({
      notifyOpt: true,
      store,
      symbol: "MSFT",
      form: "DEF 14A",
      dedupeKey: key1,
    });
    expect(first.send).toBe(true);
    markAnnouncementAlerted(store, key1);
    expect(wasAnnouncementAlerted(store, key1)).toBe(true);

    const same = shouldSendAnnouncementAlert({
      notifyOpt: true,
      store,
      symbol: "MSFT",
      form: "DEF 14A",
      dedupeKey: key1,
    });
    expect(same.send).toBe(false);
    expect(same.reason).toBe("already_alerted");

    const other = shouldSendAnnouncementAlert({
      notifyOpt: true,
      store,
      symbol: "MSFT",
      form: "DEFA14A",
      dedupeKey: key2,
    });
    expect(other.send).toBe(true);
  });
});

describe("us-announcement-edgar helpers", () => {
  it("classifies forms", () => {
    expect(classifySecForm("8-K")).toBe("guidance");
    expect(classifySecForm("DEF 14A")).toBe("governance");
    expect(classifySecForm("10-Q")).toBe("earnings");
    expect(classifySecForm("4")).toBe(null);
    expect(classifySecForm("S-1")).toBe(null);
  });

  it("builds edgar url", () => {
    const url = buildEdgarDocumentUrl(
      "0000320193",
      "0000320193-24-000123",
      "aapl-8k.htm",
    );
    expect(url).toContain("sec.gov/Archives/edgar/data/320193/");
    expect(url).toContain("aapl-8k.htm");
  });
});

describe("consensus change threshold", () => {
  it("detects 2%+ moves", () => {
    expect(
      consensusEpsChangedEnough({ epsAvg: 100 }, { epsAvg: 102 }, 2),
    ).toBe(true);
    expect(
      consensusEpsChangedEnough({ epsAvg: 100 }, { epsAvg: 101 }, 2),
    ).toBe(false);
  });
});

describe("notify text", () => {
  it("includes kind and metrics", () => {
    const text = buildAnnouncementNotifyText({
      id: "1",
      symbol: "MSFT",
      kind: "guidance",
      title: "Outlook",
      filedAt: Date.now(),
      source: "SEC",
      metrics: { vsConsensusPct: -4.2, yoyPct: 12 },
      ai: { summary: "보수적 가이던스.", generatedAt: Date.now() },
      links: { edgar: "https://sec.gov/x", yahooAnalysis: null },
      createdAt: Date.now(),
    });
    expect(text).toContain("가이던스");
    expect(text).toContain("MSFT");
    expect(text).toContain("컨센 대비");
    expect(text).toContain("보수적");
  });
});

describe("filing headline/detail", () => {
  it("builds earnings about/numbers/interpretation", () => {
    const pack = buildFilingHeadlineAndDetail(
      "10-Q",
      "earnings",
      "10-Q",
      "Diluted earnings per share was $2.10. Total revenues were $90.0 billion.",
      {
        yoyPct: -26.1,
        yoyLabel: "당분기 컨센 EPS(2.00) vs 전년 동기 EPS(2.70)",
        vsConsensusPct: 5,
        vsConsensusLabel: "최근 확정 EPS(2.10) vs 당시 컨센(2.00)",
      },
      "GOOGL",
    );
    expect(pack.headline).toMatch(/10-Q|분기/);
    expect(pack.about).toMatch(/10-Q|분기/);
    expect(pack.numbersBrief).toMatch(/컨센 대비/);
    expect(pack.numbersBrief).toContain("\n");
    expect(pack.interpretation).toMatch(/GOOGL|Beat|\+5/);
    expect(pack.interpretation).not.toMatch(/확인하세요\.$/);
  });

  it("guidance interpretation uses vs-consensus directly", () => {
    const { interpretation } = buildFilingHeadlineAndDetail(
      "8-K",
      "guidance",
      "Outlook",
      "",
      {
        vsConsensusPct: -4.2,
        vsConsensusLabel: "가이던스 EPS(5.00) vs 컨센 EPS(5.22)",
      },
      "AAPL",
    );
    expect(interpretation).toMatch(/AAPL/);
    expect(interpretation).toMatch(/-4\.2%|보수/);
    expect(interpretation).not.toMatch(/보수\/낙관이면/);
  });

  it("consensus interpretation states up/down with pct", () => {
    const { interpretation } = buildFilingHeadlineAndDetail(
      null,
      "consensus",
      "컨센 상향",
      "",
      {
        consensusChangePct: 3.5,
        consensusChangeLabel: "당분기 컨센 직전 → 현재",
      },
      "NVDA",
    );
    expect(interpretation).toMatch(/NVDA/);
    expect(interpretation).toMatch(/\+3\.5%|상향/);
  });

  it("governance cards differentiate DEF 14A vs DEFA14A", () => {
    const def = buildFilingHeadlineAndDetail(
      "DEF 14A",
      "governance",
      "DEFINITIVE PROXY STATEMENT",
      "Annual meeting to be held June 1, 2026. Executive compensation and board nominees.",
      { vsConsensusPct: 26.9, yoyPct: 4.5 },
      "GOOGL",
    );
    const addl = buildFilingHeadlineAndDetail(
      "DEFA14A",
      "governance",
      "DEFA14A",
      "Additional definitive proxy soliciting materials. Say-on-pay.",
      { vsConsensusPct: 26.9, yoyPct: 4.5 },
      "GOOGL",
    );
    expect(def.about).toMatch(/정기 Proxy|DEF 14A/);
    expect(addl.about).toMatch(/추가 Proxy|DEFA14A/);
    expect(def.about).not.toBe(addl.about);
    expect(def.interpretation).toMatch(/정기 Proxy|DEF 14A/);
    expect(addl.interpretation).toMatch(/추가 Proxy|DEFA14A/);
  });

  it("metricsFromYahooSnapshot clears earnings fields for governance", () => {
    const m = metricsFromYahooSnapshot(
      "governance",
      {
        symbol: "GOOGL",
        forwardEps: 14,
        trailingEps: 19,
        periods: {
          "0q": {
            epsAvg: 3,
            yearAgoEps: 2.8,
            numAnalysts: 40,
            growthPct: null,
          },
        },
        lastReported: {
          epsActual: 2.87,
          epsEstimate: 2.26,
          surprisePct: 26.9,
        },
        at: Date.now(),
      },
      {},
    );
    expect(m.vsConsensusPct).toBeNull();
    expect(m.yoyPct).toBeNull();
    expect(m.reportedEps).toBeNull();
  });

  it("extracts EPS and revenue lines from filing text", () => {
    const lines = extractFilingNumberLines(
      "Diluted earnings per share $1.25. Total revenues were $50.2 billion. Net income $10.0 billion.",
    );
    expect(lines.some((l) => /EPS|주당/i.test(l))).toBe(true);
    expect(lines.some((l) => /매출|revenue/i.test(l))).toBe(true);
  });

  it("builds guidance headline from 8-K text", () => {
    const { headline, about, detail } = buildFilingHeadlineAndDetail(
      "8-K",
      "guidance",
      "8-K",
      "Item 2.02 Results of Operations. The Company provides full-year guidance and outlook.",
    );
    expect(headline).toMatch(/가이던스|실적|8-K/);
    expect(about).toMatch(/가이던스|실적|8-K/);
    expect(detail.length).toBeGreaterThan(10);
  });

  it("builds Korean article from filing excerpts", () => {
    const text =
      "Item 2.02 Results of Operations. The Company reported diluted earnings per share of $2.10. Total revenues were $90.0 billion for the quarter. The Company provides full-year guidance and outlook for fiscal year.";
    const excerpts = pickFilingExcerpts(text, "guidance", 3);
    expect(excerpts.length).toBeGreaterThan(0);
    const article = buildArticleFromFiling({
      kind: "guidance",
      symbol: "AMZN",
      form: "8-K",
      title: "8-K",
      about: "실적·가이던스 8-K입니다.",
      numbersBrief: "컨센 대비 +1.0%",
      interpretation: "해석: 가이던스 톤을 확인하세요.",
      filingText: text,
      hasFilingText: true,
    });
    expect(article).toMatch(/AMZN/);
    expect(article).toMatch(/EDGAR|원문/);
    expect(article.length).toBeGreaterThan(120);
  });

  it("builds deep analysis with ## sections for 10-Q", () => {
    const text =
      "Consolidated revenues were $119.8 billion. Google Cloud revenues increased 82% to $24.8 billion. Operating income was $40.8 billion. Other income included unrealized gains on equity securities. Purchases of property and equipment were $44.9 billion. The company is subject to antitrust litigation by the Department of Justice.";
    const deep = buildDeepAnalysisFromFiling({
      kind: "earnings",
      symbol: "GOOGL",
      form: "10-Q",
      title: "10-Q",
      about: "분기 보고서(10-Q) 제출입니다.",
      numbersBrief: "매출 공시 추출",
      interpretation: "해석: Cloud 성장과 CapEx를 분리해서 보세요.",
      filingText: text,
      hasFilingText: true,
      metrics: { vsConsensusPct: 2.1, yoyPct: 24 },
    });
    expect(deep).toMatch(/## 한줄 요약/);
    expect(deep).toMatch(/## 핵심 실적/);
    expect(deep).toMatch(/## 사업/);
    expect(deep).toMatch(/GOOGL/);
    expect(deep.length).toBeGreaterThan(400);
  });

  it("strips html", () => {
    expect(htmlToPlainText("<p>Hello <b>World</b></p>")).toBe("Hello World");
  });
});

describe("dedupe form4 cards", () => {
  it("removes form 4 governance spam", () => {
    const store = emptyUsAnnouncementStore();
    store.cards = [
      {
        id: "a",
        symbol: "GOOGL",
        kind: "governance",
        title: "4",
        form: "4",
        accession: "acc-1",
        filedAt: 1,
        source: "t",
        metrics: {},
        ai: { summary: "", generatedAt: 0 },
        links: {},
        createdAt: 1,
      },
      {
        id: "b",
        symbol: "GOOGL",
        kind: "governance",
        title: "Proxy",
        form: "DEF 14A",
        accession: "acc-2",
        filedAt: 2,
        source: "t",
        metrics: {},
        ai: { summary: "", generatedAt: 0 },
        links: {},
        createdAt: 2,
      },
    ];
    const { removed } = dedupeRegisteredAnnouncementCards(store);
    expect(removed).toBe(1);
    expect(store.cards).toHaveLength(1);
    expect(store.cards[0].form).toBe("DEF 14A");
  });
});

/** 백테스트 시나리오: 가이던스 < 컨센 → 보수 의견 */
describe("backtest scenarios", () => {
  const cases = [
    {
      name: "guidance beat consensus",
      kind: "guidance",
      guidanceEps: 8,
      consensusEps: 7,
      expect: /낙관/,
    },
    {
      name: "guidance miss consensus",
      kind: "guidance",
      guidanceEps: 6,
      consensusEps: 7,
      expect: /보수/,
    },
    {
      name: "consensus cut",
      kind: "consensus",
      consensusEps: 5,
      priorConsensusEps: 6,
      expect: /하향/,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const metrics = buildAnnouncementMetrics({
        kind: c.kind,
        guidanceEps: c.guidanceEps,
        consensusEps: c.consensusEps,
        priorConsensusEps: c.priorConsensusEps,
      });
      const summary = buildAnnouncementAiSummary({
        kind: c.kind,
        symbol: "TEST",
        metrics,
      });
      expect(summary).toMatch(c.expect);
    });
  }
});
