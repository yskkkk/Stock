/**
 * Forex Factory 공개 캘린더(XML 우선) — FINNHUB 없을 때 경제 지표 예상치 폴백.
 * `forecast`만 사용합니다(actual·previous 아님).
 */

import { wallTimeToUtcMs } from "./macro-events.js";

const FF_XML_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";
const FF_JSON_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const FF_ROWS_TTL_MS = 45 * 60_000;
const MATCH_WINDOW_MS = 72 * 60 * 60 * 1000;

/** @type {{ at: number; rows: FfRow[] }} */
let ffRowsCache = { at: 0, rows: [] };
/** @type {Promise<FfRow[]> | null} */
let ffInflight = null;

/** @typedef {{ title: string; country: string; at: number; forecast: string | null; previous: string | null }} FfRow */

/** @type {Record<string, { country: string; patterns: RegExp[]; prefer?: RegExp }>} */
const CODE_FF_RULES = {
  CPI: {
    country: "USD",
    patterns: [/consumer price index/i, /\bcpi\b/i],
    prefer: /^(?!.*core).*cpi.*m\/m/i,
  },
  PPI: {
    country: "USD",
    patterns: [/producer price index/i, /\bppi\b/i],
    prefer: /^(?!.*core).*ppi.*m\/m/i,
  },
  NFP: {
    country: "USD",
    patterns: [/non.?farm/i, /payrolls/i, /nfp/i],
  },
  PCE: {
    country: "USD",
    patterns: [/\bpce\b/i, /personal consumption/i],
    prefer: /^(?!.*core).*\bpce\b/i,
  },
  GDP: {
    country: "USD",
    patterns: [/gross domestic product/i, /\bgdp\b/i],
  },
  RETAIL: {
    country: "USD",
    patterns: [/retail sales/i],
  },
  ISM_MFG: {
    country: "USD",
    patterns: [/ism manufacturing/i, /manufacturing pmi/i],
  },
  ISM_SVC: {
    country: "USD",
    patterns: [/ism services/i, /services pmi/i, /non-manufacturing/i],
  },
  JOBLESS: {
    country: "USD",
    patterns: [/unemployment claims/i, /jobless claims/i, /initial claims/i],
  },
  JOLTS: {
    country: "USD",
    patterns: [/\bjolts\b/i],
  },
  CONSUMER_CONF: {
    country: "USD",
    patterns: [/consumer confidence/i, /michigan consumer/i],
  },
  ADP: {
    country: "USD",
    patterns: [/\badp\b/i, /adp employment/i],
  },
  FOMC: {
    country: "USD",
    patterns: [
      /federal funds rate/i,
      /fed interest rate/i,
      /fomc.*rate/i,
      /interest rate decision/i,
    ],
  },
  FOMC_MINUTES: {
    country: "USD",
    patterns: [/fomc minutes/i, /meeting minutes/i],
  },
};

/** @param {string | null | undefined} raw */
function normalizeFfValue(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "-") return null;
  return s;
}

