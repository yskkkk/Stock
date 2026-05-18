/**
 * Finnhub 경제 캘린더 `estimate` 필드 = 시장·애널리스트 컨센서스(예상치).
 * `actual`은 발표값이므로 예상치로 쓰지 않습니다.
 *
 * 환경변수 `FINNHUB_API_KEY`가 있을 때만 `/api/macro-events` 응답의 forecast를 채웁니다.
 */

/** @type {Promise<unknown[]> | null} */
let finnhubInflight = null;
/** @type {{ key: string; from: string; to: string; at: number; rows: unknown[] }} */
let finnhubRowsCache = {
  key: "",
  from: "",
  to: "",
  at: 0,
  rows: [],
};
const FINNHUB_ROWS_TTL_MS = 30 * 60_000;

/** @param {number} ms */
function toYmdUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** @param {unknown} val */
function formatEstimate(val) {
  if (val == null) return null;
  if (typeof val === "number" && Number.isFinite(val)) {
    if (Number.isInteger(val)) return String(val);
    const r = Math.round(val * 1000) / 1000;
    return String(r);
  }
  const s = String(val).trim();
  if (!s || s === "-") return null;
  return s;
}

/** @param {unknown} row */
function getEstimateFromRow(row) {
  if (!row || typeof row !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (row);
  const e = o.estimate;
  if (e == null) return null;
  if (typeof e === "number" && Number.isFinite(e)) return e;
  if (typeof e === "string") {
    const t = e.trim();
    if (!t || t === "-") return null;
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) ? n : t;
  }
  return null;
}

/** @param {unknown} row */
function parseFinnhubUtcMs(row) {
  if (!row || typeof row !== "object") return null;
  const time = /** @type {Record<string, unknown>} */ (row).time;
  if (typeof time !== "string" || !time.trim()) return null;
  const iso = time.trim().replace(" ", "T");
  const ms = Date.parse(`${iso}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** @param {unknown} row */
function rowCountry(row) {
  if (!row || typeof row !== "object") return "";
  const c = /** @type {Record<string, unknown>} */ (row).country;
  return typeof c === "string" ? c.trim().toUpperCase() : "";
}

/** @param {unknown} row */
function rowEventName(row) {
  if (!row || typeof row !== "object") return "";
  const ev = /** @type {Record<string, unknown>} */ (row).event;
  return typeof ev === "string" ? ev.trim() : "";
}

/**
 * @param {string} fromYmd
 * @param {string} toYmd
 * @param {string} apiKey
 */
async function loadFinnhubEconomicRows(fromYmd, toYmd, apiKey) {
  const now = Date.now();
  if (
    finnhubRowsCache.key === apiKey &&
    finnhubRowsCache.from === fromYmd &&
    finnhubRowsCache.to === toYmd &&
    now - finnhubRowsCache.at < FINNHUB_ROWS_TTL_MS
  ) {
    return finnhubRowsCache.rows;
  }

  if (finnhubInflight) {
    return finnhubInflight;
  }

  const url = `https://finnhub.io/api/v1/calendar/economic?from=${encodeURIComponent(fromYmd)}&to=${encodeURIComponent(toYmd)}&token=${encodeURIComponent(apiKey)}`;

  finnhubInflight = (async () => {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Finnhub economic calendar ${res.status}`);
    }
    const data = await res.json();
    const rows = Array.isArray(data.economicCalendar) ? data.economicCalendar : [];
    finnhubRowsCache = {
      key: apiKey,
      from: fromYmd,
      to: toYmd,
      at: Date.now(),
      rows,
    };
    return rows;
  })();

  try {
    return await finnhubInflight;
  } finally {
    finnhubInflight = null;
  }
}

/** @type {Record<string, string[]>} */
const CODE_EVENT_SUBSTRINGS = {
  CPI: ["consumer price index", "cpi"],
  PPI: ["producer price index", "ppi"],
  NFP: ["nonfarm", "non-farm", "non farm", "payrolls"],
  PCE: ["pce", "personal consumption"],
  GDP: ["gross domestic product", "gdp"],
  RETAIL: ["retail sales"],
  ISM_MFG: ["ism manufacturing", "manufacturing pmi"],
  ISM_SVC: ["ism services", "services pmi", "non-manufacturing pmi"],
  JOBLESS: ["initial claims", "jobless claims"],
  JOLTS: ["jolts"],
  CONSUMER_CONF: ["consumer confidence", "michigan consumer"],
  ADP: ["adp", "employment change"],
  FOMC: ["interest rate decision", "fed rate", "federal funds", "fomc"],
  FOMC_MINUTES: ["fomc minutes", "meeting minutes"],
  KR_CPI: ["cpi", "consumer price", "korea consumer"],
  KR_BOK: ["bank of korea", "bok", "policy rate", "기준금리"],
};

/**
 * @param {string} code
 * @param {string} eventLower
 */
function matchStrength(code, eventLower) {
  const subs = CODE_EVENT_SUBSTRINGS[code];
  if (!subs) return 0;
  if (!subs.some((s) => eventLower.includes(s))) return 0;
  let score = 2;
  if (code === "CPI" && !eventLower.includes("core")) score += 2;
  if (code === "PCE" && !eventLower.includes("core")) score += 2;
  return score;
}

/**
 * @param {{ code: string; region: string; at: number }} ev
 * @param {unknown[]} rows
 */
function pickFinnhubEstimate(ev, rows) {
  const wantCountry = ev.region === "kr" ? "KR" : "US";
  const windowMs = 3 * 60 * 60 * 1000;

  /** @type {{ est: unknown; strength: number; delta: number; event: string } | null} */
  let best = null;

  for (const row of rows) {
    if (rowCountry(row) !== wantCountry) continue;
    const name = rowEventName(row);
    if (!name) continue;
    const el = name.toLowerCase();
    const strength = matchStrength(ev.code, el);
    if (strength <= 0) continue;
    const est = getEstimateFromRow(row);
    if (est == null) continue;
    const t = parseFinnhubUtcMs(row);
    if (t == null) continue;
    const delta = Math.abs(t - ev.at);
    if (delta > windowMs) continue;

    const cand = { est, strength, delta, event: name };
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
  const formatted = formatEstimate(best.est);
  return formatted ? { text: formatted, sourceEvent: best.event } : null;
}

/**
 * @param {Array<{ code: string; region: string; at: number; forecast?: string | null }>} events
 */
export async function enrichMacroEventsWithFinnhubConsensus(events) {
  const apiKey = String(process.env.FINNHUB_API_KEY ?? "").trim();
  if (!apiKey || !Array.isArray(events) || events.length === 0) return;

  let min = Infinity;
  let max = 0;
  for (const e of events) {
    if (typeof e.at === "number" && Number.isFinite(e.at)) {
      if (e.at < min) min = e.at;
      if (e.at > max) max = e.at;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return;

  const fromYmd = toYmdUtc(min - 2 * 86400000);
  const toYmd = toYmdUtc(max + 2 * 86400000);

  let rows;
  try {
    rows = await loadFinnhubEconomicRows(fromYmd, toYmd, apiKey);
  } catch {
    return;
  }
  if (!Array.isArray(rows) || rows.length === 0) return;

  for (const ev of events) {
    const picked = pickFinnhubEstimate(
      { code: ev.code, region: ev.region, at: ev.at },
      rows,
    );
    if (picked?.text) {
      ev.forecast = picked.text;
    }
  }
}
