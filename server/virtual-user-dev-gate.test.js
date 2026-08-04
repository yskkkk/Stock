import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("isServerDevelopingSync", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("./ops-agent-job-queue.js");
  });

  it("allows VU when only IDE lease is running", async () => {
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
    const { isServerDevelopingSync } = await import("./virtual-user-dev-gate.js");
    expect(isServerDevelopingSync()).toBe(false);
  });

  it("blocks VU when web/record-mode agent is running", async () => {
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
