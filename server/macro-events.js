import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { enrichMacroEventsWithFinnhubConsensus } from "./macro-consensus-finhub.js";

/**
 * 정적 일정: `data/macro-releases.json` — 행에 선택 필드 `forecast`(문자열)를 넣으면
 * API·카드에 예상치로 노출됩니다(시장 컨센서스 수치를 수동으로 넣는 용도).
 * `FINNHUB_API_KEY`가 설정된 경우 Finnhub 경제 캘린더의 estimate(컨센서스)가
 * 일치하는 이벤트에 병합되어 우선 표시됩니다. 없으면 클라이언트에서「발표 전」표시.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {Record<string, { name: string; region: "us" | "kr"; importance: "high" | "medium"; category: string }>} */
export const MACRO_META = {
  CPI: {
    name: "\uC18C\uBE44\uC790\uBB3C\uAC00(CPI)",
    region: "us",
    importance: "high",
    category: "inflation",
  },
  PPI: {
    name: "\uC0DD\uC0B0\uC790\uBB3C\uAC00(PPI)",
    region: "us",
    importance: "high",
    category: "inflation",
  },
  NFP: {
    name: "\uBE44\uB18D\uC5C5 \uACE0\uC6A9(NFP)",
    region: "us",
    importance: "high",
    category: "employment",
  },
  FOMC: {
    name: "FOMC \uAE08\uB9AC \uACB0\uC815",
    region: "us",
    importance: "high",
    category: "rates",
  },
  FOMC_MINUTES: {
    name: "FOMC \uC758\uC0AC\uB85D",
    region: "us",
    importance: "medium",
    category: "rates",
  },
  GDP: {
    name: "GDP (\uC131\uC7A5\uB960)",
    region: "us",
    importance: "high",
    category: "growth",
  },
  PCE: {
    name: "PCE \uBB3C\uAC00",
    region: "us",
    importance: "high",
    category: "inflation",
  },
  RETAIL: {
    name: "\uC18C\uB9E4\uD310\uB9E4",
    region: "us",
    importance: "medium",
    category: "growth",
  },
  ISM_MFG: {
    name: "ISM \uC81C\uC870\uC5C5 PMI",
    region: "us",
    importance: "medium",
    category: "pmi",
  },
  ISM_SVC: {
    name: "ISM \uC11C\uBE44\uC2A4 PMI",
    region: "us",
    importance: "medium",
    category: "pmi",
  },
  JOBLESS: {
    name: "\uC2E4\uC5C5\uC218\uB2F9 \uCCAD\uAD6C",
    region: "us",
    importance: "medium",
    category: "employment",
  },
  JOLTS: {
    name: "JOLTS \uAD6C\uC778",
    region: "us",
    importance: "medium",
    category: "employment",
  },
  CONSUMER_CONF: {
    name: "\uC18C\uBE44\uC790\uC2E0\uB8B0",
    region: "us",
    importance: "medium",
    category: "sentiment",
  },
  ADP: {
    name: "ADP \uACE0\uC6A9",
    region: "us",
    importance: "medium",
    category: "employment",
  },
  KR_CPI: {
    name: "\uD55C\uAD6D CPI",
    region: "kr",
    importance: "high",
    category: "inflation",
  },
  KR_BOK: {
    name: "\uD55C\uAD6D\uC740\uD589 \uAE08\uB9AC",
    region: "kr",
    importance: "high",
    category: "rates",
  },
};

/**
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @param {string} timeZone
 */
export function wallTimeToUtcMs(year, month, day, hour, minute, timeZone) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let lo = target - 36 * 60 * 60 * 1000;
  let hi = target + 36 * 60 * 60 * 1000;

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  for (let i = 0; i < 40; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(mid)).map((p) => [p.type, p.value]),
    );
    const cur = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
    );
    if (cur < target) lo = mid + 1;
    else if (cur > target) hi = mid - 1;
    else return mid;
  }
  return lo;
}

function parseLocalIso(iso, timeZone) {
  const [datePart, timePart] = iso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return wallTimeToUtcMs(y, m, d, hh, mm, timeZone);
}

