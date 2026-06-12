import { describe, expect, it } from "vitest";
import {
  dartAccountsToSections,
  formatDartAccountValue,
  parseDartAmount,
  parseDartPeriodId,
} from "./dart-financials.js";

describe("parseDartAmount", () => {
  it("콤마·괄호 음수", () => {
    expect(parseDartAmount("1,234,567")).toBe(1234567);
    expect(parseDartAmount("(1000)")).toBe(-1000);
  });
});

describe("formatDartAccountValue", () => {
  it("주당이익은 원 단위 그대로", () => {
    expect(formatDartAccountValue("기본주당이익(손실)", 2131)).toBe("2,131");
  });

  it("매출은 억원 환산", () => {
    expect(formatDartAccountValue("영업수익", 258_935_494_000_000)).toBe("2,589,355");
  });
});

describe("dartAccountsToSections", () => {
  it("sj_nm별 섹션 분리", () => {
    const sections = dartAccountsToSections([
      {
        sj_nm: "손익계산서",
        account_nm: "기본주당이익(손실)",
        thstrm_amount: "2131",
      },
      {
        sj_nm: "손익계산서",
        account_nm: "당기순이익(손실)",
        thstrm_amount: "15487100000000",
      },
      {
        sj_nm: "재무상태표",
        account_nm: "자산총계",
        thstrm_amount: "100000000000000",
      },
    ]);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("재무상태표");
    expect(sections[1].title).toBe("손익계산서");
    expect(sections[1].rows[0].value).toBe("2,131");
  });
});

describe("parseDartPeriodId", () => {
  it("연간·분기 ID", () => {
    expect(parseDartPeriodId("d:a:2023")).toEqual({
      kind: "annual",
      year: 2023,
      reprtCode: "11011",
    });
    expect(parseDartPeriodId("d:q:2024:11013")).toEqual({
      kind: "quarter",
      year: 2024,
      reprtCode: "11013",
    });
  });
});
