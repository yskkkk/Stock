import { describe, expect, it } from "vitest";
import {
  holdingGrossReturnPctFromCost,
  holdingNetReturnPctFromCost,
} from "./net-return.js";

describe("holdingNetReturnPctFromCost", () => {
  it("matches purchase vs valuation", () => {
    expect(holdingGrossReturnPctFromCost(20_000, 19_998)).toBeCloseTo(-0.01, 2);
    expect(holdingNetReturnPctFromCost(20_000, 19_998, 0.002)).toBeLessThan(0);
  });
});