function isWeekendUtc(ms, timeZone) {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(new Date(ms));
  return wd === "Sat" || wd === "Sun";
}

function addDaysUtc(ms, days, timeZone) {
  let t = ms + days * 24 * 60 * 60 * 1000;
  while (isWeekendUtc(t, timeZone)) t += 24 * 60 * 60 * 1000;
  return t;
}

function firstBusinessDayOfMonth(year, month, timeZone) {
  let d = 1;
  while (d <= 7) {
    const ms = wallTimeToUtcMs(year, month, d, 12, 0, timeZone);
    if (!isWeekendUtc(ms, timeZone)) return d;
    d++;
  }
  return 1;
}

function nthBusinessDayOfMonth(year, month, n, timeZone) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const ms = wallTimeToUtcMs(year, month, d, 12, 0, timeZone);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(new Date(ms))
      .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
    if (Number(parts.month) !== month) break;
    if (!isWeekendUtc(ms, timeZone)) {
      count++;
      if (count === n) return d;
    }
  }
  return 1;
}

function firstFridayOfMonth(year, month, timeZone) {
  for (let d = 1; d <= 14; d++) {
    const ms = wallTimeToUtcMs(year, month, d, 12, 0, timeZone);
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(new Date(ms));
    if (wd === "Fri") return d;
  }
  return 7;
}

/** @returns {{ code: string; at: string; tz: string; forecast?: string }[]} */
function loadStaticReleases() {
  const file = path.join(__dirname, "data", "macro-releases.json");
  const arr = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const code = typeof x.code === "string" ? x.code.trim() : "";
      const at = typeof x.at === "string" ? x.at.trim() : "";
      const tz = typeof x.tz === "string" ? x.tz.trim() : "";
      if (!code || !at || !tz) return null;
      const fc = x.forecast;
      const forecast =
        typeof fc === "string" && fc.trim()
          ? fc.trim()
          : undefined;
      return { code, at, tz, forecast };
    })
    .filter(Boolean);
}

/** @param {Date} from @param {Date} to */
function generateRecurring(from, to) {
  const tz = "America/New_York";
  const out = [];
  const start = from.getTime();
  const end = to.getTime();

  const anchor = new Date(from);
  for (let i = 0; i < 5; i++) {
    const probe = new Date(anchor);
    probe.setUTCMonth(anchor.getUTCMonth() + i);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "numeric",
      })
        .formatToParts(probe)
        .map((p) => [p.type, p.value]),
    );
    const y = Number(parts.year);
    const m = Number(parts.month);
    const monthMs = wallTimeToUtcMs(y, m, 15, 12, 0, tz);
    if (monthMs < start - 45 * 86400000 || monthMs > end + 45 * 86400000) continue;

    const nfpDay = firstFridayOfMonth(y, m, tz);
    out.push({ code: "NFP", at: wallTimeToUtcMs(y, m, nfpDay, 8, 30, tz) });

    const ismMfgDay = firstBusinessDayOfMonth(y, m, tz);
    out.push({ code: "ISM_MFG", at: wallTimeToUtcMs(y, m, ismMfgDay, 10, 0, tz) });

    const ismSvcDay = nthBusinessDayOfMonth(y, m, 3, tz);
    out.push({ code: "ISM_SVC", at: wallTimeToUtcMs(y, m, ismSvcDay, 10, 0, tz) });
  }

  let cursor = start;
  while (cursor <= end + 7 * 86400000) {
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(new Date(cursor));
    if (wd === "Thu") {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "numeric",
          day: "numeric",
        })
          .formatToParts(new Date(cursor))
          .map((p) => [p.type, p.value]),
      );
      out.push({
        code: "JOBLESS",
        at: wallTimeToUtcMs(
          Number(parts.year),
          Number(parts.month),
          Number(parts.day),
          8,
          30,
          tz,
        ),
      });
    }
    cursor += 86400000;
  }

  return out;
}

