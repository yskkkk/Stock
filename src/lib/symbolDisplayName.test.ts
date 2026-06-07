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
    expect(d.sublabel).toBeUndefined();
  });

  it("shows ticker for English labels only", () => {
    const d = resolveSymbolDisplayName("XYL", "Xylem Inc.", "us");
    expect(d.label).toBe("Xylem Inc.");
    expect(d.sublabel).toBe("XYL");
  });

  it("hides ticker for mapped Korean US names", () => {
    const d = resolveSymbolDisplayName("VRSK", "Verisk Analytics, Inc.", "us");
    expect(d.label).toBe("베리스크");
    expect(d.sublabel).toBeUndefined();
  });

  it("prefers mapped name over raw ticker fallback", () => {
    const d = resolveSymbolDisplayName("000240.KS", "000240.KS", "kr");
    expect(d.label).toBe("한국앤컴퍼니");
  });
});
