import { describe, expect, it } from "vitest";
import {
  buildVirtualFeedbackPrompt,
  pickSeedsForPersona,
} from "./virtual-user-runner.js";
import {
  shouldBlockVirtualUserMoneyRequest,
  rejectIfVirtualUserLiveOrder,
  virtualUserAls,
} from "./virtual-user-order-guard.js";

describe("virtual-user-runner", () => {
  it("picks multiple seeds without early cut", () => {
    const seeds = pickSeedsForPersona(
      {
        id: "t1",
        name: "t",
        enabled: true,
        skill: "beginner",
        device: "desktop",
        goals: [],
        focusAreas: ["rebalance", "account-manage"],
        traits: "",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      4,
    );
    expect(seeds.length).toBeGreaterThanOrEqual(2);
  });

  it("builds prompt with feedback id", () => {
    const prompt = buildVirtualFeedbackPrompt(
      "fb-1",
      {
        id: "p1",
        name: "테스터",
        enabled: true,
        skill: "beginner",
        device: "desktop",
        goals: ["목표1"],
        focusAreas: ["rebalance"],
        traits: "조심스럽다",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        area: "rebalance",
        areaLabel: "스케줄",
        severity: "major",
        title: "제목",
        detail: "상세",
        suggestion: "제안",
      },
      "sess-1",
    );
    expect(prompt).toContain("feedbackId: fb-1");
    expect(prompt).toContain("실주문");
  });
});

describe("virtual-user-order-guard", () => {
  it("blocks live rebalance-now but allows dryRun", () => {
    expect(
      shouldBlockVirtualUserMoneyRequest(
        "http://127.0.0.1:5173/api/live-trading/toss/rebalance-now",
        "POST",
        JSON.stringify({ dryRun: false }),
      ),
    ).toBe(true);
    expect(
      shouldBlockVirtualUserMoneyRequest(
        "http://127.0.0.1:5173/api/live-trading/toss/rebalance-now",
        "POST",
        JSON.stringify({ dryRun: true }),
      ),
    ).toBe(false);
  });

  it("rejects live order inside virtual user ALS", () => {
    const blocked = virtualUserAls.run({ active: true }, () =>
      rejectIfVirtualUserLiveOrder(),
    );
    expect(blocked?.blocked).toBe(true);
    expect(rejectIfVirtualUserLiveOrder()).toBeNull();
  });
});
