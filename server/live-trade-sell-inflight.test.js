import { describe, it, expect, beforeEach } from "vitest";
import {
  liveTradeSellLockKey,
  tryAcquireLiveTradeSellLock,
  releaseLiveTradeSellLock,
  withLiveTradeSellLock,
  isLiveTradeSellLocked,
} from "./live-trade-sell-inflight.js";

describe("live-trade-sell-inflight", () => {
  beforeEach(() => {
    for (const k of ["u1:us:AAPL", "u1:kr:005930", "u2:us:AAPL"]) {
      releaseLiveTradeSellLock(k);
    }
  });

  it("keys isolate by user/market/symbol", () => {
    expect(liveTradeSellLockKey("u1", "us", "aapl")).toBe("u1:us:AAPL");
    expect(liveTradeSellLockKey("u1", "US", "AAPL")).toBe("u1:us:AAPL");
    expect(liveTradeSellLockKey("u2", "us", "AAPL")).toBe("u2:us:AAPL");
  });

  it("blocks concurrent acquire on same key", () => {
    const key = liveTradeSellLockKey("u1", "us", "AAPL");
    expect(tryAcquireLiveTradeSellLock(key)).toBe(true);
    expect(isLiveTradeSellLocked(key)).toBe(true);
    expect(tryAcquireLiveTradeSellLock(key)).toBe(false);
    releaseLiveTradeSellLock(key);
    expect(tryAcquireLiveTradeSellLock(key)).toBe(true);
    releaseLiveTradeSellLock(key);
  });

  it("withLiveTradeSellLock releases after work", async () => {
    const key = liveTradeSellLockKey("u1", "kr", "005930");
    const a = await withLiveTradeSellLock(key, async () => "ok");
    expect(a).toEqual({ ok: true, value: "ok" });
    expect(isLiveTradeSellLocked(key)).toBe(false);
    const busy = withLiveTradeSellLock(key, async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 1;
    });
    const blocked = await withLiveTradeSellLock(key, async () => 2);
    expect(blocked.ok).toBe(false);
    await busy;
  });
});
