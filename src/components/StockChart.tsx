import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  MismatchDirection,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeIchimokuLines,
  buildIchimokuCloudBarsFromSpans,
  computeMaLines,
  computeMaLinesFromDaily,
  computeRsiLine,
} from "../lib/indicators";
import {
  getChartDrawingSnapshotForFit,
  drawingStorageKeyFromFitKey,
  persistChartDrawingSnapshot,
  type ChartDrawingSnapshotV1,
} from "../lib/userPersist";
import type { ChartDrawMode, ChartDrawToolbarApi } from "../chartDrawTypes";
import { ko } from "../i18n/ko";
import type { Candle, ChartTime } from "../types";
import {
  computeRayLineEndpoints,
  extrapolateTimeBeyondLast,
  logicalFromPaneX,
  newChartDrawingId,
  rayHandlePanePositions,
  rayLogicalHintFromStoredRay,
  type ChartDrawingModel,
  type ChartDrawingStore,
  type RayDraft,
  type RayDrawingModel,
} from "../lib/chartDrawings";
import { hitTestDrawings, type DrawingHitTarget } from "../lib/chartDrawingHitTest";
import ChartDrawToolbarButtons from "./ChartDrawToolbarButtons";

const KST = "Asia/Seoul";

const DRAW_HLINE_REST = {
  color: "rgba(94, 234, 212, 0.9)",
  lineWidth: 1 as const,
};
/** 보색(청록 ↔ 코랄) — 호버 강조 */
const DRAW_HLINE_HOVER = {
  color: "rgba(234, 94, 122, 0.98)",
  lineWidth: 2 as const,
};
const DRAW_RAY_REST = {
  color: "rgba(251, 191, 36, 0.92)",
  lineWidth: 2 as const,
};
/** 보색(앰버 ↔ 쿨 블루) */
const DRAW_RAY_HOVER = {
  color: "rgba(96, 165, 250, 0.98)",
  lineWidth: 2 as const,
};
const DRAW_RAY_PREVIEW = "rgba(251, 191, 36, 0.55)";

const DRAW_HLINE_PREVIEW = {
  color: "rgba(251, 191, 36, 0.5)",
  lineWidth: 1 as const,
  lineStyle: LineStyle.Dashed,
  axisLabelVisible: true,
  title: "",
};

function findDrawingById(
  acc: ChartDrawingStore,
  id: string,
): ChartDrawingModel | undefined {
  return acc.objects.find((x) => x.id === id);
}

function applyDrawingHoverStyle(o: ChartDrawingModel): void {
  if (o.kind === "hline") {
    o.priceLine.applyOptions(DRAW_HLINE_HOVER);
  } else {
    o.series.applyOptions(DRAW_RAY_HOVER);
  }
}

function restoreDrawingRestStyle(o: ChartDrawingModel): void {
  if (o.kind === "hline") {
    o.priceLine.applyOptions(DRAW_HLINE_REST);
  } else {
    o.series.applyOptions(DRAW_RAY_REST);
  }
}

export interface ChartOverlays {
  ma: boolean;
  ichimoku: boolean;
  volume: boolean;
  rsi: boolean;
}

interface StockChartProps {
  candles: Candle[];
  /** 있으면 이평선은 일봉 기준(20·50일)으로 표시 */
  dailyCandles?: Candle[];
  fitKey: string;
  interval?: string;
  overlays: ChartOverlays;
  /** 수평선·광선 등 간단 드로잉(TradingView 수준은 아님) */
  drawingsEnabled?: boolean;
  /** 상위 툴바와 모드 동기화 시 둘 다 전달 */
  chartDrawMode?: ChartDrawMode;
  onChartDrawModeChange?: (m: ChartDrawMode) => void;
  /** false면 내장 드로잉 버튼 숨김(상위 툴바 사용) */
  showBuiltInDrawToolbar?: boolean;
  registerDrawApi?: (api: ChartDrawToolbarApi | null) => void;
  /** true면 드로잉 클릭을 커서 아래 봉의 시·고·저·종 근처로 스냅 */
  chartDrawMagnet?: boolean;
  onChartDrawMagnetChange?: (next: boolean) => void;
  /** 수익 모델 매수 시점·가격 마커(없으면 표시 안 함) */
  profitMarker?: { time: ChartTime; price: number } | null;
}

function disposeChartDrawingModel(
  b: ChartSeriesBundle,
  o: ChartDrawingModel,
): void {
  if (o.kind === "hline") {
    try {
      b.candle.removePriceLine(o.priceLine);
    } catch {
      /* stale ref */
    }
    return;
  }
  try {
    b.chart.removeSeries(o.series);
  } catch {
    /* stale ref */
  }
}

function toSeriesTime(t: ChartTime): Time {
  return t as Time;
}

function toLineData(
  points: { time: ChartTime; value: number }[],
): LineData<Time>[] {
  return points.map((p) => ({
    time: toSeriesTime(p.time),
    value: p.value,
  }));
}

function isIntradayInterval(interval: string) {
  return !["1d", "1wk", "1mo"].includes(interval);
}

