import assert from "node:assert/strict";
import test from "node:test";
import { fetchKrNaverIndustryRawName } from "./kr-naver-industry.js";
import { localizeIndustry } from "./stock-vault-meta.js";

test("fetchKrNaverIndustryRawName — 유진테크 업종명", async () => {
  const raw = await fetchKrNaverIndustryRawName("084370.KQ");
  assert.ok(raw);
  assert.match(raw, /반도체/);
  const label = localizeIndustry(raw);
  assert.equal(label, "반도체 장비·소재");
});

test("localizeIndustry — 미분류 시 기타", () => {
  assert.equal(localizeIndustry(null), null);
  assert.equal(localizeIndustry("") ?? "기타", "기타");
});
