import { SYMBOL_NOT_FOUND } from "./errors.js";
import { fetchScanCandles } from "./stock-data.js";
import { resolveDisplayName } from "./names-ko.js";
import { analyzeTechnicals } from "./technical.js";
import { notifyHighScorePick } from "./telegram-notify.js";
import { loadUniverse } from "./universe.js";
import { clearYahooSession, getYahooSession } from "./yahoo.js";

function screenConcurrency() {
  const n = Number(process.env.SCREEN_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.min(10, Math.floor(n)) : 6;
}

const DEFAULT_SCREEN_INTERVAL_MS = 60_000;

function screenIntervalMs() {
  const n = Number(process.env.SCREEN_INTERVAL_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_SCREEN_INTERVAL_MS;
}

let state = {
  running: false,
  progress: 0,
  total: 0,
  failedCount: 0,
  failures: [],
  startedAt: null,
  kr: [],
  us: [],
  updatedAt: null,
  message: "분석 준비 중…",
};

let screeningPromise = null;
let nextScanTimer = null;
/** @type {number | null} 다음 자동 재스캔 예정 시각 (ms) */
let nextScanAt = null;

function clearNextScanTimer() {
  if (nextScanTimer) {
    clearTimeout(nextScanTimer);
    nextScanTimer = null;
  }
}

function logScreeningError(err) {
  console.warn(
    "[screener]",
    err instanceof Error ? err.message : err,
  );
}

function scheduleNextScan() {
  clearNextScanTimer();
  const interval = screenIntervalMs();
  nextScanAt = Date.now() + interval;
  nextScanTimer = setTimeout(() => {
    nextScanAt = null;
    if (!state.running) runScreening().catch(logScreeningError);
  }, interval);
}

export function getPicksState() {
  const etaSeconds = computeEtaSeconds();
  return {
    ...state,
    kr: [...state.kr],
    us: [...state.us],
    failures: [...state.failures],
    etaSeconds,
    nextScanAt,
    scanIntervalMs: screenIntervalMs(),
  };
}

function formatScreenError(err) {
  if (err?.code === "RATE_LIMIT") {
    return "Yahoo 요청 한도 초과 (잠시 후 다시 시도)";
  }
  if (err?.code === SYMBOL_NOT_FOUND) {
    const msg = err instanceof Error ? err.message : "";
    if (/delisted/i.test(msg)) return "상장폐지 또는 차트 데이터 없음";
    return msg || "차트 데이터 없음";
  }
  if (err instanceof Error) {
    if (/rate|too many/i.test(err.message)) return "요청 한도 초과";
    if (/parse|session/i.test(err.message)) return "Yahoo 응답 오류";
    return err.message.slice(0, 160);
  }
  return "알 수 없는 오류";
}

function computeEtaSeconds() {
  if (!state.running || !state.startedAt || state.progress <= 0) return null;
  const elapsed = (Date.now() - state.startedAt) / 1000;
  const perItem = elapsed / state.progress;
  const remaining = state.total - state.progress;
  return Math.max(0, Math.round(perItem * remaining));
}

function sortPicks(list) {
  return list.sort(
    (a, b) => b.score - a.score || (b.changePercent ?? 0) - (a.changePercent ?? 0),
  );
}

async function screenSymbol(item, market) {
  try {
    const data = await fetchScanCandles(item.symbol);
    const analysis = analyzeTechnicals(data.candles);
    if (!analysis.buy) return { type: "skip" };

    return {
      type: "pick",
      pick: {
        symbol: data.symbol,
        name: resolveDisplayName(data.symbol, item.name, data.quote.name),
        market,
        price: data.quote.price,
        change: data.quote.change,
        changePercent: data.quote.changePercent,
        currency: data.quote.currency,
        score: analysis.score,
        signalIds: analysis.signalIds,
        signals: analysis.signals,
        marketState: data.quote.marketState,
      },
    };
  } catch (err) {
    if (err?.code === "RATE_LIMIT") clearYahooSession();
    return {
      type: "error",
      failure: {
        symbol: String(item.symbol ?? "").toUpperCase(),
        name: item.name ?? item.symbol,
        market,
        reason: formatScreenError(err),
      },
    };
  }
}

function applyScreenResult(result) {
  if (result.type === "pick") {
    if (result.pick.market === "kr") state.kr.push(result.pick);
    else state.us.push(result.pick);
    sortPicks(state.kr);
    sortPicks(state.us);
    notifyHighScorePick(result.pick);
  } else if (result.type === "error" && result.failure) {
    state.failedCount += 1;
    state.failures.push(result.failure);
  }
}

async function runScreening() {
  if (state.running) return screeningPromise;

  clearNextScanTimer();
  nextScanAt = null;

  state.running = true;
  state.startedAt = Date.now();
  state.failedCount = 0;
  state.failures = [];
  state.message = "시총 상위 종목 목록 불러오는 중…";
  state.progress = 0;
  state.kr = [];
  state.us = [];

  screeningPromise = (async () => {
    try {
      await getYahooSession();
      const universe = await loadUniverse();
      const queue = [
        ...universe.kr.map((s) => ({ ...s, market: "kr" })),
        ...universe.us.map((s) => ({ ...s, market: "us" })),
      ];
      state.total = queue.length;
      state.message = `${state.total}개 종목 기술적 분석 중…`;

      const batchSize = screenConcurrency();
      for (let i = 0; i < queue.length; i += batchSize) {
        const chunk = queue.slice(i, i + batchSize);
        const results = await Promise.all(
          chunk.map((item) => screenSymbol(item, item.market)),
        );
        for (let j = 0; j < results.length; j++) {
          applyScreenResult(results[j]);
        }
        state.progress += chunk.length;
      }

      state.updatedAt = Date.now();
      const failMsg =
        state.failedCount > 0 ? ` · 조회 실패 ${state.failedCount}건` : "";
      state.message = `분석 완료 · 매수 후보 ${state.kr.length + state.us.length}개${failMsg}`;
    } catch (err) {
      state.message =
        err instanceof Error ? err.message : "분석 중 오류가 발생했습니다.";
    } finally {
      state.running = false;
      state.startedAt = null;
      screeningPromise = null;
      scheduleNextScan();
    }
  })();

  return screeningPromise;
}

export function startScreening() {
  if (!screeningPromise) return runScreening().catch(logScreeningError);
  return screeningPromise;
}

export function forceRescreen() {
  if (state.running) {
    return { ok: false, message: "이미 분석이 진행 중입니다." };
  }
  clearNextScanTimer();
  nextScanAt = null;
  state.updatedAt = null;
  state.total = 0;
  runScreening().catch(logScreeningError);
  return { ok: true, message: "전체 재분석을 시작했습니다." };
}

export function ensureScreening() {
  const stale =
    !state.updatedAt || Date.now() - state.updatedAt > screenIntervalMs();
  if (!state.running && (stale || state.total === 0)) {
    runScreening().catch(logScreeningError);
  }
}
