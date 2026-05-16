import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type BarData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
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
  getChartDrawingSnapshot,
  persistChartDrawingSnapshot,
  type ChartDrawingSnapshotV1,
} from "../lib/userPersist";
import { ko } from "../i18n/ko";
import type { Candle, ChartTime } from "../types";

const KST = "Asia/Seoul";

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
  /** 수평선·추세선 등 간단 드로잉(TradingView 수준은 아님) */
  drawingsEnabled?: boolean;
}

type DrawMode = "cursor" | "hline" | "trend";

type DrawingAccum = {
  priceLines: IPriceLine[];
  trends: ISeriesApi<"Line">[];
  trendDraft: { time: Time; value: number } | null;
};

function timeSortKey(t: Time): number {
  if (typeof t === "number") return t;
  if (typeof t === "string") return Date.parse(t) / 1000 || 0;
  return Date.UTC(t.year, t.month - 1, t.day) / 1000;
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

/** 차트 위젯 기준 X → logical index (휠 앵커) */
function anchorLogicalAtClientX(
  chart: IChartApi,
  clientX: number,
  lr: { from: number; to: number },
): number {
  const box = chart.chartElement().getBoundingClientRect();
  const x = clientX - box.left;
  const log = chart.timeScale().coordinateToLogical(x);
  if (log == null || !Number.isFinite(log as number)) {
    return (lr.from + lr.to) / 2;
  }
  const anchor = log as number;
  const lo = Math.min(lr.from, lr.to);
  const hi = Math.max(lr.from, lr.to);
  return Math.max(lo, Math.min(hi, anchor));
}

/** subscribeClick에서 시세·시간 추출 (봉 밖 클릭 등은 point로 보완) */
function extractClickTimeAndPrice(
  param: MouseEventParams,
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
): { time: Time; price: number } | null {
  if (param.paneIndex !== undefined && param.paneIndex !== 0) {
    return null;
  }

  const raw = param.seriesData.get(candle);
  let price: number | undefined;
  if (raw && typeof (raw as BarData<Time>).close === "number") {
    price = (raw as BarData<Time>).close;
  }

  let time: Time | undefined = param.time;

  const pt = param.point;
  if (pt) {
    const y = pt.y as unknown as number;
    const x = pt.x as unknown as number;
    if (price == null) {
      const p = candle.coordinateToPrice(y);
      if (p != null && Number.isFinite(p as number)) {
        price = p as number;
      }
    }
    if (time == null) {
      const t = chart.timeScale().coordinateToTime(x);
      if (t != null) time = t;
    }
  }

  if (time == null || price == null || !Number.isFinite(price)) {
    return null;
  }
  return { time, price };
}

interface ChartSeriesBundle {
  structureKey: string;
  chart: IChartApi;
  candle: ISeriesApi<"Candlestick">;
  ma20: ISeriesApi<"Line"> | null;
  ma50: ISeriesApi<"Line"> | null;
  ichimoku: ISeriesApi<"Line">[] | null;
  ichimokuCloud: ISeriesApi<"Candlestick"> | null;
  volume: ISeriesApi<"Histogram"> | null;
  rsi: ISeriesApi<"Line"> | null;
}

function drawingSnapshotFromAccum(
  acc: DrawingAccum,
): ChartDrawingSnapshotV1 {
  const hlines = acc.priceLines.map((pl) => ({
    price: pl.options().price as number,
  }));
  const trends: ChartDrawingSnapshotV1["trends"] = [];
  for (const ser of acc.trends) {
    const d = ser.data() as LineData<Time>[];
    if (d.length < 2) continue;
    const p0 = d[0]!;
    const p1 = d[1]!;
    trends.push({
      t1: p0.time as ChartTime,
      v1: p0.value,
      t2: p1.time as ChartTime,
      v2: p1.value,
    });
  }
  return { version: 1, hlines, trends };
}

function hydrateDrawingsFromSnapshot(
  b: ChartSeriesBundle,
  snap: ChartDrawingSnapshotV1,
  acc: DrawingAccum,
): void {
  for (const h of snap.hlines) {
    if (!Number.isFinite(h.price)) continue;
    const pl = b.candle.createPriceLine({
      price: h.price,
      color: "rgba(94, 234, 212, 0.9)",
      lineWidth: 1,
      axisLabelVisible: true,
      title: "",
    });
    acc.priceLines.push(pl);
  }
  for (const t of snap.trends) {
    const line = b.chart.addSeries(LineSeries, {
      color: "rgba(251, 191, 36, 0.9)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    line.setData(
      toLineData([
        { time: t.t1, value: t.v1 },
        { time: t.t2, value: t.v2 },
      ]),
    );
    acc.trends.push(line);
  }
}

/** `candle.setData` 등 전체 갱신 후 차트에서 지워진 드로잉을 localStorage 기준으로 다시 붙인다 */
function resetAndHydratePersistedDrawings(
  b: ChartSeriesBundle,
  structureKey: string,
  acc: DrawingAccum,
): void {
  for (const pl of acc.priceLines) {
    try {
      b.candle.removePriceLine(pl);
    } catch {
      /* stale ref */
    }
  }
  for (const s of acc.trends) {
    try {
      b.chart.removeSeries(s);
    } catch {
      /* stale ref */
    }
  }
  acc.priceLines = [];
  acc.trends = [];
  acc.trendDraft = null;
  const snap = getChartDrawingSnapshot(structureKey);
  if (snap) hydrateDrawingsFromSnapshot(b, snap, acc);
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
  // #region agent log
  fetch("http://127.0.0.1:7253/ingest/3faa9434-a8bc-4c3a-957b-49b22bf08562", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "1be809",
    },
    body: JSON.stringify({
      sessionId: "1be809",
      hypothesisId: "H5",
      location: "StockChart.tsx:syncOverlaySeries:entry",
      message: "syncOverlaySeries entry",
      data: {
        structureKey: b.structureKey,
        n: candles.length,
        overlays: {
          ma: overlays.ma,
          ich: overlays.ichimoku,
          vol: overlays.volume,
          rsi: overlays.rsi,
        },
        hasRsiSeries: Boolean(b.rsi),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

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
      // #region agent log
      fetch("http://127.0.0.1:7253/ingest/3faa9434-a8bc-4c3a-957b-49b22bf08562", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "1be809",
        },
        body: JSON.stringify({
          sessionId: "1be809",
          hypothesisId: "H6-fix",
          location: "StockChart.tsx:syncOverlaySeries:volumeOff",
          message:
            "removeSeries only — LWC auto-removes empty pane after last series",
          data: { paneCountBefore: chart.panes().length },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
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
      // #region agent log
      fetch("http://127.0.0.1:7253/ingest/3faa9434-a8bc-4c3a-957b-49b22bf08562", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "1be809",
        },
        body: JSON.stringify({
          sessionId: "1be809",
          hypothesisId: "H6-fix",
          location: "StockChart.tsx:syncOverlaySeries:rsiOff",
          message:
            "removeSeries only — LWC auto-removes empty pane after last series",
          data: { paneCountBefore: chart.panes().length },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      chart.removeSeries(b.rsi);
      b.rsi = null;
    }
  } else if (!b.rsi) {
    const rsiPts = computeRsiLine(c);
    // #region agent log
    fetch("http://127.0.0.1:7253/ingest/3faa9434-a8bc-4c3a-957b-49b22bf08562", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "1be809",
      },
      body: JSON.stringify({
        sessionId: "1be809",
        hypothesisId: "H3",
        location: "StockChart.tsx:syncOverlaySeries:rsiOn",
        message: "rsi line points",
        data: { pointCount: rsiPts.length, paneCountBefore: chart.panes().length },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
    try {
      b.rsi.setData(toLineData(rsiPts));
    } catch (e) {
      // #region agent log
      fetch("http://127.0.0.1:7253/ingest/3faa9434-a8bc-4c3a-957b-49b22bf08562", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "1be809",
        },
        body: JSON.stringify({
          sessionId: "1be809",
          hypothesisId: "H3",
          location: "StockChart.tsx:syncOverlaySeries:rsiOn:setData",
          message: String(e),
          data: { pointCount: rsiPts.length },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      throw e;
    }
  } else {
    try {
      b.rsi.setData(toLineData(computeRsiLine(c)));
    } catch (e) {
      // #region agent log
      fetch("http://127.0.0.1:7253/ingest/3faa9434-a8bc-4c3a-957b-49b22bf08562", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "1be809",
        },
        body: JSON.stringify({
          sessionId: "1be809",
          hypothesisId: "H3",
          location: "StockChart.tsx:syncOverlaySeries:rsiUpdate:setData",
          message: String(e),
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      throw e;
    }
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
}: StockChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<ChartSeriesBundle | null>(null);
  const lastFitKeyRef = useRef("");
  const drawingAccumRef = useRef<DrawingAccum>({
    priceLines: [],
    trends: [],
    trendDraft: null,
  });
  const drawModeRef = useRef<DrawMode>("cursor");
  const [drawMode, setDrawMode] = useState<DrawMode>("cursor");
  /** 거래량·RSI 패인이 있을 때 메인 캔들 패인 세로 비율 */
  const mainPaneStretchRef = useRef(8);
  /** 보조 패인 없을 때 scaleMargins */
  const scaleMarginRef = useRef(0.12);

  const isIntraday = isIntradayInterval(interval);
  const structureKey = `${fitKey}:${interval}`;

  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const dailyCandlesRef = useRef(dailyCandles);
  dailyCandlesRef.current = dailyCandles;
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const prevCandlesForStreamRef = useRef<Candle[]>([]);
  const prevStructureKeyForStreamRef = useRef<string>("");

  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  const clearAllDrawings = useCallback(() => {
    const b = bundleRef.current;
    const acc = drawingAccumRef.current;
    if (!b) return;
    for (const pl of acc.priceLines) {
      try {
        b.candle.removePriceLine(pl);
      } catch {
        /* ignore */
      }
    }
    for (const s of acc.trends) {
      try {
        b.chart.removeSeries(s);
      } catch {
        /* ignore */
      }
    }
    acc.priceLines = [];
    acc.trends = [];
    acc.trendDraft = null;
    persistChartDrawingSnapshot(structureKey, {
      version: 1,
      hlines: [],
      trends: [],
    });
  }, [structureKey]);

  /** 심볼·타임프레임 변경 시에만 차트 인스턴스를 새로 만든다(지표 토글은 동기화만) */
  useEffect(() => {
    if (!containerRef.current) return;
    const c = candlesRef.current;
    if (c.length === 0) return;

    drawingAccumRef.current = {
      priceLines: [],
      trends: [],
      trendDraft: null,
    };

    const chart = createChart(containerRef.current, {
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

    const bundle: ChartSeriesBundle = {
      structureKey,
      chart,
      candle: candleSeries,
      ma20: null,
      ma50: null,
      ichimoku: null,
      ichimokuCloud: null,
      volume: null,
      rsi: null,
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

    return () => {
      chart.remove();
      bundleRef.current = null;
    };
  }, [structureKey, drawingsEnabled]);

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
      const maxSpan = Math.max(minBars, n + 2);
      const zoomIn = ev.deltaY < 0;
      let newSpan = span * (zoomIn ? 0.9 : 1.1);
      newSpan = Math.min(maxSpan, Math.max(minBars, newSpan));

      const anchorLogical = anchorLogicalAtClientX(b.chart, ev.clientX, lr);
      const t = (anchorLogical - lr.from) / span;
      let from = anchorLogical - t * newSpan;
      let to = from + newSpan;
      const maxR = Math.max(minBars, n - 1 + 0.999);
      if (to > maxR) {
        const sh = to - maxR;
        to -= sh;
        from -= sh;
      }
      if (from < 0) {
        const sh = -from;
        from += sh;
        to += sh;
      }
      if (to - from < minBars) {
        to = from + minBars;
      }
      to = Math.min(maxR, to);
      from = Math.max(0, from);
      if (to - from < minBars) {
        from = Math.max(0, to - minBars);
      }
      b.chart.timeScale().setVisibleLogicalRange({ from, to });
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, true);
  }, [structureKey]);

  useEffect(() => {
    if (!drawingsEnabled) return;
    const b = bundleRef.current;
    if (!b) return;
    const handler = (param: MouseEventParams) => {
      const mode = drawModeRef.current;
      if (mode === "cursor") return;

      const candleB = bundleRef.current?.candle;
      const chartB = bundleRef.current?.chart;
      if (!candleB || !chartB) return;

      const resolved = extractClickTimeAndPrice(param, chartB, candleB);
      if (!resolved) return;
      const { time, price } = resolved;

      const acc = drawingAccumRef.current;
      if (mode === "hline") {
        const pl = candleB.createPriceLine({
          price,
          color: "rgba(94, 234, 212, 0.9)",
          lineWidth: 1,
          axisLabelVisible: true,
          title: "",
        });
        acc.priceLines.push(pl);
        persistChartDrawingSnapshot(
          structureKey,
          drawingSnapshotFromAccum(acc),
        );
        return;
      }
      if (mode === "trend") {
        if (!acc.trendDraft) {
          acc.trendDraft = { time, value: price };
          return;
        }
        const a = acc.trendDraft;
        acc.trendDraft = null;
        let t1 = a.time;
        let v1 = a.value;
        let t2 = time;
        let v2 = price;
        if (timeSortKey(t2) < timeSortKey(t1)) {
          const tmpT = t1;
          t1 = t2;
          t2 = tmpT;
          const tmpV = v1;
          v1 = v2;
          v2 = tmpV;
        }
        const line = chartB.addSeries(LineSeries, {
          color: "rgba(251, 191, 36, 0.9)",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        line.setData(
          toLineData([
            { time: t1 as ChartTime, value: v1 },
            { time: t2 as ChartTime, value: v2 },
          ]),
        );
        acc.trends.push(line);
        persistChartDrawingSnapshot(
          structureKey,
          drawingSnapshotFromAccum(acc),
        );
      }
    };
    b.chart.subscribeClick(handler);
    return () => {
      b.chart.unsubscribeClick(handler);
    };
  }, [drawingsEnabled, structureKey, candles.length]);

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
        resetAndHydratePersistedDrawings(b, structureKey, drawingAccumRef.current);
      }
    }
    prevCandlesForStreamRef.current = candles;
  }, [candles, dailyCandles, structureKey, interval, overlays, drawingsEnabled]);

  return (
    <div
      ref={wrapRef}
      className={
        drawingsEnabled
          ? "chart-canvas-wrap chart-canvas-wrap--draw"
          : "chart-canvas-wrap"
      }
    >
      {drawingsEnabled && (
        <div
          className="chart-draw-toolbar"
          role="toolbar"
          aria-label={ko.crypto.drawToolbarAria}
        >
          <button
            type="button"
            className={
              drawMode === "cursor"
                ? "chart-draw-btn chart-draw-btn--active"
                : "chart-draw-btn"
            }
            onClick={() => setDrawMode("cursor")}
          >
            {ko.crypto.drawCursor}
          </button>
          <button
            type="button"
            className={
              drawMode === "hline"
                ? "chart-draw-btn chart-draw-btn--active"
                : "chart-draw-btn"
            }
            onClick={() => setDrawMode("hline")}
          >
            {ko.crypto.drawHLine}
          </button>
          <button
            type="button"
            className={
              drawMode === "trend"
                ? "chart-draw-btn chart-draw-btn--active"
                : "chart-draw-btn"
            }
            onClick={() => setDrawMode("trend")}
          >
            {ko.crypto.drawTrend}
          </button>
          <button type="button" className="chart-draw-btn" onClick={clearAllDrawings}>
            {ko.crypto.drawClear}
          </button>
        </div>
      )}
      {drawingsEnabled && (
        <div
          className="chart-draw-persist-hint"
          role="note"
        >
          {ko.crypto.drawPersistHint}
        </div>
      )}
      <div ref={containerRef} className="chart-canvas" />
    </div>
  );
}
