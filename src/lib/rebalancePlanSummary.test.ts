import { describe, expect, it } from "vitest";
import {
  buildRebalanceNowConfirmMessage,
  buildRebalanceNowRunSubLabel,
  formatRebalanceMoney,
  summarizeRebalancePlanTotals,
  withRebalanceAmountNote,
} from "./rebalancePlanSummary";

describe("rebalancePlanSummary", () => {
  it("formats native currency per market", () => {
    expect(formatRebalanceMoney(1200, "KRW")).toBe("1,200원");
    expect(formatRebalanceMoney(12.5, "USD")).toBe("12.50$");
  });

  it("summarizes enabled market totals in preview format", () => {
    const summary = summarizeRebalancePlanTotals(
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
    expect(summary).toBe("50,000원 · 25.50$");
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
    expect(msg).toContain("10,000원");
    expect(msg).toContain("수수료·세금 미포함");
    expect(msg).toContain("미리보기와 동일하게");
  });

  it("substitutes amount note in templates", () => {
    expect(
      withRebalanceAmountNote("실주문 · {amountNote}"),
    ).toContain("수수료·세금 미포함");
  });

  it("builds run sub with summary when toolbar has no separate line", () => {
    const sub = buildRebalanceNowRunSubLabel("50,000원 · 25.50$");
    expect(sub).toContain("50,000원");
    expect(sub).toContain("수수료·세금 미포함");
    expect(sub).toContain("돈이 나갑니다");
  });

  it("avoids duplicate summary on modal button sub", () => {
    const sub = buildRebalanceNowRunSubLabel("50,000원", {
      repeatSummary: false,
    });
    expect(sub).not.toContain("50,000원");
    expect(sub).toContain("수수료·세금 미포함");
    expect(sub).toContain("돈이 나갑니다");
  });
});
