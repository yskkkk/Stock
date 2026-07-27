/**
 * 계좌 보유·현금 → 원형 차트용 비중 조각 (평가금액 가중).
 * S&P500 섹터 휠과 같은 donut 경로를 쓰기 위해 Sp500SectorRow 호환 shape 로 맞춤.
 */

import type { TossTestHolding } from "../api";
import {
  buildDonutSegments,
  sp500SectorColor,
  type DonutSegment,
  type Sp500SectorRow,
} from "./sp500SectorChart";
import {
  tossRoundTripForHolding,
  type TossFeeRatesByMarket,
} from "./tossHoldingFeeRates";
import { tossHoldingNetMarketValue } from "./tossHoldingPnl";
import { DEFAULT_ROUND_TRIP_FEE_RATE } from "./netReturn";
import { resolveSymbolDisplayName } from "./symbolDisplayName";

export type AccountAllocMode = "sector" | "subIndustry" | "market" | "symbol";

export type AccountAllocSlice = {
  key: string;
  label: string;
  /** GICS 영문 키(있으면 색상 매핑) */
  sectorEn?: string | null;
  valueKrw: number;
  count: number;
  symbols: string[];
};

export type AccountHoldingRow = {
  symbol: string;
  name: string;
  market: "kr" | "us" | "crypto";
  currency?: string;
  quantity: number;
  valueKrw: number;
  returnPercent: number | null;
  industry: string | null;
  /** GICS/Yahoo 상세 업종(표시용) */
  subIndustry: string | null;
  sectorEn: string | null;
  sectorKo: string | null;
};

const FALLBACK_COLORS = [
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#a78bfa",
  "#94a3b8",
  "#4ade80",
  "#f97316",
  "#60a5fa",
  "#e879f9",
  "#facc15",
  "#2dd4bf",
  "#f472b6",
  "#818cf8",
];

function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

export function accountSliceColor(slice: {
  key: string;
  sectorEn?: string | null;
}): string {
  if (slice.key === "__cash__") return "#64748b";
  if (slice.sectorEn) {
    const c = sp500SectorColor(slice.sectorEn);
    if (c !== "#64748b" || slice.sectorEn === "Unknown") return c;
  }
  return hashColor(slice.key);
}

/** 종목별 차트·범례 라벨 — 로컬 한글명 맵 우선 */
export function accountSymbolSliceLabel(
  row: Pick<AccountHoldingRow, "symbol" | "name" | "market">,
  otherLabel: string,
): string {
  const sym = row.symbol.trim() || row.name.trim();
  const { label, sublabel } = resolveSymbolDisplayName(sym, row.name, row.market);
  const ticker = (sublabel || sym).trim();
  if (label && label !== ticker) return `${ticker} · ${label}`;
  return label || ticker || row.name.trim() || otherLabel;
}

export function buildAccountAllocationSlices(
  rows: AccountHoldingRow[],
  cashKrw: number,
  mode: AccountAllocMode,
  labels: {
    cash: string;
    other: string;
    marketKr: string;
    marketUs: string;
    marketCrypto: string;
  },
): AccountAllocSlice[] {
  const map = new Map<string, AccountAllocSlice>();

  const bump = (
    key: string,
    label: string,
    valueKrw: number,
    symbol: string,
    sectorEn?: string | null,
  ) => {
    if (!(valueKrw > 0) || !Number.isFinite(valueKrw)) return;
    const prev = map.get(key);
    if (prev) {
      prev.valueKrw += valueKrw;
      prev.count += 1;
      if (!prev.symbols.includes(symbol)) prev.symbols.push(symbol);
      return;
    }
    map.set(key, {
      key,
      label,
      sectorEn: sectorEn ?? null,
      valueKrw,
      count: 1,
      symbols: [symbol],
    });
  };

  for (const row of rows) {
    if (!(row.valueKrw > 0)) continue;
    if (mode === "symbol") {
      const sym = row.symbol.trim() || row.name.trim();
      const label = accountSymbolSliceLabel(row, labels.other);
      bump(sym || label, label, row.valueKrw, sym || label, row.sectorEn);
      continue;
    }
    if (mode === "market") {
      const key =
        row.market === "us" ? "us" : row.market === "crypto" ? "crypto" : "kr";
      const label =
        key === "us"
          ? labels.marketUs
          : key === "crypto"
            ? labels.marketCrypto
            : labels.marketKr;
      bump(key, label, row.valueKrw, row.symbol);
      continue;
    }
    if (mode === "subIndustry") {
      const detail = (row.subIndustry || row.industry || row.sectorKo || "").trim();
      const key = detail || labels.other;
      bump(key, key || labels.other, row.valueKrw, row.symbol, row.sectorEn);
      continue;
    }
    // sector — GICS 대분류(있으면) 우선, 없으면 업종
    const sectorKo = (row.sectorKo || row.industry || "").trim();
    const key = sectorKo || labels.other;
    bump(key, key || labels.other, row.valueKrw, row.symbol, row.sectorEn);
  }

  if (cashKrw > 0 && Number.isFinite(cashKrw)) {
    map.set("__cash__", {
      key: "__cash__",
      label: labels.cash,
      sectorEn: null,
      valueKrw: cashKrw,
      count: 0,
      symbols: [],
    });
  }

  return [...map.values()].sort((a, b) => b.valueKrw - a.valueKrw);
}