function formatChartTime(time: Time, intraday: boolean): string {
  if (typeof time === "number") {
    return new Date(time * 1000).toLocaleString("ko-KR", {
      timeZone: KST,
      ...(intraday
        ? {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }
        : {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
    });
  }
  if (typeof time === "string") return time;
  return `${time.year}.${String(time.month).padStart(2, "0")}.${String(time.day).padStart(2, "0")}`;
}

function candleBarData(candles: Candle[]) {
  return candles.map((c) => ({
    time: toSeriesTime(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function ichimokuCloudBarData(cloudBars: Candle[]) {
  return cloudBars.map((c) => ({
    time: toSeriesTime(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function volumeBarData(candles: Candle[]) {
  return candles.map((c) => ({
    time: toSeriesTime(c.time),
    value: c.volume ?? 0,
    color:
      c.close >= c.open
        ? "rgba(34, 197, 94, 0.45)"
        : "rgba(239, 68, 68, 0.45)",
  }));
}

/** 메인 패인 오른쪽 가격 눈금(세로 휠 구역) 폭 — 히트 테스트용 */
const MAIN_PRICE_STRIP_PX = 92;

function isMainPanePriceStripHit(
  clientX: number,
  clientY: number,
  chart: IChartApi,
): boolean {
  const mainEl = chart.panes()[0]?.getHTMLElement();
  if (!mainEl) return false;
  const r = mainEl.getBoundingClientRect();
  if (clientY < r.top || clientY > r.bottom) return false;
  if (clientX < r.left || clientX > r.right) return false;
  const xIn = clientX - r.left;
  return xIn >= r.width - MAIN_PRICE_STRIP_PX;
}

/** 메인 패인 기준 Y → 가격 (휠 앵커) */
function anchorPriceAtClientY(
  candle: ISeriesApi<"Candlestick">,
  chart: IChartApi,
  clientY: number,
  rangeFrom: number,
  rangeTo: number,
): number {
  const mainEl = chart.panes()[0]?.getHTMLElement();
  if (!mainEl) return (rangeFrom + rangeTo) / 2;
  const y = clientY - mainEl.getBoundingClientRect().top;
  const p = candle.coordinateToPrice(y);
  if (p == null || !Number.isFinite(p as number)) {
    return (rangeFrom + rangeTo) / 2;
  }
  const anchor = p as number;
  const lo = Math.min(rangeFrom, rangeTo);
  const hi = Math.max(rangeFrom, rangeTo);
  return Math.max(lo, Math.min(hi, anchor));
}

/** 클라이언트 좌표가 속한 패인 인덱스 */
function hitPaneIndexAtClient(
  chart: IChartApi,
  clientX: number,
  clientY: number,
): number {
  const panes = chart.panes();
  for (let i = 0; i < panes.length; i++) {
    const el = panes[i]!.getHTMLElement();
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    ) {
      return i;
    }
  }
  return 0;
}

function paneIndexOfSeries(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
): number | null {
  for (const p of chart.panes()) {
    for (const s of p.getSeries()) {
      if (s === series) return p.paneIndex();
    }
  }
  return null;
}

/**
 * RSI·거래량 등 서브 패인 — 해당 시리즈 가격축만 확대/축소 (메인 캔들·타임스케일과 분리)
 */
function zoomOverlayPriceScale(
  series: ISeriesApi<SeriesType>,
  paneEl: HTMLElement,
  clientY: number,
  deltaY: number,
  opts?: { clampMin?: number; clampMax?: number; minSpan?: number },
) {
  const ps = series.priceScale();
  const range = ps.getVisibleRange();
  if (!range) return;
  const from = range.from as number;
  const to = range.to as number;
  if (!(Number.isFinite(from) && Number.isFinite(to))) return;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const span = hi - lo;
  if (!(span > 0)) return;

  const zoomIn = deltaY < 0;
  const newSpanRaw = span * (zoomIn ? 0.92 : 1.08);
  const minSpan = opts?.minSpan ?? Math.max(span * 0.06, 1e-12);
  const newSpan = Math.max(minSpan, newSpanRaw);

  const pr = paneEl.getBoundingClientRect();
  const localY = clientY - pr.top;
  const rawAnchor = series.coordinateToPrice(localY);
  const anchor =
    rawAnchor != null && Number.isFinite(rawAnchor as number)
      ? (rawAnchor as number)
      : (lo + hi) / 2;
  const t = (anchor - lo) / span;
  let newLo = anchor - t * newSpan;
  let newHi = newLo + newSpan;

  const cmin = opts?.clampMin;
  const cmax = opts?.clampMax;
  if (cmin != null) newLo = Math.max(cmin, newLo);
  if (cmax != null) newHi = Math.min(cmax, newHi);
  if (newHi - newLo < minSpan) {
    const mid = (newLo + newHi) / 2;
    newLo = mid - minSpan / 2;
    newHi = mid + minSpan / 2;
    if (cmin != null) newLo = Math.max(cmin, newLo);
    if (cmax != null) newHi = Math.min(cmax, newHi);
  }

  ps.applyOptions({ autoScale: false });
  ps.setVisibleRange({ from: newLo, to: newHi });
}

/** 차트 메인 패인 기준 X(픽셀) — timeScale·timeToCoordinate와 동일 좌표계 */
function mainPaneLocalX(clientX: number, chart: IChartApi): number | null {
  const pane0 = chart.panes()[0]?.getHTMLElement();
  if (!pane0) return null;
  return clientX - pane0.getBoundingClientRect().left;
}

/** 차트 메인 패인 기준 X → logical (휠 줌 앵커). 보이는 범위 밖·빈 오른쪽도 그대로 반환 */
function anchorLogicalUnderMouse(chart: IChartApi, clientX: number): number | null {
  const x = mainPaneLocalX(clientX, chart);
  if (x == null) return null;
  const log = chart.timeScale().coordinateToLogical(x);
  if (log == null || !Number.isFinite(log as number)) return null;
  return log as number;
}

/** 휠 앵커용 폴백: 보이는 범위 중앙 */
function anchorLogicalFallback(
  chart: IChartApi,
  clientX: number,
  lr: { from: number; to: number },
): number {
  const direct = anchorLogicalUnderMouse(chart, clientX);
  if (direct != null) return direct;
  return (lr.from + lr.to) / 2;
}

/** 마우스 X의 logical → 캔들 데이터 범위·오른쪽 빈 구간까지 일관된 Time */
function logicalToDataTime(
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

/** 드로잉용: 브라우저 좌표 → 시각·가격·logical (coordinateToTime 금지 — 빈 오른쪽이 마지막 봉으로 붙는 문제 방지) */
function resolveDrawPointFromClient(
  clientX: number,
  clientY: number,
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
): { time: Time; price: number; logical: number } | null {
  if (hitPaneIndexAtClient(chart, clientX, clientY) !== 0) return null;
  if (isMainPanePriceStripHit(clientX, clientY, chart)) return null;
  const pane0 = chart.panes()[0]?.getHTMLElement();
  if (!pane0) return null;
  const pr = pane0.getBoundingClientRect();
  if (
    clientX < pr.left ||
    clientX > pr.right ||
    clientY < pr.top ||
    clientY > pr.bottom
  ) {
    return null;
  }
  const x = clientX - pr.left;
  const localY = clientY - pr.top;
  const price = candle.coordinateToPrice(localY);
  if (price == null || !Number.isFinite(price as number)) return null;

  const ts = chart.timeScale();
  let logical: number | null = ts.coordinateToLogical(x) as number | null;
  if (logical == null || !Number.isFinite(logical)) {
    logical = logicalFromPaneX(chart, x);
  }
  if (logical == null || !Number.isFinite(logical)) return null;

  const time = logicalToDataTime(candle, logical);
  if (time == null) return null;
  return { time, price: price as number, logical };
}

/** 광선 2단계 미리보기: 연장 끝이 아니라 앵커—현재 포인터(마우스) 직선으로 그려 크로스헤어와 맞춤 */
function rayPreviewChordFromDraftAndPointer(
  candle: ISeriesApi<"Candlestick">,
  draft: RayDraft,
  pointer: { time: Time; price: number; logical: number },
): { time: ChartTime; value: number }[] {
  const sk = (t: Time): number => {
    if (typeof t === "number") return t;
    if (typeof t === "string") return Date.parse(t) / 1000 || 0;
    return Date.UTC(t.year, t.month - 1, t.day) / 1000;
  };

  let tA = draft.time as Time;
  let vA = draft.value;
  let tB = pointer.time;
  const vB = pointer.price;

  if (Math.abs(sk(tA) - sk(tB)) < 1e-6) {
    const lastIdx = candle.data().length - 1;
    if (lastIdx >= 0) {
      const nudged =
        logicalToDataTime(candle, pointer.logical + 0.35) ??
        extrapolateTimeBeyondLast(candle, lastIdx, pointer.logical + 0.5);
      if (nudged != null) tB = nudged;
    }
    if (Math.abs(sk(tA) - sk(tB)) < 1e-6 && typeof tB === "number" && Number.isFinite(tB)) {
      tB = (tB + 0.001) as unknown as Time;
    }
  }

  const pAnchor = { time: tA as ChartTime, value: vA };
  const pPtr = { time: tB as ChartTime, value: vB };
  return sk(tA) <= sk(tB) ? [pAnchor, pPtr] : [pPtr, pAnchor];
}

const MAGNET_OHLC_PX = 96;

/**
 * 마그넷: 가까운 봉의 시·고·저·종 중 화면상 커서와 픽셀 거리가 가장 가까운 점(몸통·꼬리).
 * coordinateToLogical이 null이어도 가시 범위 보간·raw.time 기반으로 봉을 잡는다.
 */
function snapDrawPointMagnet(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  clientX: number,
  clientY: number,
  raw: { time: Time; price: number },
  enabled: boolean,
): { time: Time; price: number } {
  if (!enabled) return raw;
  const pane0 = chart.panes()[0]?.getHTMLElement();
  if (!pane0) return raw;
  const pr = pane0.getBoundingClientRect();
  const px = clientX - pr.left;
  const py = clientY - pr.top;
  const ts = chart.timeScale();
  const last = candle.data().length - 1;
  if (last < 0) return raw;

  let center: number | null = null;
  const log = ts.coordinateToLogical(px);
  if (log != null && Number.isFinite(log as number)) {
    center = log as number;
  }
  if (center == null) {
    center = logicalFromPaneX(chart, px);
  }
  if (center == null) {
    const ix = ts.timeToIndex(raw.time, true);
    if (ix != null) center = ix as number;
  }
  if (center == null) return raw;

  const maxD2 = (MAGNET_OHLC_PX + 24) ** 2;
  let bestD2 = maxD2;
  let best: { time: Time; price: number } | null = null;
  const iBase = Math.round(center);
  for (let d = -10; d <= 10; d++) {
    const idx = Math.max(0, Math.min(last, iBase + d));
    const bar = candle.dataByIndex(idx, MismatchDirection.NearestLeft);
    if (!bar) continue;
    const b = bar as {
      time: Time;
      open: number;
      high: number;
      low: number;
      close: number;
    };
    if (
      typeof b.open !== "number" ||
      typeof b.high !== "number" ||
      typeof b.low !== "number" ||
      typeof b.close !== "number"
    ) {
      continue;
    }
    const cx = ts.timeToCoordinate(b.time);
    if (cx == null) continue;
    const cxn = cx as number;
    for (const p of [b.open, b.high, b.low, b.close] as const) {
      const cy = candle.priceToCoordinate(p);
      if (cy == null) continue;
      const dx = px - cxn;
      const dy = py - (cy as number);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { time: b.time, price: p };
      }
    }
  }
  if (best) return best;

  const idxFb = ts.timeToIndex(raw.time, true);
  if (idxFb == null) return raw;
  const barOnly = candle.dataByIndex(
    Math.max(0, Math.min(last, idxFb as number)),
    MismatchDirection.NearestLeft,
  );
  if (!barOnly) return raw;
  const bo = barOnly as {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
  };
  if (
    typeof bo.open !== "number" ||
    typeof bo.high !== "number" ||
    typeof bo.low !== "number" ||
    typeof bo.close !== "number"
  ) {
    return raw;
  }
  let snapP = bo.open;
  let bestAbs = Math.abs(raw.price - snapP);
  for (const p of [bo.high, bo.low, bo.close] as const) {
    const a = Math.abs(raw.price - p);
    if (a < bestAbs) {
      bestAbs = a;
      snapP = p;
    }
  }
  return { time: bo.time, price: snapP };
}

function rayAnchorThroughClientPositions(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  o: RayDrawingModel,
): { ax: number; ay: number; tx: number; ty: number } | null {
  const pane = chart.panes()[0]?.getHTMLElement();
  if (!pane) return null;
  const pr = pane.getBoundingClientRect();
  const local = rayHandlePanePositions(chart, candle, o);
  if (!local) return null;
  return {
    ax: pr.left + local.ax,
    ay: pr.top + local.ay,
    tx: pr.left + local.tx,
    ty: pr.top + local.ty,
  };
}

function applyChartDrawing(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  time: Time,
  price: number,
  mode: ChartDrawMode,
  acc: ChartDrawingStore,
  persistKey: string,
  legacyStructureKey: string | undefined,
  onPlaced?: () => void,
  onRayDraftChange?: (draft: RayDraft | null) => void,
  rayThroughLogical?: number | null,
  beforeCommit?: () => void,
): void {
  if (mode === "hline") {
    beforeCommit?.();
    const hid = newChartDrawingId();
    const pl = candle.createPriceLine({
      id: hid,
      price,
      ...DRAW_HLINE_REST,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "",
    });
    acc.objects.push({
      kind: "hline",
      id: hid,
      priceLine: pl,
    });
    persistChartDrawingSnapshot(
      persistKey,
      drawingSnapshotFromAccum(acc),
      legacyStructureKey,
    );
    onPlaced?.();
    return;
  }
  if (mode === "ray") {
    if (!acc.rayDraft) {
      acc.rayDraft = { time, value: price };
      onRayDraftChange?.(acc.rayDraft);
      return;
    }
    const anchor = acc.rayDraft;
    acc.rayDraft = null;
    onRayDraftChange?.(null);
    const pts = computeRayLineEndpoints(
      chart,
      candle,
      anchor.time,
      anchor.value,
      time,
      price,
      rayThroughLogical ?? null,
    );
    if (!pts) {
      acc.rayDraft = anchor;
      onRayDraftChange?.(anchor);
      return;
    }
    beforeCommit?.();
    const rid = newChartDrawingId();
    const line = chart.addSeries(
      LineSeries,
      {
        ...DRAW_RAY_REST,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
      0,
    );
    line.setData(toLineData(pts));
    acc.objects.push({
      kind: "ray",
      id: rid,
      series: line,
      anchorTime: anchor.time,
      anchorValue: anchor.value,
      throughTime: time,
      throughValue: price,
    });
    persistChartDrawingSnapshot(
      persistKey,
      drawingSnapshotFromAccum(acc),
      legacyStructureKey,
    );
    onPlaced?.();
  }
}

interface ChartSeriesBundle {
  structureKey: string;
  chart: IChartApi;
  candle: ISeriesApi<"Candlestick">;
  markers: ISeriesMarkersPluginApi<Time> | null;
  ma20: ISeriesApi<"Line"> | null;
  ma50: ISeriesApi<"Line"> | null;
  ichimoku: ISeriesApi<"Line">[] | null;
  ichimokuCloud: ISeriesApi<"Candlestick"> | null;
  volume: ISeriesApi<"Histogram"> | null;
  rsi: ISeriesApi<"Line"> | null;
  /** RSI 50 기준선 — 축 라벨에 크로스헤어 X(논리 인덱스) 표시 */
  rsiMid50Line: IPriceLine | null;
  rsiZone70Line: IPriceLine | null;
  rsiZone30Line: IPriceLine | null;
}

function drawingSnapshotFromAccum(
  acc: ChartDrawingStore,
): ChartDrawingSnapshotV1 {
  const hlines: ChartDrawingSnapshotV1["hlines"] = [];
  const rays: ChartDrawingSnapshotV1["rays"] = [];
  for (const o of acc.objects) {
    if (o.kind === "hline") {
      hlines.push({
        id: o.id,
        price: o.priceLine.options().price as number,
      });
    } else {
      rays.push({
        id: o.id,
        t1: o.anchorTime as ChartTime,
        v1: o.anchorValue,
        t2: o.throughTime as ChartTime,
        v2: o.throughValue,
      });
    }
  }
  return { version: 1, hlines, rays };
}

/** 타임프레임이 바뀌어도 스냅된 시각으로 광선 복원 시도 */
function snapRayTimesToLoadedBars(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  tA: Time,
  tB: Time,
): { tA: Time; tB: Time } | null {
  const n = candle.data().length;
  if (n < 1) return null;
  const ts = chart.timeScale();
  const snap = (t: Time): Time | null => {
    const idx = ts.timeToIndex(t, true);
    if (idx == null) return null;
    const i = Math.max(0, Math.min(n - 1, Math.round(idx as number)));
    const bar = candle.dataByIndex(i, MismatchDirection.NearestLeft);
    return bar ? (bar.time as Time) : null;
  };
  const a = snap(tA);
  const b = snap(tB);
  if (!a || !b) return null;
  return { tA: a, tB: b };
}

function hydrateDrawingsFromSnapshot(
  b: ChartSeriesBundle,
  snap: ChartDrawingSnapshotV1,
  acc: ChartDrawingStore,
): void {
  for (const h of snap.hlines) {
    if (!Number.isFinite(h.price)) continue;
    try {
      const hid = h.id ?? newChartDrawingId();
      const pl = b.candle.createPriceLine({
        id: hid,
        price: h.price,
        ...DRAW_HLINE_REST,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "",
      });
      acc.objects.push({
        kind: "hline",
        id: hid,
        priceLine: pl,
      });
    } catch {
      /* invalid price line on this scale */
    }
  }
  for (const r of snap.rays) {
    try {
      let tA = toSeriesTime(r.t1);
      let tB = toSeriesTime(r.t2);
      let pts = computeRayLineEndpoints(
        b.chart,
        b.candle,
        tA,
        r.v1,
        tB,
        r.v2,
      );
      if (!pts) {
        const sn = snapRayTimesToLoadedBars(b.chart, b.candle, tA, tB);
        if (!sn) continue;
        tA = sn.tA;
        tB = sn.tB;
        pts = computeRayLineEndpoints(
          b.chart,
          b.candle,
          tA,
          r.v1,
          tB,
          r.v2,
        );
      }
      if (!pts) continue;
      const rid = r.id ?? newChartDrawingId();
      const line = b.chart.addSeries(
        LineSeries,
        {
          ...DRAW_RAY_REST,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0,
      );
      line.setData(toLineData(pts));
      acc.objects.push({
        kind: "ray",
        id: rid,
        series: line,
        anchorTime: tA,
        anchorValue: r.v1,
        throughTime: tB,
        throughValue: r.v2,
      });
    } catch {
      /* time scale / series mismatch after interval change */
    }
  }
}

const DRAWING_UNDO_MAX = 50;

function cloneDrawingSnapshot(s: ChartDrawingSnapshotV1): ChartDrawingSnapshotV1 {
  return typeof structuredClone !== "undefined"
    ? structuredClone(s)
    : (JSON.parse(JSON.stringify(s)) as ChartDrawingSnapshotV1);
}

function replaceDrawingsFromSnapshot(
  b: ChartSeriesBundle,
  acc: ChartDrawingStore,
  snap: ChartDrawingSnapshotV1,
  hoverIdRef: { current: string | null },
): void {
  const hid = hoverIdRef.current;
  if (hid) {
    const ho = findDrawingById(acc, hid);
    if (ho) restoreDrawingRestStyle(ho);
    hoverIdRef.current = null;
  }
  for (const o of acc.objects) {
    disposeChartDrawingModel(b, o);
  }
  acc.objects = [];
  acc.rayDraft = null;
  hydrateDrawingsFromSnapshot(b, snap, acc);
}

/** `candle.setData` 등 전체 갱신 후 차트에서 지워진 드로잉을 localStorage 기준으로 다시 붙인다 */
function resetAndHydratePersistedDrawings(
  b: ChartSeriesBundle,
  fitKey: string,
  dataInterval: string,
  acc: ChartDrawingStore,
): void {
  for (const o of acc.objects) {
    disposeChartDrawingModel(b, o);
  }
  acc.objects = [];
  acc.rayDraft = null;
  const snap = getChartDrawingSnapshotForFit(fitKey, dataInterval);
  if (snap) hydrateDrawingsFromSnapshot(b, snap, acc);
}

function removeDrawingById(
  b: ChartSeriesBundle,
  acc: ChartDrawingStore,
  id: string,
): boolean {
  const i = acc.objects.findIndex((o) => o.id === id);
  if (i < 0) return false;
  const o = acc.objects[i]!;
  disposeChartDrawingModel(b, o);
  acc.objects.splice(i, 1);
  return true;
}

function refreshRaySeriesGeometry(
  b: ChartSeriesBundle,
  ray: RayDrawingModel,
): void {
  const hint = rayLogicalHintFromStoredRay(b.chart, ray);
  const pts = computeRayLineEndpoints(
    b.chart,
    b.candle,
    ray.anchorTime,
    ray.anchorValue,
    ray.throughTime,
    ray.throughValue,
    hint,
  );
  if (!pts) return;
  ray.series.setData(toLineData(pts));
}

function duplicateDrawingVariant(
  b: ChartSeriesBundle,
  acc: ChartDrawingStore,
  src: ChartDrawingModel,
  variant: "copy" | "add",
): void {
  const sign = variant === "copy" ? 1 : -1;
  if (src.kind === "hline") {
    const p = src.priceLine.options().price as number;
    const delta = Math.max(Math.abs(p) * 0.0025, 1e-6) * sign;
    const hid = newChartDrawingId();
    const pl = b.candle.createPriceLine({
      id: hid,
      price: p + delta,
      ...DRAW_HLINE_REST,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "",
    });
    acc.objects.push({ kind: "hline", id: hid, priceLine: pl });
    return;
  }
  const dv =
    (Math.max(Math.abs(src.throughValue), Math.abs(src.anchorValue)) * 0.0012 +
      1e-6) *
    sign;
  const pts = computeRayLineEndpoints(
    b.chart,
    b.candle,
    src.anchorTime,
    src.anchorValue,
    src.throughTime,
    src.throughValue + dv,
    rayLogicalHintFromStoredRay(b.chart, src),
  );
  if (!pts) return;
  const rid = newChartDrawingId();
  const line = b.chart.addSeries(
    LineSeries,
    {
      ...DRAW_RAY_REST,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    },
    0,
  );
  line.setData(toLineData(pts));
  acc.objects.push({
    kind: "ray",
    id: rid,
    series: line,
    anchorTime: src.anchorTime,
    anchorValue: src.anchorValue,
    throughTime: src.throughTime,
    throughValue: src.throughValue + dv,
  });
}

const CLIPBOARD_DRAWING_PREFIX = "stock-chart-drawing-v1:";

type ClipboardDrawingPayload =
  | { kind: "hline"; price: number }
  | { kind: "ray"; t1: ChartTime; v1: number; t2: ChartTime; v2: number };

function serializeDrawingForClipboard(o: ChartDrawingModel): string {
  const payload: ClipboardDrawingPayload =
    o.kind === "hline"
      ? { kind: "hline", price: o.priceLine.options().price as number }
      : {
          kind: "ray",
          t1: o.anchorTime as ChartTime,
          v1: o.anchorValue,
          t2: o.throughTime as ChartTime,
          v2: o.throughValue,
        };
  return CLIPBOARD_DRAWING_PREFIX + JSON.stringify(payload);
}

function tryParseClipboardDrawing(text: string): ClipboardDrawingPayload | null {
  if (!text.startsWith(CLIPBOARD_DRAWING_PREFIX)) return null;
  try {
    const o = JSON.parse(
      text.slice(CLIPBOARD_DRAWING_PREFIX.length),
    ) as ClipboardDrawingPayload;
    if (o?.kind === "hline" && typeof o.price === "number" && Number.isFinite(o.price)) {
      return o;
    }
    if (
      o?.kind === "ray" &&
      typeof o.v1 === "number" &&
      typeof o.v2 === "number" &&
      Number.isFinite(o.v1) &&
      Number.isFinite(o.v2) &&
      o.t1 != null &&
      o.t2 != null
    ) {
      return o;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 붙여넣기 — 복사본과 겹치지 않게 소폭 오프셋 */
function appendDrawingFromClipboardPayload(
  b: ChartSeriesBundle,
  acc: ChartDrawingStore,
  d: ClipboardDrawingPayload,
): boolean {
  if (d.kind === "hline") {
    const p = d.price;
    const delta = Math.max(Math.abs(p) * 0.0025, 1e-6);
    try {
      const hid = newChartDrawingId();
      const pl = b.candle.createPriceLine({
        id: hid,
        price: p + delta,
        ...DRAW_HLINE_REST,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "",
      });
      acc.objects.push({ kind: "hline", id: hid, priceLine: pl });
      return true;
    } catch {
      return false;
    }
  }
  const sign = 1;
  const dv =
    (Math.max(Math.abs(d.v2), Math.abs(d.v1)) * 0.0012 + 1e-6) * sign;
  let tA = toSeriesTime(d.t1);
  let tB = toSeriesTime(d.t2);
  let pts = computeRayLineEndpoints(
    b.chart,
    b.candle,
    tA,
    d.v1,
    tB,
    d.v2 + dv,
  );
  if (!pts) {
    const sn = snapRayTimesToLoadedBars(b.chart, b.candle, tA, tB);
    if (!sn) return false;
    tA = sn.tA;
    tB = sn.tB;
    pts = computeRayLineEndpoints(
      b.chart,
      b.candle,
      tA,
      d.v1,
      tB,
      d.v2 + dv,
    );
  }
  if (!pts) return false;
  try {
    const rid = newChartDrawingId();
    const line = b.chart.addSeries(
      LineSeries,
      {
        ...DRAW_RAY_REST,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
      0,
    );
    line.setData(toLineData(pts));
    acc.objects.push({
      kind: "ray",
      id: rid,
      series: line,
      anchorTime: tA,
      anchorValue: d.v1,
      throughTime: tB,
      throughValue: d.v2 + dv,
    });
    return true;
  } catch {
    return false;
  }
}

/** 지표·setData 후 자동 스케일이 사용자 확대/축소를 덮지 않게 메인 뷰포트 고정 */
type MainViewportSnap = {
  logical: { from: number; to: number } | null;
  price: { from: number; to: number } | null;
};

function snapMainViewport(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
): MainViewportSnap {
  const logical = chart.timeScale().getVisibleLogicalRange();
  const vr = candle.priceScale().getVisibleRange();
  return {
    logical: logical ?? null,
    price:
      vr != null &&
      Number.isFinite(vr.from as number) &&
      Number.isFinite(vr.to as number)
        ? { from: vr.from as number, to: vr.to as number }
        : null,
  };
}

function restoreMainViewport(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  snap: MainViewportSnap,
): void {
  if (snap.logical) {
    chart.timeScale().setVisibleLogicalRange({
      from: snap.logical.from,
      to: snap.logical.to,
    });
  }
  if (snap.price) {
    const ps = candle.priceScale();
    ps.applyOptions({ autoScale: false });
    ps.setVisibleRange({ from: snap.price.from, to: snap.price.to });
  }
}

function candleEquals(a: Candle, b: Candle): boolean {
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    (a.volume ?? 0) === (b.volume ?? 0)
  );
}

/** 이전 캔들 배열과 접두만 동일한지(실시간으로 마지막·또는 1봉 추가만 바뀐 경우) */
function canStreamCandleUpdate(prev: Candle[], next: Candle[]): boolean {
  if (prev.length === 0 || next.length === 0) return false;
  if (prev.length === next.length) {
    if (prev.length === 1) return false;
    for (let i = 0; i < prev.length - 1; i++) {
      if (!candleEquals(prev[i]!, next[i]!)) return false;
    }
    return true;
  }
  if (next.length === prev.length + 1) {
    for (let i = 0; i < prev.length; i++) {
      if (!candleEquals(prev[i]!, next[i]!)) return false;
    }
    return true;
  }
  return false;
}

function applyCandleData(
  bundle: ChartSeriesBundle,
  candles: Candle[],
  dailyCandles: Candle[] | undefined,
  interval: string,
  overlays: ChartOverlays,
) {
  const vp = snapMainViewport(bundle.chart, bundle.candle);
  const useDailyMa =
    overlays.ma &&
    dailyCandles &&
    dailyCandles.length > 0 &&
    isIntradayInterval(interval);

  bundle.candle.setData(candleBarData(candles));

  if (bundle.ma20 && bundle.ma50) {
    const { ma20, ma50 } = useDailyMa
      ? computeMaLinesFromDaily(candles, dailyCandles!)
      : computeMaLines(candles);
    bundle.ma20.setData(toLineData(ma20));
    bundle.ma50.setData(toLineData(ma50));
  }

  if (bundle.ichimoku && bundle.ichimoku.length === 2) {
    const ichi = computeIchimokuLines(candles);
    const cloudBars = buildIchimokuCloudBarsFromSpans(ichi.spanA, ichi.spanB);
    if (bundle.ichimokuCloud && cloudBars.length > 0) {
      bundle.ichimokuCloud.setData(ichimokuCloudBarData(cloudBars));
    }
    bundle.ichimoku[0]!.setData(toLineData(ichi.spanA));
    bundle.ichimoku[1]!.setData(toLineData(ichi.spanB));
  }

  if (bundle.volume) {
    bundle.volume.setData(volumeBarData(candles));
  }

  if (bundle.rsi) {
    bundle.rsi.setData(toLineData(computeRsiLine(candles)));
  }

  restoreMainViewport(bundle.chart, bundle.candle, vp);
}

/** 지표만 켜고 끌 때 — 차트 인스턴스·뷰포트 유지 */
function syncOverlaySeries(
  b: ChartSeriesBundle,
  candles: Candle[],
  dailyCandles: Candle[] | undefined,
  interval: string,
  overlays: ChartOverlays,
  mainStretch: number,
  scaleMargin: number,
) {
  const chart = b.chart;
  const c = candles;
  if (c.length === 0) return;

  const vp = snapMainViewport(chart, b.candle);

  const addLineData = (
    data: { time: ChartTime; value: number }[],
    color: string,
    lineWidth: 1 | 2 = 1,
  ): ISeriesApi<"Line"> | null => {
    if (data.length === 0) return null;
    const s = chart.addSeries(LineSeries, {
      color,
      lineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    s.setData(toLineData(data));
    return s;
  };

  const useDailyMa =
    overlays.ma &&
    dailyCandles &&
    dailyCandles.length > 0 &&
    isIntradayInterval(interval);

  if (!overlays.ma) {
    if (b.ma20) {
      chart.removeSeries(b.ma20);
      b.ma20 = null;
    }
    if (b.ma50) {
      chart.removeSeries(b.ma50);
      b.ma50 = null;
    }
  } else {
    const { ma20: m20, ma50: m50 } = useDailyMa
      ? computeMaLinesFromDaily(c, dailyCandles!)
      : computeMaLines(c);
    if (!b.ma20 || !b.ma50) {
      if (b.ma20) {
        chart.removeSeries(b.ma20);
        b.ma20 = null;
      }
      if (b.ma50) {
        chart.removeSeries(b.ma50);
        b.ma50 = null;
      }
      b.ma20 = addLineData(m20, "#fbbf24", 2);
      b.ma50 = addLineData(m50, "#60a5fa", 2);
    } else {
      b.ma20.setData(toLineData(m20));
      b.ma50.setData(toLineData(m50));
    }
  }

  if (!overlays.ichimoku) {
    if (b.ichimokuCloud) {
      chart.removeSeries(b.ichimokuCloud);
      b.ichimokuCloud = null;
    }
    if (b.ichimoku) {
      for (const s of b.ichimoku) {
        chart.removeSeries(s);
      }
      b.ichimoku = null;
    }
  } else {
    const ichi = computeIchimokuLines(c);
    const cloudBars = buildIchimokuCloudBarsFromSpans(ichi.spanA, ichi.spanB);
    /** 선행스팬 A·B + 구름(양운·음운, α 0.05) */
    const lines = [ichi.spanA, ichi.spanB] as const;
    const wantCloud = cloudBars.length > 0;
    const hasCloud = Boolean(b.ichimokuCloud);
    const needRecreate =
      !b.ichimoku || b.ichimoku.length !== 2 || wantCloud !== hasCloud;
    if (needRecreate) {
      if (b.ichimokuCloud) {
        chart.removeSeries(b.ichimokuCloud);
        b.ichimokuCloud = null;
      }
      if (b.ichimoku) {
        for (const s of b.ichimoku) chart.removeSeries(s);
        b.ichimoku = null;
      }
      const cloud =
        cloudBars.length > 0
          ? chart.addSeries(CandlestickSeries, {
              upColor: "rgba(34, 197, 94, 0.05)",
              downColor: "rgba(239, 68, 68, 0.05)",
              wickVisible: false,
              borderVisible: false,
              priceLineVisible: false,
              lastValueVisible: false,
            })
          : null;
      if (cloud) {
        cloud.setData(ichimokuCloudBarData(cloudBars));
      }
      b.ichimokuCloud = cloud;
      const sA = addLineData(lines[0]!, "#22c55e", 1);
      const sB = addLineData(lines[1]!, "#ef4444", 1);
      b.ichimoku = sA && sB ? [sA, sB] : null;
    } else {
      if (b.ichimokuCloud && cloudBars.length > 0) {
        b.ichimokuCloud.setData(ichimokuCloudBarData(cloudBars));
      }
      const ik = b.ichimoku;
      if (ik && ik.length === 2) {
        ik[0]!.setData(toLineData(lines[0]!));
        ik[1]!.setData(toLineData(lines[1]!));
      }
    }
  }

  if (!overlays.volume) {
    if (b.volume) {
      chart.removeSeries(b.volume);
      b.volume = null;
    }
  } else if (!b.volume) {
    chart.addPane();
    const panes = chart.panes();
    const vp = panes[panes.length - 1]!;
    vp.setHeight(72);
    b.volume = vp.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    b.volume.setData(volumeBarData(c));
  } else {
    b.volume.setData(volumeBarData(c));
  }

  if (!overlays.rsi) {
    if (b.rsi) {
      chart.removeSeries(b.rsi);
      b.rsi = null;
      b.rsiMid50Line = null;
      b.rsiZone70Line = null;
      b.rsiZone30Line = null;
    }
  } else if (!b.rsi) {
    const rsiPts = computeRsiLine(c);
    chart.addPane();
    const panes = chart.panes();
    const rp = panes[panes.length - 1]!;
    rp.setHeight(72);
    b.rsi = rp.addSeries(LineSeries, {
      color: "#c084fc",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    b.rsi.setData(toLineData(rsiPts));
    const rsiRef = (price: number, color: string, title: string) =>
      b.rsi!.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lineVisible: true,
        axisLabelVisible: true,
        title,
        /** 기본값은 선색과 동일 → 축 라벨이 칠해져 보임 */
        axisLabelColor: "rgba(0, 0, 0, 0)",
        axisLabelTextColor: "#94a3b8",
      });
    b.rsiZone70Line = rsiRef(70, "rgba(248, 113, 113, 0.42)", "70");
    b.rsiMid50Line = rsiRef(50, "rgba(148, 163, 184, 0.45)", "");
    b.rsiZone30Line = rsiRef(30, "rgba(74, 222, 128, 0.42)", "30");
  } else {
    b.rsi.setData(toLineData(computeRsiLine(c)));
  }

  const panes = chart.panes();
  if (panes.length >= 2) {
    panes[0]!.setStretchFactor(mainStretch);
    for (let i = 1; i < panes.length; i++) {
      panes[i]!.setStretchFactor(1);
    }
  }
  b.candle.priceScale().applyOptions({
    scaleMargins: { top: scaleMargin, bottom: scaleMargin },
  });

  restoreMainViewport(chart, b.candle, vp);
}

/** 전체 setData 대신 update 위주 — 가격축 수동 스케일이 실시간 갱신에 덮이지 않게 함 */
function applyCandleDataStreamed(
  bundle: ChartSeriesBundle,
  candles: Candle[],
  dailyCandles: Candle[] | undefined,
  interval: string,
  overlays: ChartOverlays,
) {
  const vp = snapMainViewport(bundle.chart, bundle.candle);
  const last = candles[candles.length - 1]!;
  bundle.candle.update(candleBarData([last])[0]!);

  const useDailyMa =
    overlays.ma &&
    dailyCandles &&
    dailyCandles.length > 0 &&
    isIntradayInterval(interval);

  if (bundle.ma20 && bundle.ma50) {
    const { ma20, ma50 } = useDailyMa
      ? computeMaLinesFromDaily(candles, dailyCandles!)
      : computeMaLines(candles);
    const p20 = ma20[ma20.length - 1];
    const p50 = ma50[ma50.length - 1];
    if (p20) bundle.ma20.update(toLineData([p20])[0]!);
    if (p50) bundle.ma50.update(toLineData([p50])[0]!);
  }

  if (bundle.ichimoku && bundle.ichimoku.length === 2) {
    const ichi = computeIchimokuLines(candles);
    const cloudBars = buildIchimokuCloudBarsFromSpans(ichi.spanA, ichi.spanB);
    if (bundle.ichimokuCloud && cloudBars.length > 0) {
      bundle.ichimokuCloud.setData(ichimokuCloudBarData(cloudBars));
    }
    bundle.ichimoku[0]!.setData(toLineData(ichi.spanA));
    bundle.ichimoku[1]!.setData(toLineData(ichi.spanB));
  }

  if (bundle.volume) {
    bundle.volume.update(volumeBarData([last])[0]!);
  }

  if (bundle.rsi) {
    const rsiPts = computeRsiLine(candles);
    const lastR = rsiPts[rsiPts.length - 1];
    if (lastR) bundle.rsi.update(toLineData([lastR])[0]!);
  }

  restoreMainViewport(bundle.chart, bundle.candle, vp);
}

export default function StockChart({
  candles,
  dailyCandles,
  fitKey,
  interval = "1d",
  overlays,
  drawingsEnabled = false,
  chartDrawMode: chartDrawModeProp,
  onChartDrawModeChange,
  showBuiltInDrawToolbar: showBuiltInDrawToolbarProp,
  registerDrawApi,
  chartDrawMagnet: chartDrawMagnetProp,
  onChartDrawMagnetChange,
  profitMarker = null,
}: StockChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<ChartSeriesBundle | null>(null);
  const lastFitKeyRef = useRef("");
  const drawingAccumRef = useRef<ChartDrawingStore>({
    objects: [],
    rayDraft: null,
  });
  const drawModeRef = useRef<ChartDrawMode>("cursor");
  const [internalDrawMode, setInternalDrawMode] =
    useState<ChartDrawMode>("cursor");
  const isDrawControlled =
    chartDrawModeProp !== undefined && onChartDrawModeChange !== undefined;
  const drawMode = isDrawControlled ? chartDrawModeProp! : internalDrawMode;
  const setDrawMode = useCallback(
    (m: ChartDrawMode) => {
      if (chartDrawModeProp !== undefined && onChartDrawModeChange) {
        onChartDrawModeChange(m);
      } else {
        setInternalDrawMode(m);
      }
    },
    [chartDrawModeProp, onChartDrawModeChange],
  );
  const isMagnetControlled =
    chartDrawMagnetProp !== undefined && onChartDrawMagnetChange !== undefined;
  const [internalMagnet, setInternalMagnet] = useState(false);
  const magnetEnabled = isMagnetControlled
    ? chartDrawMagnetProp!
    : internalMagnet;
  const setMagnetEnabled = useCallback(
    (next: boolean) => {
      if (isMagnetControlled && onChartDrawMagnetChange) {
        onChartDrawMagnetChange(next);
      } else {
        setInternalMagnet(next);
      }
    },
    [isMagnetControlled, onChartDrawMagnetChange],
  );
  const magnetEnabledRef = useRef(magnetEnabled);
  magnetEnabledRef.current = magnetEnabled;
  const showBuiltinDrawToolbar =
    drawingsEnabled &&
    (showBuiltInDrawToolbarProp ??
      !(chartDrawModeProp !== undefined && onChartDrawModeChange));
  /** 거래량·RSI 패인이 있을 때 메인 캔들 패인 세로 비율 */
  const mainPaneStretchRef = useRef(8);
  /** 보조 패인 없을 때 scaleMargins */
  const scaleMarginRef = useRef(0.12);

  const isIntraday = isIntradayInterval(interval);
  const structureKey = `${fitKey}:${interval}`;
  const drawingPersistKey = drawingStorageKeyFromFitKey(fitKey);

  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const dailyCandlesRef = useRef(dailyCandles);
  dailyCandlesRef.current = dailyCandles;
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const prevCandlesForStreamRef = useRef<Candle[]>([]);
  const prevStructureKeyForStreamRef = useRef<string>("");

  const drawMenuRef = useRef<HTMLDivElement | null>(null);
  const drawDragRef = useRef<{
    pointerId: number;
    id: string;
    role: "hline" | "ray-anchor" | "ray-through" | "ray-body";
    rayBody?: {
      startRaw: { time: Time; price: number };
      dLog: number;
      dVal: number;
    };
  } | null>(null);
  /** 광선 핸들(오버레이 버튼)에서도 동일 드래그 시작 */
  const beginDrawingDragRef = useRef<
    ((ev: PointerEvent, hit: DrawingHitTarget) => void) | null
  >(null);
  const drawingHoverIdRef = useRef<string | null>(null);
  const drawingRayDotsHoverIdRef = useRef<string | null>(null);
  const drawingSelectedIdRef = useRef<string | null>(null);
  const chartDrawAreaPointerInsideRef = useRef(false);
  const drawPersistKeyRef = useRef(drawingPersistKey);
  const drawLegacyKeyRef = useRef(structureKey);
  drawPersistKeyRef.current = drawingPersistKey;
  drawLegacyKeyRef.current = structureKey;

  const drawingUndoStackRef = useRef<ChartDrawingSnapshotV1[]>([]);
  const drawingRedoStackRef = useRef<ChartDrawingSnapshotV1[]>([]);

  const pushDrawingUndo = useCallback(() => {
    const snap = cloneDrawingSnapshot(drawingSnapshotFromAccum(drawingAccumRef.current));
    const st = drawingUndoStackRef.current;
    const tail = st[st.length - 1];
    if (tail && JSON.stringify(tail) === JSON.stringify(snap)) return;
    st.push(snap);
    while (st.length > DRAWING_UNDO_MAX) st.shift();
    drawingRedoStackRef.current = [];
  }, []);

  const drawUndo = useCallback(() => {
    const st = drawingUndoStackRef.current;
    if (st.length < 1) return;
    const br = bundleRef.current;
    if (!br || br.structureKey !== structureKey) return;
    const target = st.pop()!;
    const cur = cloneDrawingSnapshot(drawingSnapshotFromAccum(drawingAccumRef.current));
    drawingRedoStackRef.current.push(cur);
    replaceDrawingsFromSnapshot(br, drawingAccumRef.current, target, drawingHoverIdRef);
    drawingRayDotsHoverIdRef.current = null;
    setDrawingRayDots(null);
    drawingSelectedIdRef.current = null;
    setDrawHitMenu(null);
    persistChartDrawingSnapshot(
      drawPersistKeyRef.current,
      target,
      drawLegacyKeyRef.current,
    );
  }, [structureKey]);

  const drawRedo = useCallback(() => {
    const st = drawingRedoStackRef.current;
    if (st.length < 1) return;
    const br = bundleRef.current;
    if (!br || br.structureKey !== structureKey) return;
    const target = st.pop()!;
    const cur = cloneDrawingSnapshot(drawingSnapshotFromAccum(drawingAccumRef.current));
    drawingUndoStackRef.current.push(cur);
    replaceDrawingsFromSnapshot(br, drawingAccumRef.current, target, drawingHoverIdRef);
    drawingRayDotsHoverIdRef.current = null;
    setDrawingRayDots(null);
    drawingSelectedIdRef.current = null;
    setDrawHitMenu(null);
    persistChartDrawingSnapshot(
      drawPersistKeyRef.current,
      target,
      drawLegacyKeyRef.current,
    );
  }, [structureKey]);

  const [drawHitMenu, setDrawHitMenu] = useState<{
    clientX: number;
    clientY: number;
    hit: DrawingHitTarget;
  } | null>(null);
  const [rayDraftForPreview, setRayDraftForPreview] = useState<RayDraft | null>(
    null,
  );
  const rayPreviewLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const hlinePreviewPlRef = useRef<IPriceLine | null>(null);
  const [drawingRayDots, setDrawingRayDots] = useState<{
    id: string;
    ax: number;
    ay: number;
    tx: number;
    ty: number;
  } | null>(null);

  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  const clearAllDrawings = useCallback(() => {
    const b = bundleRef.current;
    const acc = drawingAccumRef.current;
    if (!b) return;
    pushDrawingUndo();
    const hoverId = drawingHoverIdRef.current;
    if (hoverId) {
      const ho = findDrawingById(acc, hoverId);
      if (ho) restoreDrawingRestStyle(ho);
      drawingHoverIdRef.current = null;
    }
    for (const o of acc.objects) {
      try {
        disposeChartDrawingModel(b, o);
      } catch {
        /* ignore */
      }
    }
    acc.objects = [];
    acc.rayDraft = null;
    drawingSelectedIdRef.current = null;
    drawingRayDotsHoverIdRef.current = null;
    setDrawingRayDots(null);
    setRayDraftForPreview(null);
    setDrawHitMenu(null);
    const pv = rayPreviewLineRef.current;
    if (pv && b.chart) {
      try {
        b.chart.removeSeries(pv);
      } catch {
        /* ignore */
      }
      rayPreviewLineRef.current = null;
    }
    const hlp = hlinePreviewPlRef.current;
    if (hlp && b.candle) {
      try {
        b.candle.removePriceLine(hlp);
      } catch {
        /* ignore */
      }
      hlinePreviewPlRef.current = null;
    }
    persistChartDrawingSnapshot(
      drawingPersistKey,
      {
        version: 1,
        hlines: [],
        rays: [],
      },
      structureKey,
    );
  }, [drawingPersistKey, structureKey, pushDrawingUndo]);

  useEffect(() => {
    if (!drawingsEnabled || !registerDrawApi) return;
    registerDrawApi({ clearAll: clearAllDrawings });
    return () => registerDrawApi(null);
  }, [drawingsEnabled, registerDrawApi, clearAllDrawings]);

  /** 심볼·타임프레임 변경 시에만 차트 인스턴스를 새로 만든다(지표 토글은 동기화만) */
  useEffect(() => {
    if (!containerRef.current) return;
    const c = candlesRef.current;
    if (c.length === 0) return;

    setRayDraftForPreview(null);
    setDrawHitMenu(null);
    drawDragRef.current = null;
    drawingHoverIdRef.current = null;

    const host = containerRef.current;
    host.replaceChildren();

    drawingAccumRef.current = {
      objects: [],
      rayDraft: null,
    };
    drawingUndoStackRef.current = [];
    drawingRedoStackRef.current = [];

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontFamily: "'DM Sans', 'Malgun Gothic', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScale: {
        mouseWheel: false,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.15)" },
      localization: {
        locale: "ko-KR",
        dateFormat: "yyyy-MM-dd",
        timeFormatter: (time: Time) => formatChartTime(time, isIntraday),
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.15)",
        timeVisible: isIntraday,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => formatChartTime(time, isIntraday),
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleSeries.setData(candleBarData(c));

    const markers = createSeriesMarkers(candleSeries, [], {
      autoScale: true,
    });

    const bundle: ChartSeriesBundle = {
      structureKey,
      chart,
      candle: candleSeries,
      markers,
      ma20: null,
      ma50: null,
      ichimoku: null,
      ichimokuCloud: null,
      volume: null,
      rsi: null,
      rsiMid50Line: null,
      rsiZone70Line: null,
      rsiZone30Line: null,
    };
    bundleRef.current = bundle;

    syncOverlaySeries(
      bundle,
      c,
      dailyCandlesRef.current,
      interval,
      overlaysRef.current,
      mainPaneStretchRef.current,
      scaleMarginRef.current,
    );

    const shouldFit = structureKey !== lastFitKeyRef.current;
    lastFitKeyRef.current = structureKey;
    if (shouldFit) chart.timeScale().fitContent();

    prevStructureKeyForStreamRef.current = "";
    prevCandlesForStreamRef.current = [];

    if (drawingsEnabled) {
      resetAndHydratePersistedDrawings(
        bundle,
        fitKey,
        interval,
        drawingAccumRef.current,
      );
    }

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const br = bundleRef.current;
      const mid = br?.rsiMid50Line;
      const rsiSeries = br?.rsi;
      if (!mid || !rsiSeries) return;
      if (param.point === undefined) {
        mid.applyOptions({ title: "" });
        return;
      }
      const rsiRaw = param.seriesData.get(rsiSeries as ISeriesApi<SeriesType>);
      const rsiVal =
        rsiRaw &&
        typeof rsiRaw === "object" &&
        "value" in rsiRaw &&
        typeof (rsiRaw as LineData<Time>).value === "number" &&
        Number.isFinite((rsiRaw as LineData<Time>).value)
          ? (rsiRaw as LineData<Time>).value
          : null;
      if (rsiVal == null) {
        mid.applyOptions({ title: "" });
        return;
      }
      mid.applyOptions({ title: rsiVal.toFixed(2) });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      const pv = rayPreviewLineRef.current;
      if (pv) {
        try {
          chart.removeSeries(pv);
        } catch {
          /* stale */
        }
        rayPreviewLineRef.current = null;
      }
      hlinePreviewPlRef.current = null;
      chart.remove();
      bundleRef.current = null;
    };
  }, [structureKey, drawingsEnabled, fitKey, interval]);

  useEffect(() => {
    const b = bundleRef.current;
    if (!b || b.structureKey !== structureKey) return;
    syncOverlaySeries(
      b,
      candlesRef.current,
      dailyCandlesRef.current,
      interval,
      overlaysRef.current,
      mainPaneStretchRef.current,
      scaleMarginRef.current,
    );
  }, [
    overlays.ma,
    overlays.ichimoku,
    overlays.volume,
    overlays.rsi,
    structureKey,
    interval,
  ]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      const b = bundleRef.current;
      if (!b) return;

      ev.preventDefault();
      ev.stopPropagation();

      const paneIdx = hitPaneIndexAtClient(b.chart, ev.clientX, ev.clientY);
      const volPane = b.volume
        ? paneIndexOfSeries(b.chart, b.volume as ISeriesApi<SeriesType>)
        : null;
      const rsiPane = b.rsi
        ? paneIndexOfSeries(b.chart, b.rsi as ISeriesApi<SeriesType>)
        : null;

      if (volPane != null && paneIdx === volPane && b.volume) {
        const pEl = b.chart.panes()[paneIdx]?.getHTMLElement();
        if (pEl) {
          zoomOverlayPriceScale(
            b.volume as ISeriesApi<SeriesType>,
            pEl,
            ev.clientY,
            ev.deltaY,
          );
        }
        return;
      }

      if (rsiPane != null && paneIdx === rsiPane && b.rsi) {
        const pEl = b.chart.panes()[paneIdx]?.getHTMLElement();
        if (pEl) {
          zoomOverlayPriceScale(
            b.rsi as ISeriesApi<SeriesType>,
            pEl,
            ev.clientY,
            ev.deltaY,
            { clampMin: 0, clampMax: 100, minSpan: 8 },
          );
        }
        return;
      }

      if (paneIdx !== 0) {
        return;
      }

      const onStrip = isMainPanePriceStripHit(ev.clientX, ev.clientY, b.chart);

      if (onStrip) {
        const ps = b.candle.priceScale();
        const range = ps.getVisibleRange();
        if (!range) return;
        const from = range.from as number;
        const to = range.to as number;
        const span = to - from;
        if (!(span > 0)) return;
        const zoomIn = ev.deltaY < 0;
        const newSpan = Math.max(1e-12, span * (zoomIn ? 0.92 : 1.08));
        const anchor = anchorPriceAtClientY(
          b.candle,
          b.chart,
          ev.clientY,
          from,
          to,
        );
        const t = (anchor - from) / span;
        let newFrom = anchor - t * newSpan;
        let newTo = newFrom + newSpan;
        if (newFrom > newTo) {
          const tmp = newFrom;
          newFrom = newTo;
          newTo = tmp;
        }
        ps.applyOptions({ autoScale: false });
        ps.setVisibleRange({ from: newFrom, to: newTo });
        return;
      }

      const lr = b.chart.timeScale().getVisibleLogicalRange();
      if (!lr) return;
      const n = candlesRef.current.length;
      if (n < 2) return;

      const span = lr.to - lr.from;
      if (!(span > 0)) return;
      const minBars = 5;
      /** 마지막 봉 오른쪽 빈 영역까지 축소·확대 가능 (끝에 맞춰 뷰를 밀지 않음) */
      const maxSpan = Math.max(minBars, n + 400);
      const zoomIn = ev.deltaY < 0;
      let newSpan = span * (zoomIn ? 0.9 : 1.1);
      newSpan = Math.min(maxSpan, Math.max(minBars, newSpan));

      const anchorLogical = anchorLogicalFallback(b.chart, ev.clientX, lr);
      const t = (anchorLogical - lr.from) / span;
      let from = anchorLogical - t * newSpan;
      let to = from + newSpan;

      if (from < 0) {
        const sh = -from;
        from += sh;
        to += sh;
      }
      if (to - from < minBars) {
        to = from + minBars;
      }
      b.chart.timeScale().setVisibleLogicalRange({ from, to });
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, true);
  }, [structureKey]);

  useEffect(() => {
    if (!drawingsEnabled || drawMode === "cursor") return;
    const b = bundleRef.current;
    if (!b || b.structureKey !== structureKey) return;
    const chartEl = b.chart.chartElement();

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      const mode = drawModeRef.current;
      if (mode === "cursor") return;

      const cNow = bundleRef.current?.candle;
      const chNow = bundleRef.current?.chart;
      if (!cNow || !chNow || chNow !== b.chart) return;

      const resolvedRaw = resolveDrawPointFromClient(
        ev.clientX,
        ev.clientY,
        chNow,
        cNow,
      );
      if (!resolvedRaw) return;

      const isRaySecond =
        mode === "ray" && drawingAccumRef.current.rayDraft != null;
      /** 두 번째 점: 마그넷이 빈 오른쪽·마지막 봉만 검색해 첫 점과 같은 봉으로 붙는 문제가 있어 비활성 */
      const resolved = isRaySecond
        ? resolvedRaw
        : snapDrawPointMagnet(
            chNow,
            cNow,
            ev.clientX,
            ev.clientY,
            resolvedRaw,
            magnetEnabled,
          );

      const throughLog =
        mode === "ray" && drawingAccumRef.current.rayDraft != null
          ? resolvedRaw.logical
          : null;

      ev.preventDefault();
      ev.stopPropagation();

      applyChartDrawing(
        chNow,
        cNow,
        resolved.time,
        resolved.price,
        mode,
        drawingAccumRef.current,
        drawingPersistKey,
        structureKey,
        () => setDrawMode("cursor"),
        setRayDraftForPreview,
        throughLog,
        pushDrawingUndo,
      );

      if (mode === "hline") {
        const br = bundleRef.current;
        const plp = hlinePreviewPlRef.current;
        if (plp && br?.candle) {
          try {
            br.candle.removePriceLine(plp);
          } catch {
            /* ignore */
          }
          hlinePreviewPlRef.current = null;
        }
      }
    };

    chartEl.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      chartEl.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [drawingsEnabled, drawMode, structureKey, magnetEnabled, drawingPersistKey, setDrawMode]);

  useEffect(() => {
    const b = bundleRef.current;
    if (!b || b.structureKey !== structureKey || !b.markers) return;
    if (!profitMarker) {
      b.markers.setMarkers([]);
      return;
    }
    const m: SeriesMarker<Time> = {
      time: profitMarker.time as Time,
      position: "atPriceMiddle",
      price: profitMarker.price,
      shape: "arrowUp",
      color: "rgba(34, 197, 94, 0.92)",
      text: ko.app.profitChartMarkerLabel,
      size: 1.2,
    };
    b.markers.setMarkers([m]);
  }, [profitMarker, structureKey]);

  useEffect(() => {
    if (!drawingsEnabled || drawMode !== "cursor") return;
    const b = bundleRef.current;
    if (!b || b.structureKey !== structureKey) return;

    const finishDragPersist = () => {
      persistChartDrawingSnapshot(
        drawPersistKeyRef.current,
        drawingSnapshotFromAccum(drawingAccumRef.current),
        drawLegacyKeyRef.current,
      );
    };

    const onContextMenu = (ev: MouseEvent) => {
      const bb = bundleRef.current;
      if (!bb || bb.structureKey !== structureKey) return;
      const hit = hitTestDrawings(
        bb.chart,
        bb.candle,
        ev.clientX,
        ev.clientY,
        drawingAccumRef.current.objects,
      );
      if (!hit) return;
      ev.preventDefault();
      ev.stopPropagation();
      setDrawHitMenu({ clientX: ev.clientX, clientY: ev.clientY, hit });
    };

    const beginDrawingDrag = (ev: PointerEvent, hit: DrawingHitTarget) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      if (drawDragRef.current) return;
      const bb = bundleRef.current;
      if (!bb || bb.structureKey !== structureKey) return;
      pushDrawingUndo();

      drawingSelectedIdRef.current = hit.id;
      setDrawHitMenu(null);
      drawingRayDotsHoverIdRef.current = null;
      setDrawingRayDots(null);
      const hoverId = drawingHoverIdRef.current;
      if (hoverId) {
        const ho = findDrawingById(drawingAccumRef.current, hoverId);
        if (ho) restoreDrawingRestStyle(ho);
        drawingHoverIdRef.current = null;
      }

      if (hit.kind === "ray-body") {
        const o = findDrawingById(drawingAccumRef.current, hit.id);
        if (!o || o.kind !== "ray") return;
        const raw = resolveDrawPointFromClient(
          ev.clientX,
          ev.clientY,
          bb.chart,
          bb.candle,
        );
        if (!raw) return;
        const pt = snapDrawPointMagnet(
          bb.chart,
          bb.candle,
          ev.clientX,
          ev.clientY,
          raw,
          magnetEnabledRef.current,
        );
        const ts = bb.chart.timeScale();
        const iA0 = ts.timeToIndex(o.anchorTime, true);
        const iT0 = ts.timeToIndex(o.throughTime, true);
        if (iA0 == null || iT0 == null) return;
        const dLog = (iT0 as number) - (iA0 as number);
        const dVal = o.throughValue - o.anchorValue;
        drawDragRef.current = {
          pointerId: ev.pointerId,
          id: hit.id,
          role: "ray-body",
          rayBody: {
            startRaw: { time: pt.time, price: pt.price },
            dLog,
            dVal,
          },
        };
      } else {
        const role: "hline" | "ray-anchor" | "ray-through" =
          hit.kind === "hline"
            ? "hline"
            : hit.kind === "ray-anchor"
              ? "ray-anchor"
              : "ray-through";

        drawDragRef.current = {
          pointerId: ev.pointerId,
          id: hit.id,
          role,
        };
      }

      const onMove = (e: PointerEvent) => {
        const d = drawDragRef.current;
        if (!d || e.pointerId !== d.pointerId) return;
        const br = bundleRef.current;
        if (!br || br.structureKey !== structureKey) return;
        const raw = resolveDrawPointFromClient(
          e.clientX,
          e.clientY,
          br.chart,
          br.candle,
        );
        if (!raw) return;
        const o = drawingAccumRef.current.objects.find((x) => x.id === d.id);
        if (!o) return;
        const pt =
          d.role === "ray-through" && o.kind === "ray"
            ? raw
            : snapDrawPointMagnet(
                br.chart,
                br.candle,
                e.clientX,
                e.clientY,
                raw,
                magnetEnabledRef.current,
              );

        if (d.role === "ray-body" && d.rayBody && o.kind === "ray") {
          const rb = d.rayBody;
          const ts = br.chart.timeScale();
          const n = br.candle.data().length;
          if (n < 1) return;
          const last = n - 1;
          const idxC = ts.timeToIndex(pt.time, true);
          if (idxC == null) return;
          let iA = Math.round(idxC as number);
          iA = Math.max(0, Math.min(last, iA));
          const iT = iA + rb.dLog;
          const slope = Math.abs(rb.dLog) < 1e-12 ? 0 : rb.dVal / rb.dLog;
          o.anchorValue = pt.price;
          const barA = br.candle.dataByIndex(iA, MismatchDirection.NearestLeft);
          if (!barA) return;
          o.anchorTime = barA.time as Time;
          if (iT > last) {
            const farT = extrapolateTimeBeyondLast(br.candle, last, iT);
            if (!farT) return;
            o.throughTime = farT;
            o.throughValue = o.anchorValue + rb.dVal;
          } else if (iT < 0) {
            const bar0 = br.candle.dataByIndex(0, MismatchDirection.NearestLeft);
            if (!bar0) return;
            o.throughTime = bar0.time as Time;
            o.throughValue = o.anchorValue + slope * (0 - iA);
          } else {
            const iTr = Math.max(0, Math.min(last, Math.round(iT)));
            const barT = br.candle.dataByIndex(iTr, MismatchDirection.NearestLeft);
            if (!barT) return;
            o.throughTime = barT.time as Time;
            o.throughValue = o.anchorValue + slope * (iTr - iA);
          }
          refreshRaySeriesGeometry(br, o);
          return;
        }

        if (d.role === "hline" && o.kind === "hline") {
          o.priceLine.applyOptions({ price: pt.price });
        } else if (o.kind === "ray") {
          if (d.role === "ray-anchor") {
            o.anchorTime = pt.time;
            o.anchorValue = pt.price;
          } else if (d.role === "ray-through") {
            o.throughTime = pt.time;
            o.throughValue = pt.price;
          }
          refreshRaySeriesGeometry(br, o);
        }
      };

      const onUp = (e: PointerEvent) => {
        const d = drawDragRef.current;
        if (!d || e.pointerId !== d.pointerId) return;
        drawDragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        finishDragPersist();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      ev.preventDefault();
      ev.stopPropagation();
    };

    const onChartPointerDown = (ev: PointerEvent) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      if (drawDragRef.current) return;
      const bb = bundleRef.current;
      if (!bb || bb.structureKey !== structureKey) return;
      const hit = hitTestDrawings(
        bb.chart,
        bb.candle,
        ev.clientX,
        ev.clientY,
        drawingAccumRef.current.objects,
      );
      if (!hit) {
        drawingSelectedIdRef.current = null;
        return;
      }
      beginDrawingDrag(ev, hit);
    };

    beginDrawingDragRef.current = beginDrawingDrag;

    const chartEl = b.chart.chartElement();
    chartEl.addEventListener("contextmenu", onContextMenu);
    chartEl.addEventListener("pointerdown", onChartPointerDown, true);

    return () => {
      beginDrawingDragRef.current = null;
      chartEl.removeEventListener("contextmenu", onContextMenu);
      chartEl.removeEventListener("pointerdown", onChartPointerDown, true);
    };
  }, [drawingsEnabled, drawMode, structureKey, pushDrawingUndo]);

  useEffect(() => {
    if (!drawingsEnabled || drawMode !== "cursor") {
      const br = bundleRef.current;
      const id = drawingHoverIdRef.current;
      if (br && id) {
        const o = findDrawingById(drawingAccumRef.current, id);
        if (o) restoreDrawingRestStyle(o);
      }
      drawingHoverIdRef.current = null;
      drawingRayDotsHoverIdRef.current = null;
      setDrawingRayDots(null);
      return;
    }
    const b = bundleRef.current;
    if (!b || b.structureKey !== structureKey) return;
    const chartEl = b.chart.chartElement();
    const hoverRef = drawingHoverIdRef;

    const clearHover = () => {
      const prev = hoverRef.current;
      if (!prev) return;
      const bb = bundleRef.current;
      if (!bb || bb.structureKey !== structureKey) {
        hoverRef.current = null;
        return;
      }
      const o = findDrawingById(drawingAccumRef.current, prev);
      if (o) restoreDrawingRestStyle(o);
      hoverRef.current = null;
    };

    const onHoverMove = (ev: PointerEvent) => {
      if (drawDragRef.current) return;
      if (drawMenuRef.current?.contains(ev.target as Node)) return;
      const bb = bundleRef.current;
      if (!bb || bb.structureKey !== structureKey) return;
      const hit = hitTestDrawings(
        bb.chart,
        bb.candle,
        ev.clientX,
        ev.clientY,
        drawingAccumRef.current.objects,
      );
      if (!hit) {
        clearHover();
        drawingRayDotsHoverIdRef.current = null;
        setDrawingRayDots(null);
        return;
      }
      const o = findDrawingById(drawingAccumRef.current, hit.id);
      if (!o) {
        clearHover();
        drawingRayDotsHoverIdRef.current = null;
        setDrawingRayDots(null);
        return;
      }
      const nextId = hit.id;
      if (nextId !== hoverRef.current) {
        clearHover();
        applyDrawingHoverStyle(o);
        hoverRef.current = nextId;
      }
      if (o.kind === "ray") {
        const pos = rayAnchorThroughClientPositions(bb.chart, bb.candle, o);
        if (pos) {
          drawingRayDotsHoverIdRef.current = o.id;
          setDrawingRayDots({ id: o.id, ...pos });
        } else {
          drawingRayDotsHoverIdRef.current = null;
          setDrawingRayDots(null);
        }
      } else {
        drawingRayDotsHoverIdRef.current = null;
        setDrawingRayDots(null);
      }
    };

    const onHoverLeave = () => {
      clearHover();
      drawingRayDotsHoverIdRef.current = null;
      setDrawingRayDots(null);
    };

    chartEl.addEventListener("pointermove", onHoverMove);
    chartEl.addEventListener("pointerleave", onHoverLeave);
    return () => {
      chartEl.removeEventListener("pointermove", onHoverMove);
      chartEl.removeEventListener("pointerleave", onHoverLeave);
      clearHover();
      drawingRayDotsHoverIdRef.current = null;
      setDrawingRayDots(null);
    };
  }, [drawingsEnabled, drawMode, structureKey]);

  useEffect(() => {
    if (!drawHitMenu) return;
    const onDocPointerDown = (ev: PointerEvent) => {
      if (ev.button === 2) return;
      if (drawMenuRef.current?.contains(ev.target as Node)) return;
      setDrawHitMenu(null);
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onDocPointerDown, true);
  }, [drawHitMenu]);

  useEffect(() => {
    if (drawMode !== "ray") {
      drawingAccumRef.current.rayDraft = null;
      setRayDraftForPreview(null);
      const br = bundleRef.current;
      const pv = rayPreviewLineRef.current;
      if (br && pv) {
        try {
          br.chart.removeSeries(pv);
        } catch {
          /* ignore */
        }
        rayPreviewLineRef.current = null;
      }
    }
  }, [drawMode]);

  useEffect(() => {
    if (!drawingsEnabled || drawMode !== "hline") {
      const br = bundleRef.current;
      const pl = hlinePreviewPlRef.current;
      if (br?.candle && pl) {
        try {
          br.candle.removePriceLine(pl);
        } catch {
          /* ignore */
        }
        hlinePreviewPlRef.current = null;
      }
      return;
    }
    const b = bundleRef.current;
    if (!b || b.structureKey !== structureKey) return;
    const chartEl = b.chart.chartElement();
    const paint = (ev: PointerEvent) => {
      const raw = resolveDrawPointFromClient(
        ev.clientX,
        ev.clientY,
        b.chart,
        b.candle,
      );
      if (!raw) return;
      const pt = snapDrawPointMagnet(
        b.chart,
        b.candle,
        ev.clientX,
        ev.clientY,
        raw,
        magnetEnabled,
      );
      if (!hlinePreviewPlRef.current) {
        hlinePreviewPlRef.current = b.candle.createPriceLine({
          price: pt.price,
          color: DRAW_HLINE_PREVIEW.color,
          lineWidth: DRAW_HLINE_PREVIEW.lineWidth,
          lineStyle: DRAW_HLINE_PREVIEW.lineStyle,
          axisLabelVisible: DRAW_HLINE_PREVIEW.axisLabelVisible,
          title: DRAW_HLINE_PREVIEW.title,
        });
      } else {
        hlinePreviewPlRef.current.applyOptions({ price: pt.price });
      }
    };
    chartEl.addEventListener("pointermove", paint);
    return () => {
      chartEl.removeEventListener("pointermove", paint);
    };
  }, [drawingsEnabled, drawMode, structureKey, magnetEnabled]);

  useEffect(() => {
    if (!drawingsEnabled) return;
    const b = bundleRef.current;
    if (!b || b.structureKey !== structureKey) return;
    const ch = b.chart;
    const onRange = () => {
      const br = bundleRef.current;
      if (!br || br.structureKey !== structureKey) return;
      for (const o of drawingAccumRef.current.objects) {
        if (o.kind === "ray") refreshRaySeriesGeometry(br, o);
      }
      const rid = drawingRayDotsHoverIdRef.current;
      if (!rid) return;
      const ro = findDrawingById(drawingAccumRef.current, rid);
      if (!ro || ro.kind !== "ray") {
        drawingRayDotsHoverIdRef.current = null;
        setDrawingRayDots(null);
        return;
      }
      const pos = rayAnchorThroughClientPositions(br.chart, br.candle, ro);
      if (pos) setDrawingRayDots({ id: ro.id, ...pos });
    };
    ch.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () =>
      ch.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
  }, [drawingsEnabled, structureKey]);

  useEffect(() => {
    if (!drawingsEnabled || drawMode !== "ray" || rayDraftForPreview == null) {
      const br = bundleRef.current;
      const pv = rayPreviewLineRef.current;
      if (br && pv) {
        try {
          br.chart.removeSeries(pv);
        } catch {
          /* ignore */
        }
        rayPreviewLineRef.current = null;
      }
      return;
    }
    const b = bundleRef.current;
    if (!b || b.structureKey !== structureKey) return;
    const chart = b.chart;
    const chartEl = chart.chartElement();

    const paintFromClient = (clientX: number, clientY: number) => {
      const draft = drawingAccumRef.current.rayDraft;
      if (!draft) return;
      const raw = resolveDrawPointFromClient(clientX, clientY, chart, b.candle);
      if (!raw) return;
      const pts = rayPreviewChordFromDraftAndPointer(b.candle, draft, raw);
      if (pts.length < 2) return;
      if (!rayPreviewLineRef.current) {
        rayPreviewLineRef.current = chart.addSeries(
          LineSeries,
          {
            color: DRAW_RAY_PREVIEW,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          0,
        );
      }
      rayPreviewLineRef.current.setData(toLineData(pts));
    };

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      if (param.point === undefined) return;
      const br = bundleRef.current;
      if (!br || br.chart !== chart || br.structureKey !== structureKey) return;
      const pane = chart.panes()[0]?.getHTMLElement();
      if (!pane) return;
      const pr = pane.getBoundingClientRect();
      paintFromClient(pr.left + param.point.x, pr.top + param.point.y);
    };

    chart.subscribeCrosshairMove(onCrosshairMove);

    const paint = (ev: PointerEvent) => {
      paintFromClient(ev.clientX, ev.clientY);
    };

    chartEl.addEventListener("pointermove", paint);
    return () => {
      chartEl.removeEventListener("pointermove", paint);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
    };
  }, [drawingsEnabled, drawMode, rayDraftForPreview, structureKey]);

  useEffect(() => {
    if (!drawHitMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawHitMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawHitMenu]);

  useEffect(() => {
    if (!drawingsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!chartDrawAreaPointerInsideRef.current) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      const br = bundleRef.current;
      if (!br || br.structureKey !== structureKey) return;

      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        drawUndo();
        return;
      }
      if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        drawRedo();
        return;
      }
      if (key !== "c" && key !== "v") return;

      if (key === "c") {
        const id = drawingSelectedIdRef.current;
        if (!id) return;
        const o = findDrawingById(drawingAccumRef.current, id);
        if (!o) return;
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard.writeText(serializeDrawingForClipboard(o));
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard.readText().then(
        (text) => {
          const br2 = bundleRef.current;
          if (!br2 || br2.structureKey !== structureKey) return;
          const payload = tryParseClipboardDrawing(text.trim());
          if (!payload) return;
          const snapBeforePaste = cloneDrawingSnapshot(
            drawingSnapshotFromAccum(drawingAccumRef.current),
          );
          if (
            !appendDrawingFromClipboardPayload(
              br2,
              drawingAccumRef.current,
              payload,
            )
          ) {
            return;
          }
          const u = drawingUndoStackRef.current;
          u.push(snapBeforePaste);
          while (u.length > DRAWING_UNDO_MAX) u.shift();
          drawingRedoStackRef.current = [];
          persistChartDrawingSnapshot(
            drawPersistKeyRef.current,
            drawingSnapshotFromAccum(drawingAccumRef.current),
            drawLegacyKeyRef.current,
          );
        },
        () => {
          /* 읽기 권한 거부 */
        },
      );
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawingsEnabled, structureKey, drawUndo, drawRedo]);

  /** 같은 차트에서 캔들만 갱신 — DOM·차트 인스턴스 유지 */
  useEffect(() => {
    const b = bundleRef.current;
    if (!b || b.structureKey !== structureKey || candles.length === 0) return;

    const structureChanged =
      prevStructureKeyForStreamRef.current !== structureKey;
    prevStructureKeyForStreamRef.current = structureKey;

    const prev = prevCandlesForStreamRef.current;
    const stream =
      !structureChanged &&
      prev.length > 0 &&
      !overlays.ichimoku &&
      canStreamCandleUpdate(prev, candles);

    if (stream) {
      applyCandleDataStreamed(b, candles, dailyCandles, interval, overlays);
    } else {
      applyCandleData(b, candles, dailyCandles, interval, overlays);
      if (drawingsEnabled) {
        resetAndHydratePersistedDrawings(
          b,
          fitKey,
          interval,
          drawingAccumRef.current,
        );
      }
    }
    prevCandlesForStreamRef.current = candles;
    /* overlays 객체 참조가 부모 매 렌더마다 바뀌면(인라인 {}) 매초 전체 재적용 → UI 멈춤 방지 */
  }, [
    candles,
    dailyCandles,
    fitKey,
    structureKey,
    interval,
    overlays.ma,
    overlays.ichimoku,
    overlays.volume,
    overlays.rsi,
    drawingsEnabled,
    drawingPersistKey,
  ]);

  return (
    <div
      ref={wrapRef}
      className={
        drawingsEnabled
          ? "chart-canvas-wrap chart-canvas-wrap--draw"
          : "chart-canvas-wrap"
      }
    >
      {showBuiltinDrawToolbar && (
        <>
          <ChartDrawToolbarButtons
            drawMode={drawMode}
            onDrawModeChange={setDrawMode}
            onClearAll={clearAllDrawings}
            magnetEnabled={magnetEnabled}
            onMagnetChange={setMagnetEnabled}
          />
          <div className="chart-draw-persist-hint" role="note">
            {ko.crypto.drawPersistHint}
          </div>
        </>
      )}
      {drawingsEnabled && !showBuiltinDrawToolbar && (
        <div className="chart-draw-persist-hint" role="note">
          {ko.crypto.drawPersistHint}
        </div>
      )}
      {drawingsEnabled && drawHitMenu ? (
        <div
          ref={drawMenuRef}
          className="chart-draw-hit-menu"
          role="menu"
          style={{
            position: "fixed",
            left: Math.min(drawHitMenu.clientX + 10, window.innerWidth - 156),
            top: Math.min(drawHitMenu.clientY + 10, window.innerHeight - 132),
            zIndex: 80,
          }}
        >
          <button
            type="button"
            className="chart-draw-hit-menu__btn"
            onClick={() => {
              const br = bundleRef.current;
              if (!br) return;
              pushDrawingUndo();
              removeDrawingById(
                br,
                drawingAccumRef.current,
                drawHitMenu.hit.id,
              );
              persistChartDrawingSnapshot(
                drawPersistKeyRef.current,
                drawingSnapshotFromAccum(drawingAccumRef.current),
                drawLegacyKeyRef.current,
              );
              setDrawHitMenu(null);
            }}
          >
            {ko.crypto.chartDrawDelete}
          </button>
          <button
            type="button"
            className="chart-draw-hit-menu__btn"
            onClick={() => {
              const br = bundleRef.current;
              if (!br) return;
              const src = drawingAccumRef.current.objects.find(
                (o) => o.id === drawHitMenu.hit.id,
              );
              if (!src) return;
              pushDrawingUndo();
              duplicateDrawingVariant(br, drawingAccumRef.current, src, "copy");
              persistChartDrawingSnapshot(
                drawPersistKeyRef.current,
                drawingSnapshotFromAccum(drawingAccumRef.current),
                drawLegacyKeyRef.current,
              );
              setDrawHitMenu(null);
            }}
          >
            {ko.crypto.chartDrawCopy}
          </button>
          <button
            type="button"
            className="chart-draw-hit-menu__btn"
            onClick={() => {
              const br = bundleRef.current;
              if (!br) return;
              const src = drawingAccumRef.current.objects.find(
                (o) => o.id === drawHitMenu.hit.id,
              );
              if (!src) return;
              pushDrawingUndo();
              duplicateDrawingVariant(br, drawingAccumRef.current, src, "add");
              persistChartDrawingSnapshot(
                drawPersistKeyRef.current,
                drawingSnapshotFromAccum(drawingAccumRef.current),
                drawLegacyKeyRef.current,
              );
              setDrawHitMenu(null);
            }}
          >
            {ko.crypto.chartDrawAdd}
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="chart-canvas"
        onPointerEnter={() => {
          if (drawingsEnabled) chartDrawAreaPointerInsideRef.current = true;
        }}
        onPointerLeave={() => {
          chartDrawAreaPointerInsideRef.current = false;
        }}
      />
      {drawingRayDots && drawMode === "cursor" && drawingsEnabled ? (
        <>
          <span
            className="chart-draw-ray-dot-wrap"
            style={{
              position: "fixed",
              left: drawingRayDots.ax - 14,
              top: drawingRayDots.ay - 14,
              zIndex: 94,
              pointerEvents: "none",
            }}
            aria-hidden
          >
            <span className="chart-draw-ray-dot" />
          </span>
          <span
            className="chart-draw-ray-dot-wrap chart-draw-ray-dot-wrap--through"
            style={{
              position: "fixed",
              left: drawingRayDots.tx - 14,
              top: drawingRayDots.ty - 14,
              zIndex: 95,
              pointerEvents: "none",
            }}
            aria-hidden
          >
            <span className="chart-draw-ray-dot chart-draw-ray-dot--through" />
          </span>
          <button
            type="button"
            className="chart-draw-ray-handle"
            aria-label={ko.crypto.chartDrawRayHandleAnchor}
            style={{
              position: "fixed",
              left: drawingRayDots.ax - 14,
              top: drawingRayDots.ay - 14,
              zIndex: 96,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const fn = beginDrawingDragRef.current;
              if (!fn) return;
              fn(e.nativeEvent, {
                kind: "ray-anchor",
                id: drawingRayDots.id,
              });
            }}
          />
          <button
            type="button"
            className="chart-draw-ray-handle"
            aria-label={ko.crypto.chartDrawRayHandleThrough}
            style={{
              position: "fixed",
              left: drawingRayDots.tx - 14,
              top: drawingRayDots.ty - 14,
              zIndex: 97,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const fn = beginDrawingDragRef.current;
              if (!fn) return;
              fn(e.nativeEvent, {
                kind: "ray-through",
                id: drawingRayDots.id,
              });
            }}
          />
        </>
      ) : null}
    </div>
  );
}
