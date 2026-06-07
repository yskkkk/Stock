import { describe, expect, it } from "vitest";
import { localizeIndustry, normalizeIndustryText } from "./stock-vault-meta.js";

describe("stock-vault-meta", () => {
  it("normalizes dash variants", () => {
    expect(normalizeIndustryText("Drug Manufacturers—General")).toBe(
      "Drug Manufacturers-General",
    );
  });

  it("localizes known industries to Korean", () => {
    expect(localizeIndustry("Semiconductors")).toBe("반도체");
    expect(localizeIndustry("Consumer Electronics")).toBe("가전·전자");
    expect(localizeIndustry("Specialty Industrial Machinery")).toBe("산업기계");
  });

  it("uses keyword fallback for unknown labels", () => {
    expect(localizeIndustry("Some Obscure Semiconductor Widgets")).toBe("반도체");
  });

  it("keeps Hangul labels", () => {
    expect(localizeIndustry("반도체")).toBe("반도체");
  });

  it("maps unknown english to 기타", () => {
    expect(localizeIndustry("ZZZ Unknown Category XYZ")).toBe("기타");
  });
});
