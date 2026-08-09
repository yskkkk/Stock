import { describe, expect, it } from "vitest";
import {
  buildAnnouncementAiSummary,
  buildAnnouncementMetrics,
  pctChange,
} from "./us-announcement-analyze.js";
import {
  buildAnnouncementDedupeKey,
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
import { consensusEpsChangedEnough } from "./us-announcement-consensus.js";
import { buildAnnouncementNotifyText } from "./us-announcement-notify.js";

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
      filedAt: Date.now(),
      source: "test",
      metrics: {},
      ai: { summary: "x", generatedAt: Date.now() },
      links: {},
      createdAt: Date.now(),
    };
    const a = insertAnnouncementCard(store, card, key);
    expect(a.inserted).toBe(true);
    expect(hasSeenAnnouncementKey(store, key)).toBe(true);
    const b = insertAnnouncementCard(store, { ...card, id: "c2" }, key);
    expect(b.inserted).toBe(false);
    expect(listAnnouncementCards(store, { symbol: "AAPL" })).toHaveLength(1);
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
