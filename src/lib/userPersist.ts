/**
 * 브라우저 localStorage에 사용자 단위(익명 ID)로 상태를 보존합니다.
 * — 서버 로그인 없이 동일 PC·동일 브라우저 프로필에서만 유지됩니다.
 */

import type { ChartTime } from "../types";

const STORAGE_KEY = "stock-chart-app-v1";

/** 수익 모델 한 종목 행 */
export interface ProfitRowV1 {
  entry: number;
  updatedAt: number;
  /** 매수 시각(ms) — 차트 마커용 */
  entryAtMs?: number;
  /** 매도가(기록 시) */
  exit?: number;
  exitAtMs?: number;
}

/** 앱 차트(수평선·광선) 직렬화 */
export interface ChartDrawingSnapshotV1 {
  version: 1;
  hlines: Array<{ id?: string; price: number }>;
  rays: Array<{
    id?: string;
    t1: ChartTime;
    v1: number;
    t2: ChartTime;
    v2: number;
    /** `timeToIndex(t2)-timeToIndex(t1)` — 줌과 무관한 광선 방향 */
    logicalDelta?: number;
  }>;
}

export interface PersistedV1 {
  version: 1;
  /** 익명 사용자 구분자(추후 서버 연동·지원용) */
  userId: string;
  /** 종목 심볼(대문자) → 수익 모델 */
  profitBySymbol: Record<string, ProfitRowV1>;
  /** 차트 드로잉: 키는 심볼 기준(`drawingStorageKeyFromFitKey`) 또는 레거시 `fitKey:interval` */
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

/** `fitKey`(예: `005930:1d`)에서 타임프레임을 떼고 심볼만 — 드로잉은 타임프레임 바뀌어도 공유 */
export function drawingStorageKeyFromFitKey(fitKey: string): string {
  const i = fitKey.indexOf(":");
  return i >= 0 ? fitKey.slice(0, i) : fitKey;
}

function normalizeDrawingSnapshot(
  raw: unknown,
): ChartDrawingSnapshotV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as {
    version?: unknown;
    hlines?: unknown;
    rays?: unknown;
    trends?: unknown;
  };
  if (o.version !== 1) return null;
  const hlines: ChartDrawingSnapshotV1["hlines"] = [];
  if (Array.isArray(o.hlines)) {
    for (const row of o.hlines) {
      if (row && typeof row === "object" && isFiniteNum((row as { price?: unknown }).price)) {
        const id =
          typeof (row as { id?: unknown }).id === "string"
            ? (row as { id: string }).id
            : undefined;
        hlines.push({ price: (row as { price: number }).price, ...(id ? { id } : {}) });
      }
    }
  }
  const rawRays = Array.isArray(o.rays)
    ? o.rays
    : Array.isArray(o.trends)
      ? o.trends
      : [];
  const rays: ChartDrawingSnapshotV1["rays"] = [];
  for (const row of rawRays) {
    if (!row || typeof row !== "object") continue;
    const r = row as {
      id?: string;
      t1?: ChartTime;
      v1?: unknown;
      t2?: ChartTime;
      v2?: unknown;
      logicalDelta?: unknown;
    };
    if (
      r.t1 == null ||
      r.t2 == null ||
      !isFiniteNum(r.v1) ||
      !isFiniteNum(r.v2)
    ) {
      continue;
    }
    const id = typeof r.id === "string" ? r.id : undefined;
    const logicalDelta =
      isFiniteNum(r.logicalDelta) && Math.abs(r.logicalDelta as number) > 1e-9
        ? (r.logicalDelta as number)
        : undefined;
    rays.push({
      t1: r.t1,
      v1: r.v1,
      t2: r.t2,
      v2: r.v2,
      ...(id ? { id } : {}),
      ...(logicalDelta != null ? { logicalDelta } : {}),
    });
  }
  return { version: 1, hlines, rays };
}

