import { describe, expect, it } from "vitest";
import {
  buildVirtualFeedbackPrompt,
  pickSeedsForPersona,
} from "./virtual-user-runner.js";
import {
  shouldBlockVirtualUserMoneyRequest,
  rejectIfVirtualUserLiveOrder,
  virtualUserAls,
  findLiveOrderGuardGaps,
} from "./virtual-user-order-guard.js";
import {
  clampSatisfactionLevel,
  feedbackFingerprint,
  isFeedbackDuplicate,
  knownFingerprintsForPersona,
  shouldEscalateSatisfaction,
} from "./virtual-user-satisfaction.js";
import {
  buildContinuousNoveltySeeds,
  noveltyTickKey,
} from "./virtual-user-novelty.js";
import { isCursorApiExhaustedError } from "./virtual-user-api-guard.js";
import {
  isIntentionalDisableText,
  isPollIntervalTuneText,
  shouldSkipBackendImprovementItem,
} from "./virtual-user-backend-probe.js";
import {
  buildDiscomfortText,
  buildImprovementSummary,
} from "./virtual-user-feedback-enrich.js";

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
        satisfactionLevel: 1,
        lastEscalatedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      4,
    );
    expect(seeds.length).toBeGreaterThanOrEqual(2);
  });

  it("unlocks deeper seeds at higher satisfaction", () => {
    const low = pickSeedsForPersona(
      {
        id: "t1",
        name: "t",
        enabled: true,
        skill: "beginner",
        device: "desktop",
        goals: [],
        focusAreas: ["rebalance", "account-manage"],
        traits: "",
        satisfactionLevel: 1,
        lastEscalatedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      8,
      { satisfactionLevel: 1 },
    );
    const high = pickSeedsForPersona(
      {
        id: "t1",
        name: "t",
        enabled: true,
        skill: "beginner",
        device: "desktop",
        goals: [],
        focusAreas: ["rebalance", "account-manage"],
        traits: "",
        satisfactionLevel: 5,
        lastEscalatedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      8,
      { satisfactionLevel: 5 },
    );
    expect(high.length).toBeGreaterThanOrEqual(low.length);
    expect(high.some((s) => (s.minSatisfaction ?? 1) >= 4)).toBe(true);
  });

  it("builds prompt with feedback id and satisfaction", () => {
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
        satisfactionLevel: 3,
        lastEscalatedAtMs: null,
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
    expect(prompt).toContain("satisfaction: 3");
    expect(prompt).toContain("UI 방향");
    expect(prompt).toContain("최소 diff");
    expect(prompt).toContain("PC와 모바일");
    expect(prompt).toContain("단순 통일");
    expect(prompt).toContain("아이콘");
    expect(prompt).toMatch(/44/);
  });

  it("mobile prompt forbids changing layout frame", () => {
    const prompt = buildVirtualFeedbackPrompt(
      "fb-m",
      {
        id: "vu-mobile-power",
        name: "모바일",
        enabled: true,
        skill: "power",
        device: "mobile",
        goals: ["g"],
        focusAreas: ["mobile"],
        traits: "t",
        satisfactionLevel: 1,
        lastEscalatedAtMs: null,
        createdAtMs: 0,
        updatedAtMs: 0,
      },
      {
        severity: "major",
        area: "mobile",
        title: "가로 넘침",
        detail: "잘림",
        suggestion: "줄바꿈",
      },
      "sess-m",
    );
    expect(prompt).toContain("앱 틀");
    expect(prompt).toContain("바꾸지 말");
    expect(prompt).toContain("device: mobile");
  });

  it("prioritizes mobile seeds for mobile personas", () => {
    const seeds = pickSeedsForPersona(
      {
        id: "vu-mobile-beginner",
        name: "모바일 초보",
        enabled: true,
        skill: "beginner",
        device: "mobile",
        goals: ["g"],
        focusAreas: ["mobile", "account-manage"],
        traits: "t",
        satisfactionLevel: 1,
        lastEscalatedAtMs: null,
        createdAtMs: 0,
        updatedAtMs: 0,
      },
      4,
    );
    expect(seeds.some((s) => s.area === "mobile")).toBe(true);
    expect(seeds[0].area).toBe("mobile");
  });
});

