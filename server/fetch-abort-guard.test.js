import { describe, expect, it } from "vitest";
import { isAbortLikeError } from "./fetch-abort-guard.js";

describe("isAbortLikeError", () => {
  it("matches common fetch/AbortSignal abort shapes", () => {
    expect(isAbortLikeError(new Error("[canceled] This operation was aborted"))).toBe(
      true,
    );
    expect(isAbortLikeError("canceled")).toBe(true);
    expect(isAbortLikeError("[canceled] This operation was aborted")).toBe(true);
    expect(
      isAbortLikeError(Object.assign(new Error("canceled"), { name: "CanceledError" })),
    ).toBe(true);
    expect(isAbortLikeError({ code: "ERR_CANCELED", message: "canceled" })).toBe(true);
    expect(isAbortLikeError({ code: "UND_ERR_ABORTED", message: "aborted" })).toBe(
      true,
    );
  });

  it("does not treat unrelated failures as abort", () => {
    expect(isAbortLikeError(new Error("fetch failed"))).toBe(false);
    expect(isAbortLikeError(null)).toBe(false);
  });
});
