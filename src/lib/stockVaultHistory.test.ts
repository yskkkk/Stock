import { describe, expect, it } from "vitest";
import {
  buildVaultItemsFromScanHistory,
  mergeScanHistoryDates,
} from "./stockVaultHistory";

describe("mergeScanHistoryDates", () => {
  it("unions and sorts desc", () => {
    expect(
      mergeScanHistoryDates(
        ["2026-06-08", "2026-06-06"],
        ["2026-06-07", "2026-06-08"],
      ),
    ).toEqual(["2026-06-08", "2026-06-07", "2026-06-06"]);
  });
});

describe("buildVaultItemsFromScanHistory", () => {
  it("dedupes by symbol and applies favorites", () => {
    const items = buildVaultItemsFromScanHistory(
      "2026-06-08",
      [
        {
          id: "1",
          runId: "r1",
          atMs: 100,
          trigger: "scheduled",
          market: "kr",
          scanDate: "2026-06-08",
          scanned: 300,
          hitCount: 1,
          hits: [
            {
              symbol: "005930.KS",
              name: "삼성전자",
              market: "kr",
              crosses: ["5>20"],
              scanDate: "2026-06-08",
            },
          ],
        },
        {
          id: "2",
          runId: "r2",
          atMs: 200,
          trigger: "scheduled",
          market: "kr",
          scanDate: "2026-06-08",
          scanned: 300,
          hitCount: 1,
          hits: [
            {
              symbol: "005930.KS",
              name: "삼성전자",
              market: "kr",
              crosses: ["5>20", "5>60"],
              scanDate: "2026-06-08",
            },
          ],
        },
      ],
      [
        {
          id: "3",
          runId: "r1",
          atMs: 150,
          trigger: "scheduled",
          market: "us",
          scanDate: "2026-06-08",
          scanned: 500,
          hitCount: 1,
          hits: [
            {
              symbol: "AAPL",
              name: "Apple",
              market: "us",
              scanDate: "2026-06-08",
            },
          ],
        },
      ],
      { favoriteSymbols: new Set(["AAPL"]) },
    );

    const gc = items.find((it) => it.source === "golden_cross");
    expect(gc?.symbol).toBe("005930.KS");
    expect(gc?.crosses).toEqual(["5>20", "5>60"]);
    const ma = items.find((it) => it.source === "ma_align");
    expect(ma?.symbol).toBe("AAPL");
    expect(ma?.favorited).toBe(true);
  });
});
