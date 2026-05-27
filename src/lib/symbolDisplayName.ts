import { CRYPTO_ASSETS } from "../constants/crypto";
import { displayStockSymbol } from "./format";
import krList from "../../server/data/universe-kr.json";
import usList from "../../server/data/universe-us.json";
import usKoList from "../../server/data/names-ko-us.json";

type NameRow = { symbol: string; name?: string; nameKo?: string };

const nameMap = new Map<string, string>();

function hasHangul(text: string): boolean {
  return /[\uAC00-\uD7A3]/.test(text);
}

export function symbolLookupKeys(raw: string): string[] {
  const u = String(raw ?? "").toUpperCase().trim();
  if (!u) return [];
  const keys = new Set<string>([u]);
  const dot = u.match(/^(\d{6})\.(KS|KQ)$/);
  if (dot) {
    keys.add(dot[1]);
    keys.add(`KR_${dot[1]}`);
  }
  const kr = u.match(/^KR_(\d{6})$/);
  if (kr) {
    keys.add(kr[1]);
    keys.add(`${kr[1]}.KS`);
    keys.add(`${kr[1]}.KQ`);
  }
  if (/^\d{6}$/.test(u)) {
    keys.add(`${u}.KS`);
    keys.add(`${u}.KQ`);
    keys.add(`KR_${u}`);
  }
  return [...keys];
}

function registerSymbolName(symbol: string, displayName: string): void {
  const label = String(displayName ?? "").trim();
  if (!label) return;
  for (const key of symbolLookupKeys(symbol)) {
    nameMap.set(key, label);
  }
}

function lookupMappedName(symbol: string): string | null {
  for (const key of symbolLookupKeys(symbol)) {
    const hit = nameMap.get(key);
    if (hit) return hit;
  }
  return null;
}

for (const row of [...krList, ...usList, ...usKoList] as NameRow[]) {
  registerSymbolName(row.symbol, row.nameKo ?? row.name ?? "");
}
for (const asset of CRYPTO_ASSETS) {
  registerSymbolName(asset.symbol, asset.name);
}

function resolveLabel(symbol: string, fallbackName?: string | null): string {
  const sym = symbol.trim().toUpperCase();
  const mapped = lookupMappedName(sym);
  if (mapped) return mapped;
  const fb = String(fallbackName ?? "").trim();
  if (fb && hasHangul(fb)) return fb;
  if (fb && fb.toUpperCase() !== sym && !fb.toUpperCase().startsWith(`${sym} `)) {
    return fb;
  }
  return sym;
}

function shortTickerCode(symbol: string, market?: string | null): string {
  const sym = symbol.trim().toUpperCase();
  if (market === "kr") return displayStockSymbol(sym);
  if (market === "crypto") {
    const base = sym.replace(/-USDT$/i, "").replace(/_USDT$/i, "");
    return base || sym;
  }
  return sym;
}

export type SymbolDisplayParts = {
  /** UI 주 표기 — 회사·종목명 */
  label: string;
  /** 보조 표기 — 짧은 티커(주 표기와 다를 때만) */
  sublabel?: string;
};

/** 로컬 맵 + fallback — 티커만 노출하지 않고 종목명 우선 */
export function resolveSymbolDisplayName(
  symbol: string,
  fallbackName?: string | null,
  market?: string | null,
): SymbolDisplayParts {
  const sym = symbol.trim().toUpperCase();
  const label = resolveLabel(sym, fallbackName);
  const code = shortTickerCode(sym, market);
  const showSub =
    label !== sym &&
    label.toUpperCase() !== sym &&
    code !== label &&
    !label.includes(code);
  return showSub ? { label, sublabel: code } : { label };
}

export function getMappedSymbolName(symbol: string): string | null {
  return lookupMappedName(symbol);
}
