import { describe, expect, it } from "vitest";
import {
  fmtFinancialStatementCell,
  statementRowDisplayUnit,
} from "./fmtFinancialStatement";
import { normalizeKrStatementMoneyValue } from "./statementDisplayUnits";

describe("fmtFinancialStatement", () => {
  const note = "단위: 억원";

  it("maps common KR statement rows", () => {
    expect(statementRowDisplayUnit("매출액", note)).toBe("억원");
    expect(statementRowDisplayUnit("영업이익률", note)).toBe("%");
    expect(statementRowDisplayUnit("ROE", note)).toBe("%");
    expect(statementRowDisplayUnit("EPS", note)).toBe("원");
    expect(statementRowDisplayUnit("PER", note)).toBe("배");
    expect(statementRowDisplayUnit("주당배당금", note)).toBe("원");
  });

  it("formats cells with units in 억원 only", () => {
    expect(fmtFinancialStatementCell("525,763", "매출액", note)).toBe("525,763억원");
    expect(fmtFinancialStatementCell("376,183", "영업이익", note)).toBe("376,183억원");
    expect(fmtFinancialStatementCell("10,419", "매출액", note)).toBe("10,419억원");
    expect(fmtFinancialStatementCell("9,999", "매출액", note)).toBe("9,999억원");
    expect(fmtFinancialStatementCell("71.54", "영업이익률", note)).toBe("71.54%");
    expect(fmtFinancialStatementCell("30.15", "부채비율", note)).toBe("30.15%");
    expect(fmtFinancialStatementCell("56,066", "EPS", note)).toBe("56,066원");
    expect(fmtFinancialStatementCell("7.80", "PER", note)).toBe("7.80배");
    expect(fmtFinancialStatementCell("—", "매출액", note)).toBe("—");
    expect(fmtFinancialStatementCell("12.3%", "영업이익률", note)).toBe("12.3%");
  });

  it("normalizes Yahoo won raw to 억원 display", () => {
    expect(normalizeKrStatementMoneyValue("1,041,895,730,000", note, "매출액")).toBe("10,419");
    expect(fmtFinancialStatementCell("1,041,895,730,000", "매출액", note)).toBe("10,419억원");
    expect(fmtFinancialStatementCell("-114,860,100,000", "당기순이익", note)).toBe("-1,149억원");
  });
});
