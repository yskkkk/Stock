/**
 * 브라우저 localStorage에 사용자 단위(익명 ID)로 상태를 보존합니다.
 * — 서버 로그인 없이 동일 PC·동일 브라우저 프로필에서만 유지됩니다.
 */

import type { ChartTime } from "../types";

const STORAGE_KEY = "stock-chart-app-v1";

/** 앱 차트(수평선·추세선) 직렬화 — `StockChart`의 structureKey(`fitKey:interval`)별 */
export interface ChartDrawingSnapshotV1 {
  version: 1;
  hlines: { price: number }[];
  trends: Array<{
    t1: ChartTime;
    v1: number;
    t2: ChartTime;
    v2: number;
  }>;
}

export interface PersistedV1 {
  version: 1;
  /** 익명 사용자 구분자(추후 서버 연동·지원용) */
  userId: string;
  /** 종목 심볼(대문자) → 가정 매수가 */
  profitBySymbol: Record<string, { entry: number; updatedAt: number }>;
  /** 차트 드로잉: 키는 `symbol:timeframe:interval` 형태(structureKey) */
  chartDrawings: Record<string, ChartDrawingSnapshotV1>;
}

function newUserId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `u-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function emptyState(): PersistedV1 {
  return {
    version: 1,
    userId: newUserId(),
    profitBySymbol: {},
    chartDrawings: {},
  };
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function normalizeDrawingSnapshot(
  raw: unknown,
): ChartDrawingSnapshotV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { version?: unknown; hlines?: unknown; trends?: unknown };
  if (o.version !== 1) return null;
  const hlines: ChartDrawingSnapshotV1["hlines"] = [];
  if (Array.isArray(o.hlines)) {
    for (const row of o.hlines) {
      if (row && typeof row === "object" && isFiniteNum((row as { price?: unknown }).price)) {
        hlines.push({ price: (row as { price: number }).price });
      }
    }
  }
  const trends: ChartDrawingSnapshotV1["trends"] = [];
  if (Array.isArray(o.trends)) {
    for (const row of o.trends) {
      if (!row || typeof row !== "object") continue;
      const r = row as {
        t1?: ChartTime;
        v1?: unknown;
        t2?: ChartTime;
        v2?: unknown;
      };
      if (
        r.t1 == null ||
        r.t2 == null ||
        !isFiniteNum(r.v1) ||
        !isFiniteNum(r.v2)
      ) {
        continue;
      }
      trends.push({ t1: r.t1, v1: r.v1, t2: r.t2, v2: r.v2 });
    }
  }
  return { version: 1, hlines, trends };
}

export function loadPersisted(): PersistedV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = emptyState();
      writePersisted(fresh);
      return fresh;
    }
    const p = JSON.parse(raw) as Partial<PersistedV1>;
    if (!p || typeof p !== "object") {
      const fresh = emptyState();
      writePersisted(fresh);
      return fresh;
    }
    const profitBySymbol =
      p.profitBySymbol && typeof p.profitBySymbol === "object"
        ? { ...p.profitBySymbol }
        : {};
    const chartDrawingsRaw =
      (p as { chartDrawings?: unknown }).chartDrawings &&
      typeof (p as { chartDrawings?: unknown }).chartDrawings === "object"
        ? { ...(p as { chartDrawings: Record<string, unknown> }).chartDrawings }
        : {};
    const chartDrawings: Record<string, ChartDrawingSnapshotV1> = {};
    for (const [k, v] of Object.entries(chartDrawingsRaw)) {
      const norm = normalizeDrawingSnapshot(v);
      if (norm && (norm.hlines.length > 0 || norm.trends.length > 0)) {
        chartDrawings[k] = norm;
      }
    }
    const userId =
      typeof p.userId === "string" && p.userId.length > 0
        ? p.userId
        : newUserId();
    const merged: PersistedV1 = {
      version: 1,
      userId,
      profitBySymbol,
      chartDrawings,
    };
    if (merged.userId !== p.userId || !(p as { chartDrawings?: unknown }).chartDrawings) {
      writePersisted(merged);
    }
    return merged;
  } catch {
    const fresh = emptyState();
    try {
      writePersisted(fresh);
    } catch {
      /* ignore */
    }
    return fresh;
  }
}

export function writePersisted(data: PersistedV1): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** 이 브라우저에 할당된 익명 ID */
export function getBrowserUserId(): string {
  return loadPersisted().userId;
}

export function getPersistedProfitEntry(symbol: string): number | null {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const row = loadPersisted().profitBySymbol[sym];
  if (!row || typeof row.entry !== "number" || !(row.entry > 0)) return null;
  return row.entry;
}

export function persistProfitEntry(symbol: string, entry: number | null): void {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  try {
    const state = loadPersisted();
    if (entry == null || !Number.isFinite(entry) || entry <= 0) {
      delete state.profitBySymbol[sym];
    } else {
      state.profitBySymbol[sym] = { entry, updatedAt: Date.now() };
    }
    writePersisted(state);
  } catch {
    /* quota, private mode */
  }
}

/** 저장된 앱 차트 드로잉(해당 structureKey) */
export function getChartDrawingSnapshot(
  structureKey: string,
): ChartDrawingSnapshotV1 | null {
  if (!structureKey) return null;
  try {
    const raw = loadPersisted().chartDrawings[structureKey];
    const norm = normalizeDrawingSnapshot(raw);
    if (!norm || (!norm.hlines.length && !norm.trends.length)) return null;
    return norm;
  } catch {
    return null;
  }
}

/** 앱 차트 드로잉 저장(빈 스냅샷이면 키 제거) */
export function persistChartDrawingSnapshot(
  structureKey: string,
  snap: ChartDrawingSnapshotV1,
): void {
  if (!structureKey) return;
  try {
    const state = loadPersisted();
    if (!snap.hlines.length && !snap.trends.length) {
      delete state.chartDrawings[structureKey];
    } else {
      state.chartDrawings[structureKey] = {
        version: 1,
        hlines: snap.hlines,
        trends: snap.trends,
      };
    }
    writePersisted(state);
  } catch {
    /* quota */
  }
}
