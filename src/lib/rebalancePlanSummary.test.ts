import { describe, expect, it } from "vitest";
import {
  buildRebalanceNowConfirmMessage,
  buildRebalanceNowRunSubLabel,
  buildRebalancePreviewRunSummaryLead,
  buildRebalancePreviewSubLabel,
  buildRebalanceRunSummaryLead,
  buildRebalanceSharedSpendLead,
  buildRebalanceSpendLines,
  buildRebalanceSpendSummary,
  buildRebalanceSpendSummaryInline,
  buildRebalanceSpendSummaryLead,
  formatRebalanceMoney,
  withRebalanceAmountNote,
} from "./rebalancePlanSummary";

describe("rebalancePlanSummary", () => {
  it("formats native currency per market after 0.2% fee", () => {
    expect(formatRebalanceMoney(1200, "KRW")).toBe("1,198원");
    expect(formatRebalanceMoney(12.5, "USD")).toBe("12.48$");
  });

  it("summarizes cashToSpend in preview format (not order sum)", () => {
    const summary = buildRebalanceSpendSummary(
      [
        {
          market: "kr",
          currency: "KRW",
          cashAvailable: 100_000,
          cashToSpend: 50_000,
          orders: [
            {
              symbol: "005930",
              name: "삼성전자",
              market: "kr",
              amount: 30_000,
              weightPct: 60,
            },
            {
              symbol: "000660",
              name: "SK하이닉스",
              market: "kr",
              amount: 20_000,
              weightPct: 40,
            },
          ],
        },
        {
          market: "us",
          currency: "USD",
          cashAvailable: 100,
          cashToSpend: 50,
          orders: [
            {
              symbol: "AAPL",
              name: "Apple",
              market: "us",
              amount: 25.5,
              weightPct: 100,
            },
          ],
        },
      ],
      ["kr", "us"],
    );
    expect(summary).toBe(
      "원화 현금 이번 사용 49,900원\n달러 현금 이번 사용 49.90$",
    );
  });

  it("builds per-market spend lines for stacked UI", () => {
    const lines = buildRebalanceSpendLines(
      [
        {
          market: "kr",
          currency: "KRW",
          cashAvailable: 100_000,
          cashToSpend: 50_000,
          orders: [],
        },
        {
          market: "us",
          currency: "USD",
          cashAvailable: 100,
          cashToSpend: 50,
          orders: [],
        },
      ],
      ["kr", "us"],
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]?.market).toBe("kr");
    expect(lines[1]?.market).toBe("us");
  });

  it("builds confirm with summary and shared amount note", () => {
    const msg = buildRebalanceNowConfirmMessage(
      [
        {
          market: "kr",
          currency: "KRW",
          cashAvailable: 10_000,
          cashToSpend: 10_000,
          orders: [
            {
              symbol: "005930",
              name: "삼성전자",
              market: "kr",
              amount: 10_000,
              weightPct: 100,
            },
          ],
        },
      ],
      ["kr"],
    );
    expect(msg).toContain("원화 현금 이번 사용 9,980원");
    expect(msg).toContain("왕복 0.2% 수수료 반영");
    expect(msg).toContain("미리보기와 동일하게");
  });

  it("substitutes amount note in templates", () => {
    expect(
      withRebalanceAmountNote("실주문 · {amountNote}"),
    ).toContain("왕복 0.2% 수수료 반영");
  });

  it("summarizes cashToSpend inline for compact buttons", () => {
    const inline = buildRebalanceSpendSummaryInline(
      [
        {
          market: "kr",
          currency: "KRW",
          cashAvailable: 100_000,
          cashToSpend: 50_000,
          orders: [],
        },
        {
          market: "us",
          currency: "USD",
          cashAvailable: 100,
          cashToSpend: 50,
          orders: [],
        },
      ],
      ["kr", "us"],
    );
    expect(inline).toBe(
      "원화 현금 이번 사용 49,900원 · 달러 현금 이번 사용 49.90$",
    );
  });

  it("builds run sub with summary when toolbar has no separate line", () => {
    const sub = buildRebalanceNowRunSubLabel("50,000원 · 25.50$");
    expect(sub).toContain("50,000원");
    expect(sub).toContain("왕복 0.2% 수수료 반영");
    expect(sub).toContain("돈이 나갑니다");
  });

  it("avoids duplicate summary on modal button sub", () => {
    const sub = buildRebalanceNowRunSubLabel("50,000원", {
      repeatSummary: false,
    });
    expect(sub).not.toContain("50,000원");
    expect(sub).toContain("왕복 0.2% 수수료 반영");
    expect(sub).toContain("돈이 나갑니다");
  });

  it("builds preview toolbar sub without spend-money wording", () => {
    const withSum = buildRebalancePreviewSubLabel("50,000원 · 25.50$");
    expect(withSum).toContain("50,000원");
    expect(withSum).toContain("왕복 0.2% 수수료 반영");
    expect(withSum).not.toContain("돈이 나갑니다");

    const bare = buildRebalancePreviewSubLabel(null, { repeatSummary: false });
    expect(bare).toContain("주문 없음");
    expect(bare).not.toContain("돈이 나갑니다");
  });

  it("uses bare role label when spend summary block already shows amountNote", () => {
    expect(
      buildRebalanceNowRunSubLabel(null, {
        repeatSummary: false,
        skipAmountNote: true,
      }),
    ).toBe("돈이 나갑니다");
    expect(
      buildRebalancePreviewSubLabel(null, {
        repeatSummary: false,
        skipAmountNote: true,
      }),
    ).toBe("주문 없음");
  });

  it("builds run summary lead with shared amount note", () => {
    const line = buildRebalanceRunSummaryLead();
    expect(line).toContain("왕복 0.2% 수수료 반영");
    expect(line).toContain("미리보기·즉시 매수 동일");
  });

  it("builds shared spend summary lead for compact toolbar and modal", () => {
    const line = buildRebalanceSpendSummaryLead();
    expect(line).toContain("왕복 0.2% 수수료 반영");
    expect(line).toContain("미리보기·즉시 매수 동일");
    expect(line).toBe(buildRebalanceSharedSpendLead());
  });

  it("builds preview run summary lead matching buy-now footer", () => {
    const preview = buildRebalancePreviewRunSummaryLead();
    const buyNow = buildRebalanceRunSummaryLead();
    expect(preview).toBe(buyNow);
    expect(preview).toContain("미리보기·즉시 매수 동일");
  });
});
