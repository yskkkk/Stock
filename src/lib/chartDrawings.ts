import type {
  IChartApi,
  IPriceLine,
  ISeriesApi,
  Logical,
  Time,
} from "lightweight-charts";
import { MismatchDirection } from "lightweight-charts";
import type { ChartTime } from "../types";

export type ChartDrawingId = string;

export function newChartDrawingId(): ChartDrawingId {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function timeSortKey(t: Time): number {
  if (typeof t === "number") return t;
  if (typeof t === "string") return Date.parse(t) / 1000 || 0;
  return Date.UTC(t.year, t.month - 1, t.day) / 1000;
}

/** 메인 패인에서 시간축 X가 의미 있는 구간(StockChart `MAIN_PRICE_STRIP_PX`와 동기) */
const RAY_PANE_TIME_X_MAX_INSET_PX = 92;

function timeMappedPaneWidthPx(paneWidth: number): number {
  return Math.max(32, paneWidth - RAY_PANE_TIME_X_MAX_INSET_PX);
}

/** 가격 눈금 스트립으로 들어간 끝점을 시간축 쪽으로 되돌려 refineTimeAtPaneX가 깨지지 않게 함 */
function clampRayFarPointToTimePlotX(
  axn: number,
  ayn: number,
  fx: number,
  fy: number,
  paneWidth: number,
): { x: number; y: number } {
  const xMax = Math.max(2, timeMappedPaneWidthPx(paneWidth) - 0.5);
  const xMin = 0.5;
  const dx = fx - axn;
  const dy = fy - ayn;
  if (Math.abs(dx) < 1e-9) {
    return { x: Math.max(xMin, Math.min(fx, xMax)), y: fy };
  }
  let rx = fx;
  let ry = fy;
  if (rx > xMax) {
    const u = (xMax - axn) / dx;
    if (Number.isFinite(u)) {
      rx = xMax;
      ry = ayn + u * dy;
    }
  } else if (rx < xMin) {
    const u = (xMin - axn) / dx;
    if (Number.isFinite(u)) {
      rx = xMin;
      ry = ayn + u * dy;
    }
  }
  return { x: rx, y: ry };
}

function avgBarTimeStepSec(
  candle: ISeriesApi<"Candlestick">,
  lastIdx: number,
): number {
  if (lastIdx < 1) return 86400;
  const b0 = candle.dataByIndex(lastIdx - 1, MismatchDirection.NearestLeft);
  const b1 = candle.dataByIndex(lastIdx, MismatchDirection.NearestLeft);
  if (!b0 || !b1) return 86400;
  const dt = timeSortKey(b1.time as Time) - timeSortKey(b0.time as Time);
  return Math.max(1, dt);
}

/**
 * 앵커·통과 시각만으로 logical 차이(시리즈 없이 스냅샷 복원·클립보드용 힌트).
 */
export function rayLogicalDeltaFromAnchorThroughTimes(
  chart: IChartApi,
  anchorTime: Time,
  throughTime: Time,
): number | null {
  const ts = chart.timeScale();
  const ia = ts.timeToIndex(anchorTime, true);
  const it = ts.timeToIndex(throughTime, true);
  if (ia != null && it != null) {
    const d = Number(it) - Number(ia);
    if (Math.abs(d) > 1e-6) return d;
  }
  return null;
}

/**
 * timeToIndex(through)가 막히거나 anchor와 같아져도, 통과 시각·가격으로
 * 논리 인덱스 차이를 복구해 광선이 오른쪽/왼쪽으로 이어지게 한다.
 */
export function rayLogicalHintFromStoredRay(
  chart: IChartApi,
  o: RayDrawingModel,
): number | null {
  const ts = chart.timeScale();
  const ia = ts.timeToIndex(o.anchorTime, true);
  const fromTimes = rayLogicalDeltaFromAnchorThroughTimes(
    chart,
    o.anchorTime,
    o.throughTime,
  );
  /** `computeRayLineEndpoints`는 through의 **절대** logical을 기대함 — di = hint - i1 */
  if (fromTimes != null && ia != null) {
    return (ia as number) + fromTimes;
  }
  const raw = o.series.data() as { time: Time }[];
  if (raw.length < 2) return null;
  const i0 = ts.timeToIndex(raw[0]!.time, true);
  const i1 = ts.timeToIndex(raw[1]!.time, true);
  if (i0 == null || i1 == null) return null;
  const span = Number(i1) - Number(i0);
  if (Math.abs(span) < 1e-6) return null;
  if (ia == null) return null;
  const mid = (Number(i0) + Number(i1)) / 2;
  const delta = Number(ia) <= mid ? span : -span;
  return (ia as number) + delta;
}

/**
 * `computeRayLineEndpoints`용 through 쪽 logical 힌트.
 * 저장된 Δ가 있으면 `anchorIndex + Δ`(데이터가 밀려도 방향 불변), 없으면 시리즈·시각 기반 복구.
 */
export function rayThroughLogicalHintForGeometry(
  chart: IChartApi,
  ray: RayDrawingModel,
): number | null {
  const ts = chart.timeScale();
  const ia = ts.timeToIndex(ray.anchorTime, true);
  if (
    ia != null &&
    ray.throughLogicalDelta != null &&
    Number.isFinite(ray.throughLogicalDelta) &&
    Math.abs(ray.throughLogicalDelta) > 1e-9
  ) {
    return (ia as number) + ray.throughLogicalDelta;
  }
  return rayLogicalHintFromStoredRay(chart, ray);
}

function resolveRayLogicalDelta(
  candle: ISeriesApi<"Candlestick">,
  anchorTime: Time,
  throughTime: Time,
  anchorValue: number,
  throughValue: number,
  i1: number,
  i2FromChart: number,
  lastIdx: number,
): number {
  let di = i2FromChart - i1;
  const tkA = timeSortKey(anchorTime);
  const tkT = timeSortKey(throughTime);
  const bLast = candle.dataByIndex(lastIdx, MismatchDirection.NearestLeft);
  const tkLast = bLast ? timeSortKey(bLast.time as Time) : tkA;

  let wantRight: boolean;
  if (tkT > tkA) wantRight = true;
  else if (tkT < tkA) wantRight = false;
  else wantRight = throughValue >= anchorValue;

  if (wantRight) {
    if (di > 1e-9) return di;
    if (tkT > tkLast) {
      const step = avgBarTimeStepSec(candle, lastIdx);
      const span = Math.max(2, Math.ceil((tkT - tkLast) / step));
      return Math.max(di, span + (lastIdx - i1));
    }
    return Math.max(1, lastIdx - i1 + 8);
  }
  if (di < -1e-9) return di;
  return Math.min(-1, -i1 - 1);
}

export interface HLineDrawingModel {
  kind: "hline";
  id: ChartDrawingId;
  priceLine: IPriceLine;
}

export interface RayDrawingModel {
  kind: "ray";
  id: ChartDrawingId;
  series: ISeriesApi<"Line">;
  /** 첫 클릭(광선 원점) */
  anchorTime: Time;
  anchorValue: number;
  /** 둘째 클릭(방향) */
  throughTime: Time;
  throughValue: number;
  /**
   * `timeToIndex(through) - timeToIndex(anchor)` — 줌·스크롤 후에도 동일 기하로 쓰기 위해 고정.
   * 없으면 스냅샷 이전 데이터에서 복구 시 `rayLogicalHintFromStoredRay`로 대체.
   */
  throughLogicalDelta?: number;
}

export type ChartDrawingModel = HLineDrawingModel | RayDrawingModel;

export type RayDraft = {
  time: Time;
  value: number;
  /** 첫 클릭 시 resolve와 동일한 가로 logical — timeToCoordinate와 혼용 시 생기는 십자선 오차 방지 */
  logical?: number;
};

export type ChartDrawingStore = {
  objects: ChartDrawingModel[];
  rayDraft: RayDraft | null;
};

/** 데이터 마지막 봉 이후 logical 인덱스에 대응하는 시간(광선·드래그용). */
export function extrapolateTimeBeyondLast(
  candle: ISeriesApi<"Candlestick">,
  lastIdx: number,
  logicalBeyond: number,
): Time | null {
  const steps = logicalBeyond - lastIdx;
  if (!(steps > 0)) return null;
  const bLast = candle.dataByIndex(lastIdx, MismatchDirection.NearestLeft);
  if (!bLast) return null;
  const tLast = bLast.time as Time;
  if (typeof tLast === "number" && Number.isFinite(tLast)) {
    const bPrev = candle.dataByIndex(Math.max(0, lastIdx - 1), MismatchDirection.NearestLeft);
    const dt =
      bPrev &&
      typeof (bPrev.time as Time) === "number" &&
      Number.isFinite(bPrev.time as number)
        ? (tLast as number) - (bPrev.time as number)
        : 86400;
    return (tLast as number) + Math.max(1, dt) * steps as unknown as Time;
  }
  if (tLast && typeof tLast === "object" && "year" in tLast) {
    const dayMs = 86400000;
    const bPrev = candle.dataByIndex(Math.max(0, lastIdx - 1), MismatchDirection.NearestLeft);
    const p = bPrev?.time;
    let dayStep = 1;
    if (p && typeof p === "object" && "year" in p) {
      dayStep = Math.max(
        1,
        Math.round(
          (Date.UTC(tLast.year, tLast.month - 1, tLast.day) -
            Date.UTC(p.year, p.month - 1, p.day)) /
            dayMs,
        ),
      );
    }
    const d = new Date(
      Date.UTC(tLast.year, tLast.month - 1, tLast.day) + dayMs * dayStep * steps,
    );
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  }
  /** 일부 데이터 소스는 `Time`을 문자열로 둠 — extrapolate 없으면 광선 끝이 잘림 */
  if (typeof tLast === "string") {
    const sec = Date.parse(tLast) / 1000;
    if (!Number.isFinite(sec)) return null;
    const bPrev = candle.dataByIndex(Math.max(0, lastIdx - 1), MismatchDirection.NearestLeft);
    const tp = bPrev?.time as Time | undefined;
    let dt = 86400;
    if (typeof tp === "number" && Number.isFinite(tp)) {
      dt = Math.max(1, sec - tp);
    } else if (typeof tp === "string") {
      const ps = Date.parse(tp) / 1000;
      if (Number.isFinite(ps)) dt = Math.max(1, sec - ps);
    }
    return (sec + dt * steps) as unknown as Time;
  }
  return null;
}

/**
 * logical 인덱스 → 캔들 데이터·오른쪽 빈 구간 `Time` (드로잉 resolve와 동일 규칙).
 */
export function logicalIndexToDataTime(
  candle: ISeriesApi<"Candlestick">,
  logical: number,
): Time | null {
  const n = candle.data().length;
  const lastIdx = n - 1;
  if (lastIdx < 0) return null;
  if (lastIdx === 0) {
    return logical > 1e-9
      ? extrapolateTimeBeyondLast(candle, 0, logical)
      : (candle.dataByIndex(0, MismatchDirection.NearestLeft)?.time as Time) ?? null;
  }

  if (logical >= lastIdx) {
    if (logical > lastIdx + 1e-9) {
      return extrapolateTimeBeyondLast(candle, lastIdx, logical);
    }
    const b = candle.dataByIndex(lastIdx, MismatchDirection.NearestLeft);
    return b ? (b.time as Time) : null;
  }

  const li = Math.min(lastIdx - 1, Math.max(0, Math.floor(logical)));
  const frac = logical - li;
  const b0 = candle.dataByIndex(li, MismatchDirection.NearestLeft);
  if (!b0) return null;
  if (frac < 1e-9) return b0.time as Time;
  const b1 = candle.dataByIndex(li + 1, MismatchDirection.NearestLeft);
  if (!b1) return b0.time as Time;
  const t0 = b0.time as Time;
  const t1 = b1.time as Time;
  if (
    typeof t0 === "number" &&
    typeof t1 === "number" &&
    Number.isFinite(t0) &&
    Number.isFinite(t1)
  ) {
    return (t0 + frac * (t1 - t0)) as unknown as Time;
  }
  return t0;
}

/** 메인 패인 로컬 X → logical (coordinateToLogical 실패 시 가시 범위로 선형 보간) */
export function logicalFromPaneX(chart: IChartApi, paneLocalX: number): number | null {
  const ts = chart.timeScale();
  const log = ts.coordinateToLogical(paneLocalX);
  if (log != null && Number.isFinite(log as number)) {
    return log as number;
  }
  const lr = ts.getVisibleLogicalRange();
  const el = chart.panes()[0]?.getHTMLElement();
  if (!lr || !el) return null;
  const w = el.getBoundingClientRect().width;
  if (!(w > 1e-6)) return null;
  const lo = Math.min(lr.from, lr.to);
  const hi = Math.max(lr.from, lr.to);
  return lo + (paneLocalX / w) * (hi - lo);
}

/**
 * 패인 로컬 X → logical. `coordinateToLogical`이 빈 오른쪽에서 마지막 봉에 붙는 경우가 있어,
 * 가시 logical 범위의 `logicalToCoordinate` 두 점으로 선형 사상(밖으로 extrapolate)한다.
 */
export function logicalFromPanePixelLinear(
  chart: IChartApi,
  paneLocalX: number,
): number | null {
  const ts = chart.timeScale();
  const lr = ts.getVisibleLogicalRange();
  const el = chart.panes()[0]?.getHTMLElement();
  if (!lr || !el) return null;
  const w = el.getBoundingClientRect().width;
  if (!(w > 1e-6)) return null;
  const lo = Math.min(lr.from, lr.to);
  const hi = Math.max(lr.from, lr.to);
  const xLo = ts.logicalToCoordinate(lo as Logical);
  const xHi = ts.logicalToCoordinate(hi as Logical);
  if (xLo == null || xHi == null) {
    return logicalFromPaneX(chart, paneLocalX);
  }
  const spanX = xHi - xLo;
  const spanL = hi - lo;
  if (Math.abs(spanX) < 1e-6) {
    return lo + (paneLocalX / w) * spanL;
  }
  return lo + ((paneLocalX - xLo) / spanX) * spanL;
}

/**
 * 패인 로컬 X에 대해 `timeToCoordinate(t) ≈ paneLocalX`가 되도록 logical을 보정한 뒤 `Time`을 반환.
 * 마우스·광선 끝이 십자선과 어긋나는 주된 원인은 time↔logical↔픽셀 혼선이므로 이 경로로 통일한다.
 */
export function refineTimeAtPaneX(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  paneLocalX: number,
): Time | null {
  const pw = chart.panes()[0]?.getHTMLElement()?.getBoundingClientRect().width ?? 0;
  const xCap = Math.max(2, timeMappedPaneWidthPx(pw) - 0.5);
  const xUse = Math.max(0.5, Math.min(paneLocalX, xCap));

  const ts = chart.timeScale();
  const tDirect = ts.coordinateToTime(xUse as number);
  if (tDirect != null) {
    const xc = ts.timeToCoordinate(tDirect);
    if (xc != null && Math.abs((xc as number) - xUse) < 1.25) {
      return tDirect as Time;
    }
  }

  let L =
    logicalFromPanePixelLinear(chart, xUse) ??
    (ts.coordinateToLogical(xUse as number) as number | null) ??
    logicalFromPaneX(chart, xUse);
  if (L == null || !Number.isFinite(L)) return null;

  const n = candle.data().length;
  const lastIdx = Math.max(0, n - 1);
  const loClamp = -400;
  const hiClamp = lastIdx + 2400;

  for (let iter = 0; iter < 56; iter++) {
    L = Math.max(loClamp, Math.min(hiClamp, L));
    const t = logicalIndexToDataTime(candle, L);
    if (t == null) return null;
    const x = ts.timeToCoordinate(t);
    if (x == null) return null;
    const err = xUse - (x as number);
    if (Math.abs(err) < 0.35) return t;

    const eps = Math.max(1e-4, Math.abs(L) * 1e-6 + 1e-3);
    const L2 = Math.max(loClamp, Math.min(hiClamp, L + eps));
    const t2 = logicalIndexToDataTime(candle, L2);
    if (t2 == null) return null;
    const x2 = ts.timeToCoordinate(t2);
    if (x2 == null) return null;
    const dxdL = ((x2 as number) - (x as number)) / eps;
    if (!Number.isFinite(dxdL) || Math.abs(dxdL) < 1e-12) {
      L += err > 0 ? 0.08 : -0.08;
      continue;
    }
    L += err / dxdL;
  }

  L = Math.max(loClamp, Math.min(hiClamp, L));
  return logicalIndexToDataTime(candle, L);
}

function paneXForRayAnchor(
  chart: IChartApi,
  anchorTime: Time,
  anchorLogical: number | null | undefined,
): number | null {
  const ts = chart.timeScale();
  if (anchorLogical != null && Number.isFinite(anchorLogical)) {
    const xL = ts.logicalToCoordinate(anchorLogical as Logical);
    if (xL != null) return xL as number;
  }
  const xT = ts.timeToCoordinate(anchorTime);
  return xT != null ? (xT as number) : null;
}

/** 패인 픽셀 → 시·가·logical (시간은 `refineTimeAtPaneX`로 픽셀 X와 정합). */
export function timePriceLogicalFromPanePixel(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  paneLocalX: number,
  paneLocalY: number,
): { time: Time; price: number; logical: number } | null {
  const ts = chart.timeScale();
  const price = candle.coordinateToPrice(paneLocalY);
  if (price == null || !Number.isFinite(price as number)) return null;

  const el = chart.panes()[0]?.getHTMLElement();
  const pw = el?.getBoundingClientRect().width ?? 0;
  const xCap = pw > 4 ? Math.max(2, timeMappedPaneWidthPx(pw) - 0.5) : paneLocalX;
  const xForLogical = Math.max(0.5, Math.min(paneLocalX, xCap));

  let logical: number | null = logicalFromPanePixelLinear(chart, xForLogical);
  if (logical == null || !Number.isFinite(logical)) {
    logical = ts.coordinateToLogical(xForLogical as number) as number | null;
  }
  if (logical == null || !Number.isFinite(logical)) {
    logical = logicalFromPaneX(chart, xForLogical);
  }
  if (logical == null || !Number.isFinite(logical)) return null;

  let t: Time | null = refineTimeAtPaneX(chart, candle, paneLocalX);
  if (t == null) {
    t = logicalIndexToDataTime(candle, logical as number);
  }
  if (t == null) return null;
  return { time: t, price: price as number, logical: logical as number };
}

/**
 * 광선: 앵커와 패인 포인터를 잇는 **픽셀 직선**을 끝까지 늘린 뒤 끝점만 (time, price)로 변환.
 * logical 힌트 기반 `computeRayLineEndpoints`보다 마우스 추적 오차가 적다.
 */
export function rayLineTwoPointsFromAnchorAndPanePixel(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  anchorTime: Time,
  anchorValue: number,
  paneLocalX: number,
  paneLocalY: number,
  anchorLogical?: number | null,
): Array<{ time: ChartTime; value: number }> | null {
  const ax = paneXForRayAnchor(chart, anchorTime, anchorLogical ?? null);
  const ay = candle.priceToCoordinate(anchorValue);
  if (ax == null || ay == null) return null;

  const el = chart.panes()[0]?.getHTMLElement();
  const rect = el?.getBoundingClientRect();
  const w = rect?.width ?? 0;
  const h = rect?.height ?? 0;
  if (!(w > 4 && h > 4)) return null;

  const axn = ax as number;
  const ayn = ay as number;
  const dpx = paneLocalX - axn;
  const dpy = paneLocalY - ayn;
  if (dpx * dpx + dpy * dpy < 1e-8) return null;

  const OV = 96;
  const plotW = timeMappedPaneWidthPx(w);
  let K = 1;
  let fx = axn + K * dpx;
  let fy = ayn + K * dpy;
  for (let i = 0; i < 48; i++) {
    if (fx < -OV || fx > plotW + OV || fy < -OV || fy > h + OV) break;
    K *= 1.42;
    fx = axn + K * dpx;
    fy = ayn + K * dpy;
    if (K > 1e7) break;
  }

  const hit = clampRayFarPointToTimePlotX(axn, ayn, fx, fy, w);
  const pFar = candle.coordinateToPrice(hit.y);
  if (pFar == null || !Number.isFinite(pFar as number)) return null;
  const tFar = refineTimeAtPaneX(chart, candle, hit.x);
  if (tFar == null) return null;

  const pA = { time: anchorTime as ChartTime, value: anchorValue };
  const pB = { time: tFar as ChartTime, value: pFar as number };
  return timeSortKey(pA.time as Time) <= timeSortKey(pB.time as Time) ? [pA, pB] : [pB, pA];
}

/** 저장된 앵커·통과점을 픽셀로 복원한 뒤 동일 규칙으로 광선 두 점.
 * 끝 시각이 `refineTimeAtPaneX`로 봉에 스냅되면 축소 시 같은 시각·다른 가격으로 세로 꺾임이 날 수 있어,
 * `refreshRaySeriesGeometry` 등에서는 `computeRayLineEndpoints(..., { viewportIndependentFar: true })`를 우선한다.
 */
export function rayLineTwoPointsFromStoredRayPixels(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  anchorTime: Time,
  anchorValue: number,
  throughTime: Time,
  throughValue: number,
): Array<{ time: ChartTime; value: number }> | null {
  const ax = chart.timeScale().timeToCoordinate(anchorTime);
  const ay = candle.priceToCoordinate(anchorValue);
  const ux = chart.timeScale().timeToCoordinate(throughTime);
  const uy = candle.priceToCoordinate(throughValue);
  if (ax == null || ay == null || ux == null || uy == null) return null;

  const el = chart.panes()[0]?.getHTMLElement();
  const rect = el?.getBoundingClientRect();
  const w = rect?.width ?? 0;
  const h = rect?.height ?? 0;
  if (!(w > 4 && h > 4)) return null;

  const axn = ax as number;
  const ayn = ay as number;
  const dpx = (ux as number) - axn;
  const dpy = (uy as number) - ayn;
  if (dpx * dpx + dpy * dpy < 1e-8) return null;

  const OV = 96;
  const plotW = timeMappedPaneWidthPx(w);
  let K = 1;
  let fx = axn + K * dpx;
  let fy = ayn + K * dpy;
  for (let i = 0; i < 48; i++) {
    if (fx < -OV || fx > plotW + OV || fy < -OV || fy > h + OV) break;
    K *= 1.42;
    fx = axn + K * dpx;
    fy = ayn + K * dpy;
    if (K > 1e7) break;
  }

  const hit = clampRayFarPointToTimePlotX(axn, ayn, fx, fy, w);
  const pFar = candle.coordinateToPrice(hit.y);
  if (pFar == null || !Number.isFinite(pFar as number)) return null;
  const tFar = refineTimeAtPaneX(chart, candle, hit.x);
  if (tFar == null) return null;

  const pA = { time: anchorTime as ChartTime, value: anchorValue };
  const pB = { time: tFar as ChartTime, value: pFar as number };
  return timeSortKey(pA.time as Time) <= timeSortKey(pB.time as Time) ? [pA, pB] : [pB, pA];
}

/**
 * 앵커를 지나 둘째 점 방향으로만 뻗는 광선을 LineSeries용 두 점으로 만든다.
 * 가로축은 logical index 기준 선형 보간(캔들 정렬과 일치).
 * 오른쪽(미래 방향)은 데이터 마지막 봉 이후로도 이어서 그린다.
 * @param throughLogicalHint 마우스 X의 logical — 빈 구간·같은 봉에서도 각도 복원
 * @param options.viewportIndependentFar true면 끝 logical/시간을 가시 범위·픽셀 재투영과 분리.
 *   **거의 수평(`di≈0`)** 포함 — 미래 빈 구간을 볼 때도 광선이 움직이지 않게 함.
 */
export type ComputeRayLineEndpointsOptions = {
  viewportIndependentFar?: boolean;
};

const RAY_VIEWPORT_INDEPENDENT_PAD = 8000;

export function computeRayLineEndpoints(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  anchorTime: Time,
  anchorValue: number,
  throughTime: Time,
  throughValue: number,
  throughLogicalHint?: number | null,
  options?: ComputeRayLineEndpointsOptions,
): Array<{ time: ChartTime; value: number }> | null {
  const data = candle.data();
  const n = data.length;
  if (n < 1) return null;

  const ts = chart.timeScale();
  const idx1 = ts.timeToIndex(anchorTime, true);
  if (idx1 == null) return null;
  const i1 = idx1 as number;
  const idx2 = ts.timeToIndex(throughTime, true);
  const i2FromChart = idx2 != null ? (idx2 as number) : i1;

  const lastIdx = n - 1;

  const usedThroughLogicalHint =
    throughLogicalHint != null &&
    Number.isFinite(throughLogicalHint) &&
    Math.abs(throughLogicalHint - i1) > 1e-6;

  let di: number;
  if (usedThroughLogicalHint) {
    di = (throughLogicalHint as number) - i1;
    /**
     * hint가 앵커에 너무 가까우면 di→0에 가까워져 (가격차)/(di)가 폭주하고 예비선이 수직으로 튄다.
     * hint를 쓸 때만 가격 변화가 의미 있으면 |di| 하한을 둔다.
     */
    const priceSpanAbs = Math.abs(throughValue - anchorValue);
    const priceNoise = Math.max(1e-12, Math.abs(anchorValue) * 1e-10);
    const MIN_ABS_DI = 0.1;
    if (priceSpanAbs > priceNoise && Math.abs(di) < MIN_ABS_DI && Math.abs(di) > 0) {
      di = Math.sign(di) * MIN_ABS_DI;
    }
  } else {
    di = resolveRayLogicalDelta(
      candle,
      anchorTime,
      throughTime,
      anchorValue,
      throughValue,
      i1,
      i2FromChart,
      lastIdx,
    );
  }
  const i2 = i1 + di;

  const useVi = options?.viewportIndependentFar === true;
  const lr = useVi ? null : ts.getVisibleLogicalRange();

  const valueAtLogical = (logicalFar: number): number => {
    if (Math.abs(di) < 1e-12) return anchorValue;
    return (
      anchorValue + ((throughValue - anchorValue) / di) * (logicalFar - i1)
    );
  };

  /** 데이터 범위 밖은 logical→시간 보간 없이 extrapolate만 사용(좌표 괴리 방지) */
  const timeAtLogical = (logicalFar: number): Time | null => {
    if (logicalFar <= lastIdx) {
      const barFar = candle.dataByIndex(
        Math.min(lastIdx, Math.max(0, Math.floor(logicalFar))),
        MismatchDirection.NearestLeft,
      );
      return barFar ? (barFar.time as Time) : null;
    }
    return extrapolateTimeBeyondLast(candle, lastIdx, logicalFar);
  };

  /** 타임스케일이 이해하는 시각(빈 오른쪽 구간 포함) — 먼 logical만 extrapolate하면 끊김 */
  const farTimeFromChartScale = (logicalTarget: number): Time | null => {
    const x = ts.logicalToCoordinate(logicalTarget as Logical);
    if (x == null) return null;
    const t = ts.coordinateToTime(x as number);
    return t != null ? (t as Time) : null;
  };

  const spanAbs = lr != null ? Math.max(12, Math.abs(lr.to - lr.from)) : 120;
  const visHi = lr != null ? Math.max(lr.from, lr.to) : lastIdx;
  const visLo = lr != null ? Math.min(lr.from, lr.to) : 0;
  const spanRef = useVi ? 96 : spanAbs;

  let logicalFar: number;
  if (di > 0) {
    if (useVi) {
      logicalFar =
        Math.max(i1, i2, lastIdx) + RAY_VIEWPORT_INDEPENDENT_PAD;
    } else {
      /** 가시 오른쪽 + 여유 — 광선이 화면 끝까지 길게 보이도록 logical 여유 확대 */
      logicalFar =
        Math.max(i1, i2, lastIdx, visHi) + Math.max(spanAbs * 8, 220);
      /** logical만 키우면 줌 상태에 따라 화면 픽셀 끝까지 안 닿을 수 있어, 패인 너비 기준으로 한 번 더 밀어줌 */
      const paneEl = chart.panes()[0]?.getHTMLElement();
      const w = paneEl?.getBoundingClientRect().width;
      if (typeof w === "number" && w > 1) {
        const logPast = logicalFromPaneX(chart, w + 200);
        if (logPast != null && Number.isFinite(logPast)) {
          logicalFar = Math.max(logicalFar, logPast);
        }
      }
    }
  } else if (di < 0) {
    if (useVi) {
      logicalFar = Math.min(i1, i2) - RAY_VIEWPORT_INDEPENDENT_PAD;
      if (!Number.isFinite(logicalFar) || logicalFar < 0) logicalFar = 0;
    } else {
      const visLeft = lr != null ? Math.min(i2, Math.ceil(visLo)) : i2;
      const cap = Math.min(visLeft, i1 - 1e-4);
      logicalFar = Math.max(0, cap);
      if (!(logicalFar < i1 - 1e-9)) {
        logicalFar = Math.max(0, i1 - Math.max(1, spanAbs * 0.35));
      }
    }
  } else {
    if (useVi) {
      logicalFar = Math.max(i1, lastIdx) + RAY_VIEWPORT_INDEPENDENT_PAD;
    } else {
      logicalFar =
        Math.max(i1, lastIdx, visHi) + Math.max(spanAbs * 8, 220);
      const paneEl = chart.panes()[0]?.getHTMLElement();
      const w = paneEl?.getBoundingClientRect().width;
      if (typeof w === "number" && w > 1) {
        const logPast = logicalFromPaneX(chart, w + 200);
        if (logPast != null && Number.isFinite(logPast)) {
          logicalFar = Math.max(logicalFar, logPast);
        }
      }
    }
  }

  let farTime: Time | null;
  if (useVi) {
    farTime = timeAtLogical(logicalFar);
    if (farTime == null) {
      farTime =
        farTimeFromChartScale(logicalFar) ??
        extrapolateTimeBeyondLast(candle, lastIdx, logicalFar);
    }
  } else {
    farTime =
      di >= 0 ? farTimeFromChartScale(logicalFar) : timeAtLogical(logicalFar);
    if (farTime == null) {
      farTime = timeAtLogical(logicalFar);
    }
  }
  if (farTime == null) return null;

  if (di >= 0 && timeSortKey(farTime as Time) <= timeSortKey(anchorTime)) {
    const bump = logicalFar + (useVi ? 128 : Math.max(48, spanAbs));
    farTime = useVi
      ? extrapolateTimeBeyondLast(candle, lastIdx, bump) ??
        farTimeFromChartScale(bump) ??
        timeAtLogical(bump)
      : farTimeFromChartScale(bump) ??
        extrapolateTimeBeyondLast(candle, lastIdx, bump);
  }
  if (farTime == null) return null;

  let vFar = valueAtLogical(logicalFar);
  let farTimeUse = farTime;

  /** lightweight-charts LineSeries는 시각이 동일하면 선이 안 그려짐 — logical을 살짝 밀어 구분 */
  const tkA = timeSortKey(anchorTime as Time);
  const tkF = timeSortKey(farTimeUse as Time);
  if (Math.abs(tkF - tkA) < 1e-6) {
    const nudge = di >= 0 ? Math.max(2, spanRef * 0.08) : -Math.max(2, spanRef * 0.08);
    const log2 = logicalFar + nudge;
    const ft2 =
      di >= 0
        ? useVi
          ? extrapolateTimeBeyondLast(candle, lastIdx, log2) ??
            farTimeFromChartScale(log2) ??
            timeAtLogical(log2)
          : farTimeFromChartScale(log2) ??
            extrapolateTimeBeyondLast(candle, lastIdx, log2)
        : timeAtLogical(log2);
    if (ft2 != null && Math.abs(timeSortKey(ft2 as Time) - tkA) >= 1e-6) {
      farTimeUse = ft2;
      vFar = valueAtLogical(log2);
    }
  }

  const pA = { time: anchorTime as ChartTime, value: anchorValue };
  const pB = { time: farTimeUse as ChartTime, value: vFar };
  return timeSortKey(pA.time as Time) <= timeSortKey(pB.time as Time) ? [pA, pB] : [pB, pA];
}

/** 선분 위로 점 정사영(메인 패인 로컬 px) */
export function projectPointOntoSegmentPx(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number } {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) return { x: x0, y: y0 };
  let u = ((px - x0) * vx + (py - y0) * vy) / len2;
  u = Math.max(0, Math.min(1, u));
  return { x: x0 + u * vx, y: y0 + u * vy };
}

