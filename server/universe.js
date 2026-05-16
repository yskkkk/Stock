import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { resolveDisplayName } from "./names-ko.js";
import { getYahooSession, yahooPost } from "./yahoo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KR_TARGET = 300;
const US_TARGET = 500;

function loadFallback(name) {
  try {
    const raw = readFileSync(join(__dirname, "data", name), "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function fetchScreenerPage(region, offset, size, nasdaqOnly) {
  const operands = [{ operator: "eq", operands: ["region", region] }];
  if (nasdaqOnly) {
    operands.push({ operator: "eq", operands: ["exchange", "NMS"] });
  }

  const body = {
    size,
    offset,
    sortField: "market_cap.basic",
    sortType: "DESC",
    quoteType: "EQUITY",
    query: { operator: "AND", operands },
  };

  const data = await yahooPost("/v1/finance/screener", body);
  const quotes = data?.finance?.result?.[0]?.quotes ?? [];
  return quotes
    .map((q) => ({
      symbol: String(q.symbol ?? "").toUpperCase(),
      name: resolveDisplayName(q.symbol, q.shortName, q.longName),
    }))
    .filter((q) => q.symbol);
}

async function fetchUniverseRegion(region, target, nasdaqOnly) {
  const out = [];
  const seen = new Set();

  for (let offset = 0; offset < target && out.length < target; offset += 250) {
    try {
      const page = await fetchScreenerPage(
        region,
        offset,
        Math.min(250, target - offset),
        nasdaqOnly,
      );
      for (const item of page) {
        if (!seen.has(item.symbol)) {
          seen.add(item.symbol);
          out.push(item);
        }
      }
      if (page.length < 100) break;
    } catch {
      break;
    }
  }

  return out.slice(0, target);
}

export async function loadUniverse() {
  let kr = [];
  let us = [];

  try {
    await getYahooSession();
    [kr, us] = await Promise.all([
      fetchUniverseRegion("kr", KR_TARGET, false),
      fetchUniverseRegion("us", US_TARGET, true),
    ]);
  } catch {
    /* fallback */
  }

  const krFallback = loadFallback("universe-kr.json");
  const usFallback = loadFallback("universe-us.json");

  if (kr.length < 50) kr = krFallback;
  if (us.length < 50) us = usFallback;

  const seenKr = new Set();
  const seenUs = new Set();
  kr = [...kr, ...krFallback]
    .filter((s) => {
      if (seenKr.has(s.symbol)) return false;
      seenKr.add(s.symbol);
      return true;
    })
    .slice(0, KR_TARGET);
  us = [...us, ...usFallback]
    .filter((s) => {
      if (seenUs.has(s.symbol)) return false;
      seenUs.add(s.symbol);
      return true;
    })
    .slice(0, US_TARGET);

  return { kr, us };
}