/** @param {string} block @param {string} tag */
function readXmlTag(block, tag) {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`,
    "i",
  );
  const m = block.match(re);
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

/** @param {string} timeStr */
function parseFfClock(timeStr) {
  const t = timeStr.trim().toLowerCase();
  const m = t.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ap = m[3].toLowerCase();
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { hour, minute };
}

/**
 * @param {string} dateStr MM-DD-YYYY
 * @param {string} timeStr
 * @param {string} country
 */
function ffLocalToUtcMs(dateStr, timeStr, country) {
  const dm = dateStr.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!dm) return null;
  const month = Number(dm[1]);
  const day = Number(dm[2]);
  const year = Number(dm[3]);
  const clock = parseFfClock(timeStr);
  if (!clock) return null;
  const tz = country === "USD" ? "America/New_York" : "UTC";
  try {
    return wallTimeToUtcMs(year, month, day, clock.hour, clock.minute, tz);
  } catch {
    return null;
  }
}

/** @param {string} xml */
function parseFfXmlRows(xml) {
  /** @type {FfRow[]} */
  const out = [];
  for (const m of xml.matchAll(/<event>([\s\S]*?)<\/event>/gi)) {
    const block = m[1];
    const title = readXmlTag(block, "title");
    const country = readXmlTag(block, "country").toUpperCase();
    const date = readXmlTag(block, "date");
    const time = readXmlTag(block, "time");
    const forecast = normalizeFfValue(readXmlTag(block, "forecast"));
    const previous = normalizeFfValue(readXmlTag(block, "previous"));
    if (!forecast && !previous) continue;
    const at = ffLocalToUtcMs(date, time, country);
    if (at == null || !Number.isFinite(at)) continue;
    out.push({ title, country, at, forecast, previous });
  }
  return out;
}

/** @param {unknown[]} rows */
function parseFfJsonRows(rows) {
  /** @type {FfRow[]} */
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (row);
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const country = typeof o.country === "string" ? o.country.trim().toUpperCase() : "";
    const forecast = normalizeFfValue(
      o.forecast == null ? null : String(o.forecast),
    );
    const previous = normalizeFfValue(
      o.previous == null ? null : String(o.previous),
    );
    const date = typeof o.date === "string" ? o.date.trim() : "";
    if (!title || (!forecast && !previous)) continue;
    let at = null;
    if (date.includes("T")) {
      const ms = Date.parse(date);
      if (Number.isFinite(ms)) at = ms;
    }
    if (at == null) continue;
    out.push({ title, country, at, forecast, previous });
  }
  return out;
}

async function loadFfRows() {
  const now = Date.now();
  if (ffRowsCache.rows.length && now - ffRowsCache.at < FF_ROWS_TTL_MS) {
    return ffRowsCache.rows;
  }
  if (ffInflight) return ffInflight;

  ffInflight = (async () => {
    const headers = {
      Accept: "*/*",
      "User-Agent": "StockMacro/1.0",
    };

    let rows = [];
    try {
      const xmlRes = await fetch(FF_XML_URL, { headers });
      if (xmlRes.ok) {
        const xml = await xmlRes.text();
        if (xml.includes("<weeklyevents")) {
          rows = parseFfXmlRows(xml);
        }
      }
    } catch {
      /* try json */
    }

    if (!rows.length) {
      try {
        const jsonRes = await fetch(FF_JSON_URL, {
          headers: { ...headers, Accept: "application/json" },
        });
        if (jsonRes.ok) {
          const text = await jsonRes.text();
          if (text.trim().startsWith("[")) {
            rows = parseFfJsonRows(JSON.parse(text));
          }
        }
      } catch {
        /* keep cache */
      }
    }

    if (rows.length) {
      ffRowsCache = { at: Date.now(), rows };
    }
    return rows.length ? rows : ffRowsCache.rows;
  })();

  try {
    return await ffInflight;
  } finally {
    ffInflight = null;
  }
}

/**
 * @param {string} code
 * @param {string} title
 */
function ffMatchStrength(code, title) {
  const rule = CODE_FF_RULES[code];
  if (!rule) return 0;
  if (!rule.patterns.some((re) => re.test(title))) return 0;
  let score = 2;
  if (rule.prefer?.test(title)) score += 3;
  if (code === "CPI" && /core/i.test(title)) score -= 2;
  if (code === "PPI" && /core/i.test(title)) score -= 2;
  if (code === "PCE" && /core/i.test(title)) score -= 1;
  return score;
}

/**
 * @param {{ code: string; region: string; at: number }} ev
 * @param {FfRow[]} rows
 */
function pickFfFields(ev, rows) {
  const rule = CODE_FF_RULES[ev.code];
  if (!rule) return null;
  if (ev.region === "kr") return null;

  /** @type {{ forecast: string | null; previous: string | null; strength: number; delta: number } | null} */
  let best = null;

  for (const row of rows) {
    if (row.country !== rule.country) continue;
    const strength = ffMatchStrength(ev.code, row.title);
    if (strength <= 0) continue;
    const delta = Math.abs(row.at - ev.at);
    if (delta > MATCH_WINDOW_MS) continue;

    const cand = {
      forecast: row.forecast,
      previous: row.previous,
      strength,
      delta,
    };
    if (!best) {
      best = cand;
      continue;
    }
    if (cand.strength > best.strength) {
      best = cand;
      continue;
    }
    if (cand.strength === best.strength && cand.delta < best.delta) {
      best = cand;
    }
  }

  if (!best) return null;
  return { forecast: best.forecast, previous: best.previous };
}

/**
 * @param {Array<{ code: string; region: string; at: number; forecast?: string | null; previous?: string | null }>} events
 */
export async function enrichMacroEventsWithFfConsensus(events) {
  if (!Array.isArray(events) || events.length === 0) return;

  const rows = await loadFfRows();
  if (!rows.length) return;

  for (const ev of events) {
    const picked = pickFfFields(
      { code: ev.code, region: ev.region, at: ev.at },
      rows,
    );
    if (!picked) continue;
    if (!String(ev.forecast ?? "").trim() && picked.forecast) {
      ev.forecast = picked.forecast;
    }
    if (!String(ev.previous ?? "").trim() && picked.previous) {
      ev.previous = picked.previous;
    }
  }
}
