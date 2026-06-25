import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  sendStockPickTelegramNow,
  weightedScorePickNotifyEnabled,
} from "./telegram-notify.js";

describe("weighted score pick telegram", () => {
  it("is hard-disabled", () => {
    assert.equal(weightedScorePickNotifyEnabled(), false);
  });

  it("sendStockPickTelegramNow skips without force", async () => {
    const ok = await sendStockPickTelegramNow(
      {
        symbol: "005930.KS",
        name: "삼성전자",
        market: "kr",
        score: 99,
        techModelWeights: {},
      },
      { bypassDedup: true, bypassScore: true },
    );
    assert.equal(ok, false);
  });
});
