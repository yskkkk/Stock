import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("virtual-user-dev-gate", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("./ops-agent-job-queue.js");
  });

  it("isIdeDevBusySync is true when IDE lease is running", async () => {
    vi.doMock("./ops-agent-job-queue.js", () => ({
      isOpsAgentJobRunning: () => true,
      getOpsAgentQueueMemorySnapshot: () => ({
        entries: [
          {
            status: "running",
            source: "ide",
            requestIp: "cursor-ide",
          },
        ],
      }),
    }));
    const { isIdeDevBusySync, isServerDevelopingSync } = await import(
      "./virtual-user-dev-gate.js"
    );
    expect(isIdeDevBusySync()).toBe(true);
    // 구현 게이트는 IDE를 막지 않음
    expect(isServerDevelopingSync()).toBe(false);
  });

  it("isIdeDevBusySync is true when IDE is waiting", async () => {
    vi.doMock("./ops-agent-job-queue.js", () => ({
      isOpsAgentJobRunning: () => true,
      getOpsAgentQueueMemorySnapshot: () => ({
        entries: [
          {
            status: "running",
            source: "web",
            requestIp: "127.0.0.1",
          },
          {
            status: "waiting",
            source: "ide",
            requestIp: "cursor-ide",
          },
        ],
      }),
    }));
    const { isIdeDevBusySync } = await import("./virtual-user-dev-gate.js");
    expect(isIdeDevBusySync()).toBe(true);
  });

  it("isIdeDevBusySync is false when queue has no IDE", async () => {
    vi.doMock("./ops-agent-job-queue.js", () => ({
      isOpsAgentJobRunning: () => false,
      getOpsAgentQueueMemorySnapshot: () => ({ entries: [] }),
    }));
    const { isIdeDevBusySync } = await import("./virtual-user-dev-gate.js");
    expect(isIdeDevBusySync()).toBe(false);
  });

  it("blocks VU implement when web/record-mode agent is running", async () => {
    vi.doMock("./ops-agent-job-queue.js", () => ({
      isOpsAgentJobRunning: () => true,
      getOpsAgentQueueMemorySnapshot: () => ({
        entries: [
          {
            status: "running",
            source: "web",
            requestIp: "127.0.0.1",
          },
        ],
      }),
    }));
    const { isServerDevelopingSync } = await import("./virtual-user-dev-gate.js");
    expect(isServerDevelopingSync()).toBe(true);
  });
});
