import { describe, expect, it } from "vitest";
import { resolvePreVirtualUserCommitSha } from "./code-version-git.js";
import {
  ensureBaselineCodeVersionSync,
  readCodeVersionStoreSync,
} from "./code-version-store.js";

describe("code-version baseline", () => {
  it("resolves a pre-virtual-user commit sha", () => {
    const sha = resolvePreVirtualUserCommitSha();
    expect(sha).toMatch(/^[0-9a-f]{40}$/i);
  });

  it("keeps locked baseline across ensure calls (not current HEAD)", () => {
    const a = ensureBaselineCodeVersionSync();
    expect(a.ok).toBe(true);
    const store1 = readCodeVersionStoreSync();
    expect(store1.lockedBaselineSha).toBeTruthy();
    const b = ensureBaselineCodeVersionSync();
    expect(b.ok).toBe(true);
    const store2 = readCodeVersionStoreSync();
    expect(store2.lockedBaselineSha).toBe(store1.lockedBaselineSha);
    expect(store2.baselineId).toBe(store1.baselineId);
  });
});