describe("virtual-user-satisfaction", () => {
  it("fingerprints and detects duplicates", () => {
    const fp = feedbackFingerprint("rebalance", "[브라우저] tab-x 실패");
    expect(fp).toContain("rebalance::");
    const known = knownFingerprintsForPersona(
      [
        {
          personaId: "p1",
          area: "rebalance",
          title: "시장 켜짐/꺼짐·통화 구분이 한눈에 안 들어온다",
          status: "new",
        },
      ],
      "p1",
    );
    expect(
      isFeedbackDuplicate(known, {
        area: "rebalance",
        title: "시장 켜짐/꺼짐·통화 구분이 한눈에 안 들어온다",
      }),
    ).toBe(true);
    expect(
      isFeedbackDuplicate(known, {
        area: "rebalance",
        title: "완전히 다른 제목",
      }),
    ).toBe(false);
  });

  it("allows done fingerprints to revisit after TTL", () => {
    const now = 1_000_000_000_000;
    const known = knownFingerprintsForPersona(
      [
        {
          personaId: "p1",
          area: "rebalance",
          title: "완료된 이슈",
          status: "done",
          implementDoneAtMs: now - 8 * 24 * 60 * 60 * 1000,
        },
      ],
      "p1",
      { allowDoneRevisitAfterMs: 7 * 24 * 60 * 60 * 1000, nowMs: now },
    );
    expect(known.size).toBe(0);
  });

  it("escalates when saturated", () => {
    expect(clampSatisfactionLevel(99)).toBe(5);
    expect(
      shouldEscalateSatisfaction({
        emitted: 0,
        skippedDup: 4,
        candidateCount: 5,
        level: 2,
      }),
    ).toBe(true);
    expect(
      shouldEscalateSatisfaction({
        emitted: 3,
        skippedDup: 0,
        candidateCount: 3,
        level: 2,
      }),
    ).toBe(false);
  });
});

describe("virtual-user-auto-implement serial", () => {
  it("exports dispatch and active-job helpers", async () => {
    const mod = await import("./virtual-user-auto-implement.js");
    expect(typeof mod.dispatchNextVirtualUserImplement).toBe("function");
    expect(typeof mod.hasActiveVirtualUserImplementJobSync).toBe("function");
    expect(typeof mod.maybeAutoImplementVirtualFeedback).toBe("function");
  });
});

describe("virtual-user-feedback-enrich", () => {
  it("builds discomfort and improvement summaries", () => {
    expect(
      buildDiscomfortText({
        title: "탭 실패",
        detail: "타임아웃",
      }),
    ).toContain("탭 실패");
    expect(
      buildImprovementSummary("고쳤다\n커밋 완료", {
        title: "탭 실패",
        suggestion: "셀렉터 수정",
      }),
    ).toContain("고쳤다");
    expect(
      buildImprovementSummary("", {
        title: "탭 실패",
        suggestion: "셀렉터 수정",
      }),
    ).toContain("셀렉터 수정");
  });
});

describe("virtual-user-backend-probe", () => {
  it("skips intentional disables and poll-interval tunes", () => {
    expect(isIntentionalDisableText("운영자 요청으로 비활성")).toBe(true);
    expect(isPollIntervalTuneText("폴링 주기를 줄이세요")).toBe(true);
    expect(
      shouldSkipBackendImprovementItem({
        problem: "STOCK_FOO_MS 를 조정하세요",
        suggestion: "intervalMs 변경",
      }),
    ).toBe(true);
    expect(
      shouldSkipBackendImprovementItem({
        id: "process-uncaughtException",
        problem: "JSON parse failed on granville-scan-state.json",
        suggestion: "로더에 try/catch 추가",
      }),
    ).toBe(false);
    expect(
      shouldSkipBackendImprovementItem({
        id: "process-unhandledRejection",
        problem: "unhandledRejection: [canceled] This operation was aborted",
        evidence: "누적 1회",
      }),
    ).toBe(true);
  });
});

