import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nameMap = new Map();

function loadJson(file) {
  try {
    const list = JSON.parse(
      readFileSync(join(__dirname, "data", file), "utf8"),
    );
    for (const { symbol, name, nameKo } of list) {
      const sym = String(symbol).toUpperCase();
      const ko = nameKo ?? name;
      if (sym && ko) nameMap.set(sym, ko);
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
export function resolveDisplayName(symbol, ...candidates) {
  const sym = String(symbol ?? "").toUpperCase();
  if (nameMap.has(sym)) return nameMap.get(sym);

  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && hasHangul(c)) {
      return c.trim();
    }
  }

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  return sym;
}

export function registerKoreanName(symbol, nameKo) {
  if (symbol && nameKo) nameMap.set(String(symbol).toUpperCase(), nameKo);
}

/** names-ko-us 등에 등록된 한글 표기 (없으면 null) */
export function getKoreanStockName(symbol) {
  const sym = String(symbol ?? "").toUpperCase();
  return nameMap.get(sym) ?? null;
}

/** Yahoo 검색 행 등 — 영문 회사명(한글 제외 우선) */
export function englishYahooName(shortName, longName) {
  const long = String(longName ?? "").trim();
  const short = String(shortName ?? "").trim();
  if (long && !hasHangul(long)) return long;
  if (short && !hasHangul(short)) return short;
  return "";
}
