/** Yahoo 해외·교차 상장 접미사 (미국 나스닥/NYSE 주 종목이 아님) */
const YAHOO_FOREIGN_LISTING_SUFFIX = new Set([
  "MX",
  "BA",
  "L",
  "TO",
  "V",
  "HK",
  "SI",
  "AX",
  "NS",
  "BO",
  "SA",
  "DE",
  "PA",
  "MI",
  "SW",
  "TW",
  "T",
  "IL",
  "ST",
  "HE",
  "OL",
  "MC",
  "AS",
  "SN",
  "ME",
  "VI",
  "IC",
  "TA",
  "WA",
  "JO",
  "SR",
  "QA",
  "DU",
  "BK",
  "IS",
  "AT",
  "BD",
  "KL",
  "NZ",
  "CO",
  "CR",
  "PR",
  "RG",
  "CM",
  "LM",
  "SZ",
  "SS",
  "CN",
  "KQ",
  "KS",
]);

/** 미국 거래소에서 쓰는 점(.) 뒤 접미사 — B주, 워런트 등 */
const US_ALLOWED_DOT_SUFFIX = new Set(["A", "B", "C", "WS", "W", "U", "RT", "P"]);

/**
 * 종목검색(미국)에 노출할 주요 상장 심볼인지.
 * RGTI.MX · RGTID.BA 등 해외 교차상장은 false.
 * @param {string} symbol
 */
export function isPrimaryUsSearchSymbol(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return false;
  if (/\.(KS|KQ)$/i.test(sym) || sym.includes("=F") || /-USD(T)?$/i.test(sym)) {
    return false;
  }

  const dot = sym.lastIndexOf(".");
  if (dot < 0) {
    return /^[A-Z][A-Z0-9.-]{0,23}$/.test(sym);
  }

  const suffix = sym.slice(dot + 1);
  if (!/^[A-Z0-9]{1,4}$/.test(suffix)) return false;
  if (YAHOO_FOREIGN_LISTING_SUFFIX.has(suffix)) return false;
  if (suffix.length === 1) return true;
  return US_ALLOWED_DOT_SUFFIX.has(suffix);
}

/**
 * @param {{ symbol?: string; currency?: string }} row
 */
export function isUsSearchResultRow(row) {
  if (!isPrimaryUsSearchSymbol(row?.symbol)) return false;
  const cur = String(row?.currency ?? "")
    .trim()
    .toUpperCase();
  if (cur && cur !== "USD") return false;
  return true;
}
