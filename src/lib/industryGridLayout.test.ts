import { describe, expect, it } from "vitest";
import { industryGridDimensions } from "./industryGridLayout";

describe("industryGridDimensions", () => {
  it("uses three columns for many tabs", () => {
    const { rows, cols } = industryGridDimensions(167);
    expect(cols).toBe(3);
    expect(rows).toBe(56);
  });

  it("handles empty", () => {
    expect(industryGridDimensions(0)).toEqual({ rows: 1, cols: 3 });
  });
});
