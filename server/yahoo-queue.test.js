import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  armYahooRateLimitForTests,
  markRateLimited,
  noteYahooSuccess,
  resetYahooQueueForTests,
  waitForYahooQueueReady,
  yahooRateLimitRemainingMs,
} from "./yahoo-queue.js";

describe("yahoo-queue rate limit", () => {
  beforeEach(() => {
    resetYahooQueueForTests();
    noteYahooSuccess();
  });

  it("markRateLimited sets remaining cool-down", () => {
    markRateLimited();
    assert.ok(yahooRateLimitRemainingMs() > 5_000);
  });

  it("waitForYahooQueueReady resolves after cool-down", async () => {
    armYahooRateLimitForTests(350);
    const t0 = Date.now();
    await waitForYahooQueueReady({ minWaitMs: 40, jitterMs: 0 });
    assert.ok(Date.now() - t0 >= 300);
    assert.equal(yahooRateLimitRemainingMs(), 0);
  });

  it("consecutive rate limits escalate wait", () => {
    markRateLimited();
    const first = yahooRateLimitRemainingMs();
    markRateLimited();
    const second = yahooRateLimitRemainingMs();
    assert.ok(second >= first);
  });
});
