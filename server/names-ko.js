import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nameMap = new Map();

/** 티커 변형(.KS, KR_ 등) 동일 종목명 조회 */
export function symbolLookupKeys(raw) {
  const u = String(raw ?? "").toUpperCase().trim();
  if (!u) return [];
  const keys = new Set([u]);
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

function registerSymbolName(symbol, displayName) {
  const label = String(displayName ?? "").trim();
  if (!label) return;
  for (const key of symbolLookupKeys(symbol)) {
    nameMap.set(key, label);
  }
}

function loadJson(file) {
  try {
    const list = JSON.parse(
      readFileSync(join(__dirname, "data", file), "utf8"),
    );
    for (const { symbol, name, nameKo } of list) {
      registerSymbolName(symbol, nameKo ?? name);
    }
  } catch {
    /* ignore */
  }
}

loadJson("universe-kr.json");
loadJson("universe-us.json");
loadJson("names-ko-us.json");

/** 한글 포함 여부 */
export function hasHangul(text) {
  return /[\uAC00-\uD7A3]/.test(text);
}

/**
 * 표시용 한글 종목명 (우선순위: 로컬 DB → 한글이 포함된 후보 → 첫 후보)
 */
function lookupMappedName(symbol) {
  for (const key of symbolLookupKeys(symbol)) {
    if (nameMap.has(key)) return nameMap.get(key);
  }
  return null;
}

export function resolveDisplayName(symbol, ...candidates) {
  const mapped = lookupMappedName(symbol);
  if (mapped) return mapped;

  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && hasHangul(c)) {
      return c.trim();
    }
  }

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  const sym = String(symbol ?? "").toUpperCase().trim();
  return sym;
}

export function registerKoreanName(symbol, nameKo) {
  registerSymbolName(symbol, nameKo);
}

/** names-ko-us 등에 등록된 한글 표기 (없으면 null) */
export function getKoreanStockName(symbol) {
  return lookupMappedName(symbol);
}

/** Yahoo 검색 행 등 — 영문 회사명(한글 제외 우선) */
export function englishYahooName(shortName, longName) {
  const long = String(longName ?? "").trim();
  const short = String(shortName ?? "").trim();
  if (long && !hasHangul(long)) return long;
  if (short && !hasHangul(short)) return short;
  return "";
}