function normalizeProfitRow(raw: unknown): ProfitRowV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as {
    entry?: unknown;
    updatedAt?: unknown;
    entryAtMs?: unknown;
    exit?: unknown;
    exitAtMs?: unknown;
  };
  if (!isFiniteNum(o.entry) || !(o.entry > 0)) return null;
  const updatedAt = isFiniteNum(o.updatedAt) ? o.updatedAt : Date.now();
  const row: ProfitRowV1 = {
    entry: o.entry,
    updatedAt,
  };
  if (isFiniteNum(o.entryAtMs) && o.entryAtMs > 0) row.entryAtMs = o.entryAtMs;
  if (isFiniteNum(o.exit) && o.exit > 0) row.exit = o.exit;
  if (isFiniteNum(o.exitAtMs) && o.exitAtMs > 0) row.exitAtMs = o.exitAtMs;
  return row;
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
    const profitRaw =
      p.profitBySymbol && typeof p.profitBySymbol === "object"
        ? { ...p.profitBySymbol }
        : {};
    const profitBySymbol: Record<string, ProfitRowV1> = {};
    for (const [k, v] of Object.entries(profitRaw)) {
      const norm = normalizeProfitRow(v);
      if (norm) profitBySymbol[k] = norm;
    }
    const chartDrawingsRaw =
      (p as { chartDrawings?: unknown }).chartDrawings &&
      typeof (p as { chartDrawings?: unknown }).chartDrawings === "object"
        ? { ...(p as { chartDrawings: Record<string, unknown> }).chartDrawings }
        : {};
    const chartDrawings: Record<string, ChartDrawingSnapshotV1> = {};
    for (const [k, v] of Object.entries(chartDrawingsRaw)) {
      const norm = normalizeDrawingSnapshot(v);
      if (norm && (norm.hlines.length > 0 || norm.rays.length > 0)) {
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

export function getPersistedProfitRow(symbol: string): ProfitRowV1 | null {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const row = loadPersisted().profitBySymbol[sym];
  return normalizeProfitRow(row);
}

export function getPersistedProfitEntry(symbol: string): number | null {
  return getPersistedProfitRow(symbol)?.entry ?? null;
}

export function persistProfitRow(symbol: string, row: ProfitRowV1 | null): void {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  try {
    const state = loadPersisted();
    if (!row || !(row.entry > 0)) {
      delete state.profitBySymbol[sym];
    } else {
      state.profitBySymbol[sym] = { ...row, updatedAt: Date.now() };
    }
    writePersisted(state);
  } catch {
    /* quota */
  }
}

export function persistProfitEntry(
  symbol: string,
  entry: number | null,
  opts?: { entryAtMs?: number | null },
): void {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  try {
    const state = loadPersisted();
    if (entry == null || !Number.isFinite(entry) || entry <= 0) {
      delete state.profitBySymbol[sym];
    } else {
      const prev = normalizeProfitRow(state.profitBySymbol[sym]);
      const entryAtMs =
        opts?.entryAtMs != null && Number.isFinite(opts.entryAtMs)
          ? opts.entryAtMs
          : (prev?.entryAtMs ?? Date.now());
      const next: ProfitRowV1 = {
        entry,
        updatedAt: Date.now(),
        entryAtMs,
      };
      if (prev?.exit != null && prev.exit > 0) {
        next.exit = prev.exit;
        next.exitAtMs = prev.exitAtMs;
      }
      state.profitBySymbol[sym] = next;
    }
    writePersisted(state);
  } catch {
    /* quota */
  }
}

/** 현재가 기준 매도 기록(청산 가정) */
export function persistProfitSell(
  symbol: string,
  exitPrice: number,
  exitAtMs = Date.now(),
): void {
  const sym = symbol.trim().toUpperCase();
  if (!sym || !Number.isFinite(exitPrice) || exitPrice <= 0) return;
  const prev = getPersistedProfitRow(sym);
  if (!prev) return;
  persistProfitRow(sym, {
    ...prev,
    exit: exitPrice,
    exitAtMs,
    updatedAt: Date.now(),
  });
}

/** 레거시 키 `fitKey:interval` + 신규 심볼 키 병합(신규 우선, 없으면 레거시) */
export function getChartDrawingSnapshotForFit(
  fitKey: string,
  dataInterval: string,
): ChartDrawingSnapshotV1 | null {
  if (!fitKey) return null;
  const symKey = drawingStorageKeyFromFitKey(fitKey);
  const legacyKey = `${fitKey}:${dataInterval}`;
  try {
    const state = loadPersisted();
    const primary = normalizeDrawingSnapshot(state.chartDrawings[symKey]);
    const legacy = normalizeDrawingSnapshot(state.chartDrawings[legacyKey]);
    if (primary && (primary.hlines.length > 0 || primary.rays.length > 0)) {
      return primary;
    }
    if (legacy && (legacy.hlines.length > 0 || legacy.rays.length > 0)) {
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

/** 저장된 앱 차트 드로잉(단일 키 — 레거시 호환용) */
export function getChartDrawingSnapshot(
  structureKey: string,
): ChartDrawingSnapshotV1 | null {
  if (!structureKey) return null;
  try {
    const raw = loadPersisted().chartDrawings[structureKey];
    const norm = normalizeDrawingSnapshot(raw);
    if (!norm || (!norm.hlines.length && !norm.rays.length)) return null;
    return norm;
  } catch {
    return null;
  }
}

/**
 * 드로잉 저장 — `persistKey`는 보통 심볼 키.
 * `legacyStructureKey`가 주어지면 해당 레거시 키를 삭제해 중복을 막음.
 */
export function persistChartDrawingSnapshot(
  persistKey: string,
  snap: ChartDrawingSnapshotV1,
  legacyStructureKey?: string,
): void {
  if (!persistKey) return;
  try {
    const state = loadPersisted();
    if (!snap.hlines.length && !snap.rays.length) {
      delete state.chartDrawings[persistKey];
    } else {
      state.chartDrawings[persistKey] = {
        version: 1,
        hlines: snap.hlines,
        rays: snap.rays,
      };
    }
    if (
      legacyStructureKey &&
      legacyStructureKey !== persistKey &&
      state.chartDrawings[legacyStructureKey]
    ) {
      delete state.chartDrawings[legacyStructureKey];
    }
    writePersisted(state);
  } catch {
    /* quota */
  }
}
