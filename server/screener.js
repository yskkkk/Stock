import { SYMBOL_NOT_FOUND } from "./errors.js";
import { fetchScanCandles } from "./stock-data.js";
import { resolveDisplayName } from "./names-ko.js";
import { getActiveTechModelsSync } from "./picks-tech-models-store.js";
import { analyzeTechnicals, meetsTelegramNotifyScore } from "./technical.js";
import { onHighScorePickForLiveTrading } from "./live-trade-runner.js";
import { notifyHighScorePick } from "./telegram-notify.js";
import { recordPicksDailySnapshot } from "./picks-history-store.js";
import { readLastScanSnapshotSync, writeLastScanSnapshotSync } from "./picks-live-persist.js";
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

function symKey(symbol) {
  return String(symbol ?? "").trim().toUpperCase();
}

function pickKey(pick) {
  return `${symKey(pick.symbol)}:${String(pick.techModelId ?? "default").trim() || "default"}`;
}

/**
 * 스캔 진행 중 UI용 — 이전 목록 유지 + 이번에 새로 잡힌 후보만 추가·갱신.
 * (스킵만 된 심볼은 스캔 끝날 때까지 목록에서 내리지 않음 → 8분 동안 빈 목록 방지)
 * @param {object[]} prevList
 * @param {object[]} draftList
 */
function mergeLivePicksWhileRunning(prevList, draftList) {
  const map = new Map();
  for (const p of prevList) map.set(pickKey(p), p);
  for (const p of draftList) map.set(pickKey(p), p);
  return sortPicks([...map.values()]);
}

/**
 * 스캔 완료 후: 이번에 본 심볼은 draft만 반영(스킵=이탈·제거), 아직 큐에 없던 건 prev 유지.
 * @param {object[]} prevList
 * @param {object[]} draftList
 * @param {Set<string>} processed
 */
function finalizePicksAfterScan(prevList, draftList, processedSymbols) {
  /** @type {Map<string, object[]>} */
  const draftBySymbol = new Map();
  for (const p of draftList) {
    const sk = symKey(p.symbol);
    if (!draftBySymbol.has(sk)) draftBySymbol.set(sk, []);
    draftBySymbol.get(sk).push(p);
  }
  const out = [];
  for (const p of prevList) {
    if (!processedSymbols.has(symKey(p.symbol))) out.push(p);
  }
  for (const sk of processedSymbols) {
    const adds = draftBySymbol.get(sk);
    if (adds?.length) out.push(...adds);
  }
  return sortPicks(out);
}

async function screenSymbol(item, market) {
  try {
    const data = await fetchScanCandles(item.symbol);
    const models = getActiveTechModelsSync();
    if (!models.length) return { type: "skip" };

    /** @type {object[]} */
    const picks = [];
    for (const model of models) {
      const analysis = analyzeTechnicals(data.candles, model.weights);
      if (!analysis.buy) continue;
      const pick = {
        symbol: data.symbol,
        name: resolveDisplayName(data.symbol, item.name, data.quote.name),
        market,
        price: data.quote.price,
        change: data.quote.change,
        changePercent: data.quote.changePercent,
        currency: data.quote.currency,
        dayHigh: data.quote.dayHigh,
        dayLow: data.quote.dayLow,
        turnover: data.quote.turnover,
        score: analysis.score,
        signalIds: analysis.signalIds,
        signals: analysis.signals,
        marketState: data.quote.marketState,
        techModelId: model.id,
        techModelName: model.name,
        techModelWeights: model.weights,
      };
      picks.push(pick);
      if (meetsTelegramNotifyScore(pick.score, model.weights)) {
        notifyHighScorePick(pick);
        void onHighScorePickForLiveTrading(pick);
      }
    }
    if (!picks.length) return { type: "skip" };
    return { type: "picks", picks };
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

/**
 * @param {{ type: string; pick?: object; failure?: object }} result
 * @param {{ kr: object[]; us: object[] }} bucket
 */
function applyScreenResult(result, bucket) {
  if (result.type === "picks" && Array.isArray(result.picks)) {
    for (const pick of result.picks) {
      if (pick.market === "kr") bucket.kr.push(pick);
      else bucket.us.push(pick);
    }
    sortPicks(bucket.kr);
    sortPicks(bucket.us);
  } else if (result.type === "pick" && result.pick) {
    if (result.pick.market === "kr") bucket.kr.push(result.pick);
    else bucket.us.push(result.pick);
    sortPicks(bucket.kr);
    sortPicks(bucket.us);
    notifyHighScorePick(result.pick);
    void onHighScorePickForLiveTrading(result.pick);
  } else if (result.type === "error" && result.failure) {
    state.failedCount += 1;
    state.failures.push(result.failure);
  }
}

async function runScreening() {
  if (state.running) return screeningPromise;

  clearNextScanTimer();
  nextScanAt = null;

  const prevKr = [...state.kr];
  const prevUs = [...state.us];
  const prevFailures = [...state.failures];
  const prevUpdatedAt = state.updatedAt;

  state.running = true;
  state.startedAt = Date.now();
  state.failedCount = 0;
  state.failures = [];
  state.message = "시총 상위 종목 목록 불러오는 중…";
  state.progress = 0;

  const draft = { kr: [], us: [] };
  /** 이번 스캔에서 이미 처리한 심볼 (스킵·에러 포함) */
  const processedSymbols = new Set();

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
        for (const item of chunk) {
          processedSymbols.add(symKey(item.symbol));
        }
        for (let j = 0; j < results.length; j++) {
          applyScreenResult(results[j], draft);
        }
        state.progress += chunk.length;
        state.kr = mergeLivePicksWhileRunning(prevKr, draft.kr);
        state.us = mergeLivePicksWhileRunning(prevUs, draft.us);
        state.updatedAt = Date.now();
      }

      state.kr = finalizePicksAfterScan(prevKr, draft.kr, processedSymbols);
      state.us = finalizePicksAfterScan(prevUs, draft.us, processedSymbols);
      state.updatedAt = Date.now();
      recordPicksDailySnapshot([...state.kr], [...state.us], state.updatedAt);
      const failMsg =
        state.failedCount > 0 ? ` · 조회 실패 ${state.failedCount}건` : "";
      state.message = `분석 완료 · 매수 후보 ${state.kr.length + state.us.length}개${failMsg}`;
      writeLastScanSnapshotSync({
        kr: state.kr,
        us: state.us,
        updatedAt: state.updatedAt,
        message: state.message,
      });
    } catch (err) {
      state.kr = prevKr;
      state.us = prevUs;
      state.failures = prevFailures;
      state.failedCount = prevFailures.length;
      state.updatedAt = prevUpdatedAt;
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
  runScreening().catch(logScreeningError);
  return { ok: true, message: "전체 재분석을 시작했습니다." };
}

export function ensureScreening() {
  if (state.running) return;
  const stale =
    !state.updatedAt || Date.now() - state.updatedAt > screenIntervalMs();
  if (stale) {
    runScreening().catch(logScreeningError);
  }
}

const _snap = readLastScanSnapshotSync();
if (_snap && (_snap.kr.length > 0 || _snap.us.length > 0)) {
  state.kr = _snap.kr;
  state.us = _snap.us;
  if (_snap.updatedAt > 0) state.updatedAt = _snap.updatedAt;
  if (_snap.message) state.message = _snap.message;
}