describe("virtual-user-api-guard", () => {
  it("detects quota and rate-limit exhaustion", () => {
    expect(isCursorApiExhaustedError("Error 429 Too Many Requests")).toBe(true);
    expect(isCursorApiExhaustedError("insufficient_quota")).toBe(true);
    expect(isCursorApiExhaustedError("CURSOR_API_KEY is not set")).toBe(true);
    expect(
      isCursorApiExhaustedError(
        "CURSOR_API_KEY" + String.fromCharCode(0xac00) + " " + "missing",
      ),
    ).toBe(true);
    expect(isCursorApiExhaustedError("selector timeout on tab")).toBe(false);
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

  it("blocks rebalance-schedule run but allows dryRun", () => {
    expect(
      shouldBlockVirtualUserMoneyRequest(
        "http://127.0.0.1:5173/api/live-trading/toss/rebalance-schedule/run",
        "POST",
        JSON.stringify({ dryRun: false }),
      ),
    ).toBe(true);
    expect(
      shouldBlockVirtualUserMoneyRequest(
        "http://127.0.0.1:5173/api/live-trading/toss/rebalance-schedule/run",
        "POST",
        JSON.stringify({ dryRun: true }),
      ),
    ).toBe(false);
  });

  it("findLiveOrderGuardGaps is empty for current adapters", () => {
    expect(findLiveOrderGuardGaps()).toEqual([]);
  });

  it("rejects live order inside virtual user ALS", () => {
    const blocked = virtualUserAls.run({ active: true }, () =>
      rejectIfVirtualUserLiveOrder(),
    );
    expect(blocked?.blocked).toBe(true);
    expect(rejectIfVirtualUserLiveOrder()).toBeNull();
  });

  it("blocks rebalance-schedule/run but allows dryRun", () => {
    expect(
      shouldBlockVirtualUserMoneyRequest(
        "http://127.0.0.1:5173/api/live-trading/toss/rebalance-schedule/run",
        "POST",
        JSON.stringify({ dryRun: false }),
      ),
    ).toBe(true);
    expect(
      shouldBlockVirtualUserMoneyRequest(
        "http://127.0.0.1:5173/api/live-trading/toss/rebalance-schedule/run",
        "POST",
        JSON.stringify({ dryRun: true }),
      ),
    ).toBe(false);
  });

  it("rejects live order after await when ALS was set at request start", async () => {
    const blocked = await virtualUserAls.run({ active: true }, () =>
      Promise.resolve().then(() => rejectIfVirtualUserLiveOrder()),
    );
    expect(blocked?.blocked).toBe(true);
  });
});

describe("virtual-user-novelty", () => {
  it("still yields seeds when every base title is already known", () => {
    const pool = [
      {
        area: "rebalance",
        title: "시장 켜짐/꺼짐·통화 구분이 한눈에 안 들어온다",
        detail: "d",
        suggestion: "s",
        severity: "major",
        minSatisfaction: 1,
        skills: ["beginner"],
      },
    ];
    const known = new Set([
      feedbackFingerprint(pool[0].area, pool[0].title),
    ]);
    const seeds = buildContinuousNoveltySeeds({
      pool,
      known,
      fingerprint: feedbackFingerprint,
      maxItems: 3,
      personaId: "vu-beginner-kr",
      atMs: Date.now(),
      angleOffset: 2,
    });
    expect(seeds.length).toBeGreaterThanOrEqual(1);
    expect(
      seeds.every((s) => !known.has(feedbackFingerprint(s.area, s.title))),
    ).toBe(true);
    expect(noveltyTickKey().length).toBeGreaterThan(5);
  });

  it("continuous pickSeeds never returns empty under saturated known set", () => {
    const persona = {
      id: "vu-beginner-kr",
      name: "t",
      enabled: true,
      skill: "beginner",
      device: "desktop",
      goals: [],
      focusAreas: ["rebalance", "account-manage"],
      traits: "",
      satisfactionLevel: 5,
      lastEscalatedAtMs: null,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const base = pickSeedsForPersona(persona, 8, { satisfactionLevel: 5 });
    const known = new Set(
      base.map((s) => feedbackFingerprint(s.area, s.title)),
    );
    const novelty = pickSeedsForPersona(persona, 4, {
      satisfactionLevel: 5,
      known,
      continuousNovelty: true,
      noveltyAngleOffset: 4,
      atMs: Date.now(),
    });
    expect(novelty.length).toBeGreaterThanOrEqual(1);
  });
});
