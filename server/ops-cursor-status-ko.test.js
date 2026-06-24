import { describe, expect, it } from "vitest";
import {
  cursorAgentStatusKo,
  formatOpsCursorStatusLine,
  opsAgentRuntimeKo,
} from "./ops-cursor-status-ko.js";

describe("ops-cursor-status-ko", () => {
  it("maps Cursor SDK lifecycle statuses", () => {
    expect(cursorAgentStatusKo("CREATING")).toBe("에이전트 준비 중");
    expect(cursorAgentStatusKo("RUNNING")).toBe("실행 중");
    expect(cursorAgentStatusKo("finished")).toBe("완료");
    expect(cursorAgentStatusKo("cancelled")).toBe("중단됨");
  });

  it("formats status line with detail", () => {
    expect(formatOpsCursorStatusLine("RUNNING", "Provisioning VM")).toMatch(
      /실행 중/,
    );
  });

  it("maps runtime labels", () => {
    expect(opsAgentRuntimeKo("local")).toBe("로컬");
    expect(opsAgentRuntimeKo("cloud")).toBe("클라우드");
  });
});
