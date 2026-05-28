import { describe, expect, it } from "vitest";
import {
  BOX_RANGE_V2_MA_PROFILES,
  getBoxRangeV2MaProfile,
  isAnyBoxRangeModelId,
  isBoxRangeV2MaModelId,
} from "./v2-ma-models.js";

describe("v2-ma-models", () => {
  it("exposes three Pine-aligned profiles", () => {
    expect(BOX_RANGE_V2_MA_PROFILES).toHaveLength(3);
    expect(getBoxRangeV2MaProfile("box-range-v2-ma")?.maStrict).toBe(true);
    expect(getBoxRangeV2MaProfile("box-range-v2-ma-relaxed")?.maStrict).toBe(
      false,
    );
    expect(getBoxRangeV2MaProfile("box-range-v2-ma-bottom-sl")?.stopMode).toBe(
      "bottom",
    );
  });

  it("recognizes legacy box-range id", () => {
    expect(isBoxRangeV2MaModelId("box-range")).toBe(false);
    expect(isAnyBoxRangeModelId("box-range")).toBe(true);
    expect(isAnyBoxRangeModelId("box-range-v2-ma")).toBe(true);
  });
});
