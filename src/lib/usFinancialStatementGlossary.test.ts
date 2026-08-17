import { describe, expect, it } from "vitest";
import {
  GLOSSARY_SECTIONS,
  US_FINANCIAL_GLOSSARY,
  lookupFinancialGlossary,
  searchFinancialGlossary,
} from "./usFinancialStatementGlossary";

const YAHOO_AND_METRIC_LABELS = [
  "매출액",
  "매출원가",
  "매출총이익",
  "영업이익",
  "당기순이익",
  "EBIT",
  "법인세차감전이익",
  "법인세",
  "연구개발비",
  "판매·관리비",
  "총자산",
  "총부채",
  "총자본",
  "현금",
  "매출채권",
  "재고자산",
  "장기부채",
  "단기차입금",
  "영업활동현금흐름",
  "투자활동현금흐름",
  "재무활동현금흐름",
  "CAPEX",
  "배당금",
  "잉여현금흐름",
  "PER (주가수익비율)",
  "Forward PER",
  "EPS (주당순이익)",
  "BPS (주당순자산)",
  "PBR (주가순자산비율)",
  "시가총액",
  "배당수익률",
  "순이익률",
  "ROE",
];

describe("usFinancialStatementGlossary", () => {
  it("has unique ids and covers all sections", () => {
    const ids = US_FINANCIAL_GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = new Set(US_FINANCIAL_GLOSSARY.map((e) => e.section));
    expect([...GLOSSARY_SECTIONS].every((s) => sections.has(s.id))).toBe(true);
    expect(US_FINANCIAL_GLOSSARY.length).toBeGreaterThan(120);
  });

  it("looks up Yahoo statement and metric labels used in the financials tab", () => {
    for (const label of YAHOO_AND_METRIC_LABELS) {
      expect(lookupFinancialGlossary(label), label).not.toBeNull();
    }
  });

  it("matches English aliases without caring about case", () => {
    expect(lookupFinancialGlossary("accounts receivable")?.id).toBe("ar");
    expect(lookupFinancialGlossary("Free Cash Flow")?.id).toBe("fcf");
    expect(lookupFinancialGlossary("10-K")?.id).toBe("10k");
    expect(lookupFinancialGlossary("Form 4")?.id).toBe("form4");
  });

  it("does not confuse 법인세 with 법인세차감전이익", () => {
    expect(lookupFinancialGlossary("법인세")?.id).toBe("tax-expense");
    expect(lookupFinancialGlossary("법인세차감전이익")?.id).toBe("pretax");
  });

  it("does not map 영업활동현금흐름 to 현금", () => {
    expect(lookupFinancialGlossary("현금")?.id).toBe("cash");
    expect(lookupFinancialGlossary("영업활동현금흐름")?.id).toBe("ocf");
  });

  it("filters by section and search query", () => {
    const income = searchFinancialGlossary("", "income");
    expect(income.every((e) => e.section === "income")).toBe(true);
    const hits = searchFinancialGlossary("이연수익");
    expect(hits.some((e) => e.id === "deferred-rev")).toBe(true);
    expect(searchFinancialGlossary("없는단어xyzzy")).toEqual([]);
  });
});
