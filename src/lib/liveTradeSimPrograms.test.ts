import { describe, expect, it } from "vitest";
import { filterSimPrograms } from "./liveTradeSimPrograms";

describe("filterSimPrograms", () => {
  it("keeps only sim status", () => {
    const out = filterSimPrograms([
      { id: "a", name: "A", status: "sim" } as never,
      { id: "b", name: "B", status: "armed" } as never,
      { id: "c", name: "C", status: "idle" } as never,
    ]);
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });
});
