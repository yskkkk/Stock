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
 * timeToIndex(through)가 막히거나 anchor와 같아져도, 통과 시각·가격으로
 * 논리 인덱스 차이를 복구해 광선이 오른쪽/왼쪽으로 이어지게 한다.
 */
export function rayLogicalHintFromStoredRay(
  chart: IChartApi,
  o: RayDrawingModel,
): number | null {
  const ts = chart.timeScale();
  const ia = ts.timeToIndex(o.anchorTime, true);
  const it = ts.timeToIndex(o.throughTime, true);
  if (ia != null && it != null) {
    const d = Number(it) - Number(ia);
    if (Math.abs(d) > 1e-6) return d;
  }
  const raw = o.series.data() as { time: Time }[];
  if (raw.length < 2) return null;
  const i0 = ts.timeToIndex(raw[0]!.time, true);
  const i1 = ts.timeToIndex(raw[1]!.time, true);
  if (i0 == null || i1 == null) return null;
  const span = Number(i1) - Number(i0);
  if (Math.abs(span) < 1e-6) return null;
  if (ia == null) return span;
  const mid = (Number(i0) + Number(i1)) / 2;
  return Number(ia) <= mid ? span : -span;
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
}

export type ChartDrawingModel = HLineDrawingModel | RayDrawingModel;

export type RayDraft = { time: Time; value: number };

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
 * 앵커를 지나 둘째 점 방향으로만 뻗는 광선을 LineSeries용 두 점으로 만든다.
 * 가로축은 logical index 기준 선형 보간(캔들 정렬과 일치).
 * 오른쪽(미래 방향)은 데이터 마지막 봉 이후로도 이어서 그린다.
 * @param throughLogicalHint 마우스 X의 logical — 빈 구간·같은 봉에서도 각도 복원
 */
export function computeRayLineEndpoints(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  anchorTime: Time,
  anchorValue: number,
  throughTime: Time,
  throughValue: number,
  throughLogicalHint?: number | null,
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

  const lr = ts.getVisibleLogicalRange();
  const lastIdx = n - 1;

  let di: number;
  if (
    throughLogicalHint != null &&
    Number.isFinite(throughLogicalHint) &&
    Math.abs(throughLogicalHint - i1) > 1e-6
  ) {
    di = throughLogicalHint - i1;
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

  let logicalFar: number;
  if (di > 0) {
    /** 가시 오른쪽 + 여유(너무 먼 logical은 부동소수·스케일에서 깨져 중간에 끊김) */
    logicalFar =
      Math.max(i1, i2, lastIdx, visHi) + Math.max(spanAbs * 3.5, 120);
  } else if (di < 0) {
    const visLeft = lr != null ? Math.min(i2, Math.ceil(visLo)) : i2;
    const cap = Math.min(visLeft, i1 - 1e-4);
    logicalFar = Math.max(0, cap);
    if (!(logicalFar < i1 - 1e-9)) {
      logicalFar = Math.max(0, i1 - Math.max(1, spanAbs * 0.35));
    }
  } else {
    logicalFar =
      Math.max(i1, lastIdx, visHi) + Math.max(spanAbs * 3.5, 120);
  }

  let farTime: Time | null =
    di >= 0 ? farTimeFromChartScale(logicalFar) : timeAtLogical(logicalFar);
  if (farTime == null) {
    farTime = timeAtLogical(logicalFar);
  }
  if (farTime == null) return null;

  if (di > 0 && timeSortKey(farTime as Time) <= timeSortKey(anchorTime)) {
    const bump = logicalFar + Math.max(48, spanAbs);
    farTime =
      farTimeFromChartScale(bump) ?? extrapolateTimeBeyondLast(candle, lastIdx, bump);
  }
  if (farTime == null) return null;

  let vFar = valueAtLogical(logicalFar);
  let farTimeUse = farTime;

  /** lightweight-charts LineSeries는 시각이 동일하면 선이 안 그려짐 — logical을 살짝 밀어 구분 */
  const tkA = timeSortKey(anchorTime as Time);
  const tkF = timeSortKey(farTimeUse as Time);
  if (Math.abs(tkF - tkA) < 1e-6) {
    const nudge = di >= 0 ? Math.max(2, spanAbs * 0.08) : -Math.max(2, spanAbs * 0.08);
    const log2 = logicalFar + nudge;
    const ft2 =
      di >= 0
        ? farTimeFromChartScale(log2) ??
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