/**
 * 실제로 그려진 광선 선분(series 두 점) 위에 앵커·through 핸들 좌표(패인 로컬 px).
 * 표시와 hitTest가 동일해야 두 번째 점만 드래그된다.
 */
export function rayHandlePanePositions(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  ray: RayDrawingModel,
): { ax: number; ay: number; tx: number; ty: number } | null {
  const data = ray.series.data() as { time: Time; value: number }[];
  if (data.length < 2) return null;
  const ts = chart.timeScale();
  const p0 = data[0]!;
  const p1 = data[1]!;
  const xa = ts.timeToCoordinate(p0.time);
  const ya = candle.priceToCoordinate(p0.value);
  const xb = ts.timeToCoordinate(p1.time);
  const yb = candle.priceToCoordinate(p1.value);
  if (xa == null || ya == null || xb == null || yb == null) return null;
  const xA = ts.timeToCoordinate(ray.anchorTime);
  const yA = candle.priceToCoordinate(ray.anchorValue);
  const xT = ts.timeToCoordinate(ray.throughTime);
  const yT = candle.priceToCoordinate(ray.throughValue);
  if (xA == null || yA == null || xT == null || yT == null) return null;
  const projA = projectPointOntoSegmentPx(
    xA as number,
    yA as number,
    xa as number,
    ya as number,
    xb as number,
    yb as number,
  );
  const projT = projectPointOntoSegmentPx(
    xT as number,
    yT as number,
    xa as number,
    ya as number,
    xb as number,
    yb as number,
  );
  return { ax: projA.x, ay: projA.y, tx: projT.x, ty: projT.y };
}
