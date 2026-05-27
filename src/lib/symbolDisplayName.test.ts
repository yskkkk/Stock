import { describe, expect, it } from "vitest";
import {
  getMappedSymbolName,
  resolveSymbolDisplayName,
  symbolLookupKeys,
} from "./symbolDisplayName";

describe("symbolDisplayName", () => {
  it("resolves KR ticker aliases", () => {
    expect(symbolLookupKeys("000120.KS")).toContain("000120");
    expect(getMappedSymbolName("000120")).toBe("CJ대한통운");
    const d = resolveSymbolDisplayName("000120.KS", "000120.KS", "kr");
    expect(d.label).toBe("CJ대한통운");
    expect(d.sublabel).toBe("000120");
  });

  it("prefers mapped name over raw ticker fallback", () => {
    const d = resolveSymbolDisplayName("000240.KS", "000240.KS", "kr");
    expect(d.label).toBe("한국앤컴퍼니");
  });
});
