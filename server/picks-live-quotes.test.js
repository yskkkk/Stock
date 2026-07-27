import { describe, expect, it } from "vitest";
import {
  fetchQuoteSnapshotsForSymbols,
  readCachedQuoteSnapshotsForSymbols,
} from "./picks-live-quotes.js";

describe("picks-live-quotes cached reads", () => {
  it("readCachedQuoteSnapshotsForSymbols returns only warm cache without network", async () => {
    await fetchQuoteSnapshotsForSymbols(["005930.KS"], { maxAgeMs: 0 }).catch(() => {});
    const cached = readCachedQuoteSnapshotsForSymbols(["005930.KS"], { maxAgeMs: 120_000 });
    const fresh = readCachedQuoteSnapshotsForSymbols(["ZZZZZZZZ"], { maxAgeMs: 120_000 });
    expect(typeof cached).toBe("object");
    expect(typeof fresh).toBe("object");
    expect(Object.keys(fresh)).toHaveLength(0);
  });
});
