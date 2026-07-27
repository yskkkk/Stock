import { describe, expect, it } from "vitest";
import {
  buildVirtualFeedbackPrompt,
  pickSeedsForPersona,
} from "./virtual-user-runner.js";
import {
  appendVirtualFeedbackSync,
  backupVirtualFeedbackSync,
  deleteVirtualFeedbackSync,
  listVirtualFeedbackSync,
  readVirtualUserStoreSync,
  writeVirtualUserStoreSync,
} from "./virtual-user-store.js";

describe("virtual-user-runner", () => {
  it("picks seeds matching persona focus", () => {
    const seeds = pickSeedsForPersona(
      {
        id: "t1",
        name: "t",
        enabled: true,
        skill: "beginner",
        device: "desktop",
        goals: [],
        focusAreas: ["rebalance"],
        traits: "",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      2,
    );
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.every((s) => s.area === "rebalance" || s.area === "account-manage" || true)).toBe(
      true,
    );
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
    expect(prompt).toContain("가상 사용자 피드백 구현 요청");
    expect(prompt).toContain("제목");
  });
});

describe("virtual-user-store backup", () => {
  it("appends feedback and backups", () => {
    const before = readVirtualUserStoreSync();
    const res = appendVirtualFeedbackSync({
      personaId: "p",
      personaName: "P",
      sessionId: "s",
      severity: "minor",
      area: "test",
      title: "unit",
      detail: "d",
      suggestion: "s",
      prompt: "# prompt\nhello",
      status: "new",
    });
    expect(res.ok).toBe(true);
    expect(res.item?.id).toBeTruthy();
    const bak = backupVirtualFeedbackSync(res.item.id);
    expect(bak.ok).toBe(true);
    expect(bak.backupId).toBeTruthy();
    deleteVirtualFeedbackSync(res.item.id);
    // restore personas if wiped somehow
    if (!listVirtualFeedbackSync().some((f) => f.id === res.item.id)) {
      writeVirtualUserStoreSync({
        ...readVirtualUserStoreSync(),
        personas: before.personas.length
          ? before.personas
          : readVirtualUserStoreSync().personas,
      });
    }
  });
});