export function accountSlicesToDonut(slices: AccountAllocSlice[]): {
  segments: DonutSegment[];
  total: number;
  rows: Sp500SectorRow[];
} {
  const total = slices.reduce((s, x) => s + x.valueKrw, 0);
  const rows: Sp500SectorRow[] = slices.map((s) => ({
    sector: s.key,
    sectorKo: s.label,
    count: Math.max(1, Math.round(s.valueKrw)),
    pct: total > 0 ? (s.valueKrw / total) * 100 : 0,
  }));
  const weightTotal = Math.max(1, Math.round(total));
  const segments = buildDonutSegments(rows, weightTotal).map((seg, i) => ({
    ...seg,
    color: accountSliceColor(slices[i]!),
    pct: rows[i]?.pct ?? 0,
    count: slices[i]?.count ?? 0,
  }));
  return { segments, total, rows };
}

/** Toss 보유 → AccountHoldingRow (원화 평가) */
export function tossHoldingsToAccountRows(
  holdings: TossTestHolding[],
  usdKrwRate: number | null,
  feeRates: TossFeeRatesByMarket | number | null,
  enrich: Map<
    string,
    {
      industry?: string | null;
      subIndustry?: string | null;
      sectorEn?: string | null;
      sectorKo?: string | null;
    }
  >,
): AccountHoldingRow[] {
  const rate =
    usdKrwRate != null && Number.isFinite(usdKrwRate) && usdKrwRate > 0
      ? usdKrwRate
      : null;
  const out: AccountHoldingRow[] = [];
  for (const h of holdings) {
    const fee =
      typeof feeRates === "number"
        ? feeRates
        : feeRates
          ? tossRoundTripForHolding(h.market, feeRates)
          : DEFAULT_ROUND_TRIP_FEE_RATE;
    const net = tossHoldingNetMarketValue(h, fee);
    if (net == null || !(net > 0)) continue;
    const market = h.market === "us" ? "us" : "kr";
    let valueKrw = net;
    if (market === "us") {
      if (!rate) continue;
      valueKrw = Math.round(net * rate);
    }
    const meta = enrich.get(String(h.symbol ?? "").toUpperCase()) ?? {};
    const industry = meta.industry ?? null;
    const subIndustry = (meta.subIndustry || industry || null) as string | null;
    const { label: displayName } = resolveSymbolDisplayName(h.symbol, h.name, market);
    out.push({
      symbol: h.symbol,
      name: displayName || h.name || h.symbol,
      market,
      currency: h.currency,
      quantity: h.quantity,
      valueKrw,
      returnPercent:
        h.returnPercent != null && Number.isFinite(h.returnPercent)
          ? h.returnPercent
          : null,
      industry,
      subIndustry,
      sectorEn: meta.sectorEn ?? null,
      sectorKo: meta.sectorKo ?? industry ?? null,
    });
  }
  return out;
}