/**
 * @param {{ limit?: number; horizonDays?: number }} [opts]
 */
export function getUpcomingMacroEvents(opts = {}) {
  const limit = opts.limit ?? 10;
  const horizonDays = opts.horizonDays ?? 75;
  const now = Date.now();
  const horizon = now + horizonDays * 86400000;

  const raw = [];

  for (const row of loadStaticReleases()) {
    const at = parseLocalIso(row.at, row.tz);
    const fc =
      row.forecast != null && String(row.forecast).trim()
        ? String(row.forecast).trim()
        : undefined;
    raw.push({
      code: row.code,
      at,
      tz: row.tz,
      ...(fc ? { forecast: fc } : {}),
    });
  }

  const from = new Date(now - 86400000);
  const to = new Date(horizon);
  for (const row of generateRecurring(from, to)) {
    raw.push({ code: row.code, at: row.at, tz: "America/New_York" });
  }

  const seen = new Set();
  const events = [];

  for (const row of raw) {
    if (row.at < now - 60_000 || row.at > horizon) continue;
    const meta = MACRO_META[row.code];
    if (!meta) continue;
    const key = `${row.code}:${row.at}`;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({
      id: key,
      code: row.code,
      name: meta.name,
      region: meta.region,
      importance: meta.importance,
      category: meta.category,
      at: row.at,
      timezone: row.tz,
      forecast:
        row.forecast != null && String(row.forecast).trim()
          ? String(row.forecast).trim()
          : null,
    });
  }

  events.sort((a, b) => a.at - b.at);

  const POLICY_MACRO_CODES = ["FOMC", "FOMC_MINUTES"];
  /** 다음 연준(FOMC·의사록) 각 1건 — 한도 때문에 뒤로 밀려 나가지 않게 항상 후보 포함 */
  const pinnedPolicy = [];
  const pinnedIds = new Set();
  for (const code of POLICY_MACRO_CODES) {
    const next = events.find((e) => e.code === code);
    if (next && !pinnedIds.has(next.id)) {
      pinnedPolicy.push(next);
      pinnedIds.add(next.id);
    }
  }

  const high = events.filter((e) => e.importance === "high");
  const medium = events.filter((e) => e.importance === "medium");
  /** @type {typeof events} */
  const merged = [];
  const pick = (arr) => {
    for (const e of arr) {
      if (merged.length >= limit) break;
      if (pinnedIds.has(e.id)) continue;
      if (!merged.some((x) => x.id === e.id)) merged.push(e);
    }
  };
  pick(high);
  pick(medium);

  if (merged.length < limit) {
    for (const e of events) {
      if (merged.length >= limit) break;
      if (pinnedIds.has(e.id)) continue;
      if (!merged.some((x) => x.id === e.id)) merged.push(e);
    }
  }

  const withPinned = [...pinnedPolicy.filter((p) => p.at <= horizon), ...merged];
  const dedup = [];
  const seenMerge = new Set();
  for (const e of withPinned) {
    if (seenMerge.has(e.id)) continue;
    seenMerge.add(e.id);
    dedup.push(e);
    if (dedup.length >= limit) break;
  }

  dedup.sort((a, b) => a.at - b.at);
  return dedup.slice(0, limit);
}

let macroEventsCache = { at: 0, data: null };
/** @type {Promise<{ events: unknown[]; updatedAt: number }> | null} */
let macroEventsInflight = null;

export async function getMacroEventsCachedAsync() {
  const now = Date.now();
  if (macroEventsCache.data && now - macroEventsCache.at < 60_000) {
    return macroEventsCache.data;
  }
  if (macroEventsInflight) return macroEventsInflight;

  macroEventsInflight = (async () => {
    const events = getUpcomingMacroEvents();
    await enrichMacroEventsWithFinnhubConsensus(events).catch(() => {});
    const data = { events, updatedAt: Date.now() };
    macroEventsCache = { at: Date.now(), data };
    return data;
  })();

  try {
    return await macroEventsInflight;
  } finally {
    macroEventsInflight = null;
  }
}
