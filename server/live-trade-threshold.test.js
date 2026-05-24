import { describe, expect, it } from "vitest";
import { SIGNAL_SCORE_WEIGHT } from "./technical-default-weights.js";
import { meetsTelegramNotifyScore } from "./technical.js";
import { pickMeetsProgramThreshold } from "./toss-trading-adapter.js";

const WEIGHTS = { ...SIGNAL_SCORE_WEIGHT };

describe("pickMeetsProgramThreshold", () => {
  const program = {
    id: "p1",
    modelId: "m1",
    minScoreRatio: 0.9,
    name: "test",
  };

  it("rejects picks below program ratio (85% alert must not pass 90% program)", () => {
    const max = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const score85 = Math.ceil(max * 0.85);
    expect(meetsTelegramNotifyScore(score85, WEIGHTS, 0.8)).toBe(true);
    expect(
      pickMeetsProgramThreshold(program, {
        symbol: "005930",
        score: score85,
        techModelWeights: WEIGHTS,
        signalIds: [],
      }),
    ).toBe(false);
  });

  it("accepts picks above program ratio using signalIds weighted score", () => {
    const max = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const allSignals = Object.keys(WEIGHTS).filter((id) => WEIGHTS[id] > 0);
    expect(
      pickMeetsProgramThreshold(program, {
        symbol: "005930",
        score: 0,
        techModelWeights: WEIGHTS,
        signalIds: allSignals,
      }),
    ).toBe(true);
    expect(
      meetsTelegramNotifyScore(max, WEIGHTS, program.minScoreRatio),
    ).toBe(true);
  });

  it("does not use telegram 80% floor multiplied by program ratio", () => {
    const max = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const scoreBetween = Math.ceil(max * 0.86);
    expect(meetsTelegramNotifyScore(scoreBetween, WEIGHTS, 0.8)).toBe(true);
    expect(
      pickMeetsProgramThreshold(
        { ...program, minScoreRatio: 0.9 },
        {
          symbol: "AAPL",
          score: scoreBetween,
          techModelWeights: WEIGHTS,
        },
      ),
    ).toBe(false);
  });
});
