import { normalizeVaultScanTimeframe } from "./vault-scan-timeframe.js";

/**
 * @param {Array<{ symbol: string }>} dailyHits
 * @param {Array<{ symbol: string }>} weeklyHits
 */
export function intersectHitsBySymbol(dailyHits, weeklyHits) {
  const weekMap = new Map(
    (weeklyHits ?? []).map((h) => [
      String(h.symbol ?? "")
        .trim()
        .toUpperCase(),
      h,
    ]),
  );
  return (dailyHits ?? [])
    .filter((d) =>
      weekMap.has(
        String(d.symbol ?? "")
          .trim()
          .toUpperCase(),
      ),
    )
    .map((d) => {
      const sym = String(d.symbol ?? "")
        .trim()
        .toUpperCase();
      return { daily: d, weekly: weekMap.get(sym) };
    });
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {Record<import("./vault-scan-timeframe.js").VaultScanTimeframe, { goldenCross: { hits: unknown[] }; maAlign: { hits: unknown[] } }>} byTimeframe
 */
export function buildMarketTimeframeIntersections(market, scanDate, byTimeframe) {
  const daily = byTimeframe?.["1d"];
  const weekly = byTimeframe?.["1wk"];
  if (!daily || !weekly) {
    return {
      market,
      scanDate,
      goldenCross: [],
      maAlign: [],
    };
  }
  return {
    market,
    scanDate,
    goldenCross: intersectHitsBySymbol(
      daily.goldenCross?.hits ?? [],
      weekly.goldenCross?.hits ?? [],
    ),
    maAlign: intersectHitsBySymbol(
      daily.maAlign?.hits ?? [],
      weekly.maAlign?.hits ?? [],
    ),
  };
}

/**
 * @param {Array<{ market: "kr"|"us"; scanDate: string; timeframe?: string; hits: unknown[] }>} goldenCross
 * @param {Array<{ market: "kr"|"us"; scanDate: string; timeframe?: string; hits: unknown[] }>} maAlign
 */
export function buildEmailTimeframeIntersections(goldenCross, maAlign) {
  /** @type {Map<"kr"|"us", { market: "kr"|"us"; scanDate: string; goldenCross: ReturnType<typeof intersectHitsBySymbol>; maAlign: ReturnType<typeof intersectHitsBySymbol> }>} */
  const byMarket = new Map();

  for (const block of goldenCross) {
    const market = block.market === "us" ? "us" : "kr";
    const row = byMarket.get(market) ?? {
      market,
      scanDate: block.scanDate,
      goldenCross: [],
      maAlign: [],
      _gcDay: [],
      _gcWeek: [],
      _maDay: [],
      _maWeek: [],
    };
    row.scanDate = block.scanDate || row.scanDate;
    if (normalizeVaultScanTimeframe(block.timeframe) === "1wk") {
      row._gcWeek = block.hits ?? [];
    } else {
      row._gcDay = block.hits ?? [];
    }
    byMarket.set(market, row);
  }

  for (const block of maAlign) {
    const market = block.market === "us" ? "us" : "kr";
    const row = byMarket.get(market) ?? {
      market,
      scanDate: block.scanDate,
      goldenCross: [],
      maAlign: [],
      _gcDay: [],
      _gcWeek: [],
      _maDay: [],
      _maWeek: [],
    };
    row.scanDate = block.scanDate || row.scanDate;
    if (normalizeVaultScanTimeframe(block.timeframe) === "1wk") {
      row._maWeek = block.hits ?? [];
    } else {
      row._maDay = block.hits ?? [];
    }
    byMarket.set(market, row);
  }

  return [...byMarket.values()].map((row) => ({
    market: row.market,
    scanDate: row.scanDate,
    goldenCross: intersectHitsBySymbol(row._gcDay, row._gcWeek),
    maAlign: intersectHitsBySymbol(row._maDay, row._maWeek),
  }));
}
