/**
 * 박스권 카탈로그 스캔 세션 게이팅 (사용자 요청)
 *
 * - 장이 열려 있는 동안(실시간 시세)에는 자동 카탈로그 탐지를 반복하지 않는다.
 *   단일 종목 매매는 러너가 카탈로그 박스(예전 기준) + 실시간 가격 근접으로 처리한다.
 * - 장이 끝나면(정규+시간외 종료) 그 세션에 대해 종합 스캔을 **1회만** 수행한다.
 * - 이미 스캔한 세션은 다시 돌지 않는다(주말·휴장 중 반복 금지).
 * - 상태(마지막 스캔 세션)가 없으면 최초 1회 부트스트랩 스캔으로 카탈로그를 채운다.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveServerDataDir } from "../data-path.js";
import { isStockTradableBySchedule } from "../market-hours.js";
import {
  getKstParts,
  isKrBusinessDay,
  isKrWeekend,
  previousKrBusinessDay,
  shiftDateKey,
} from "../kr-business-day.js";

/** KR 시간외 종료 18:00 KST · US 애프터 종료 20:00 ET (market-hours.js 와 동일) */
const KR_TRADABLE_END = 18 * 60;
const US_TRADABLE_END = 20 * 60;

function statePath() {
  return path.join(resolveServerDataDir(), "box-range-catalog-scan-schedule.json");
}

function readStateSync() {
  try {
    const fp = statePath();
    if (!fs.existsSync(fp)) return {};
    const o = JSON.parse(fs.readFileSync(fp, "utf8"));
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function writeStateSync(state) {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = statePath();
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, fp);
}

/** @param {Date} now */
function etParts(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minutesOfDay: hour * 60 + minute,
  };
}

/** @param {string} dateKey */
function previousUsBusinessDay(dateKey) {
  let cur = shiftDateKey(dateKey, -1);
  for (let i = 0; i < 10; i++) {
    if (!isKrWeekend(cur)) return cur;
    cur = shiftDateKey(cur, -1);
  }
  return cur;
}

/**
 * 가장 최근에 **완료된** 거래 세션 날짜(시장 현지 달력일).
 * @param {"kr"|"us"} market
 * @param {Date} now
 */
export function finishedSessionKey(market, now = new Date()) {
  if (market === "kr") {
    const kst = getKstParts(now);
    if (isKrBusinessDay(kst.dateKey) && kst.minutesOfDay >= KR_TRADABLE_END) {
      return kst.dateKey;
    }
    return previousKrBusinessDay(kst.dateKey);
  }
  const et = etParts(now);
  if (!isKrWeekend(et.dateKey) && et.minutesOfDay >= US_TRADABLE_END) {
    return et.dateKey;
  }
  return previousUsBusinessDay(et.dateKey);
}

/** @param {"kr"|"us"} market @param {Date} now */
function isMarketClosedForScan(market, now = new Date()) {
  return !isStockTradableBySchedule(market, now);
}

/**
 * 지금 이 시장의 카탈로그 스캔을 돌려야 하는가?
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 * @returns {{ run: boolean; reason: string; sessionKey: string }}
 */
export function shouldRunCatalogScan(market, now = new Date()) {
  const state = readStateSync();
  const rec = state[market] ?? {};
  const sessionKey = finishedSessionKey(market, now);

  if (!rec.lastSessionKey) {
    return { run: true, reason: "bootstrap", sessionKey };
  }
  if (!isMarketClosedForScan(market, now)) {
    return { run: false, reason: "market-open-use-baseline", sessionKey };
  }
  if (rec.lastSessionKey === sessionKey) {
    return { run: false, reason: "session-already-scanned", sessionKey };
  }
  return { run: true, reason: "post-close", sessionKey };
}

/**
 * 스캔 완료 기록 — 이 세션은 다시 돌지 않는다.
 * @param {"kr"|"us"} market
 * @param {string} sessionKey
 */
export function markCatalogScanRan(market, sessionKey) {
  const state = readStateSync();
  state[market] = { lastSessionKey: sessionKey, lastRunAtMs: Date.now() };
  writeStateSync(state);
}

export function readCatalogScanScheduleStateSync() {
  return readStateSync();
}
