import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  forceRescreen,
  runScreeningOnce,
  screeningPollerEnabled,
} from "./screener.js";

describe("screener disabled", () => {
  it("screeningPollerEnabled is false", () => {
    assert.equal(screeningPollerEnabled(), false);
  });

  it("forceRescreen rejects when disabled", () => {
    const r = forceRescreen();
    assert.equal(r.ok, false);
    assert.match(r.message ?? "", /비활성/);
  });

  it("runScreeningOnce skips when disabled", async () => {
    const r = await runScreeningOnce();
    assert.equal(r.skipped, true);
  });
});
