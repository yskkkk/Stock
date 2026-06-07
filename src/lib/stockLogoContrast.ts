import type { Market } from "../types";

/** FMP·Naver 로고 중 투명 PNG + 밝은(흰) 마크 — canvas CORS 실패 시 폴백 */
const KNOWN_LIGHT_LOGO_US = new Set([
  "INTC",
  "IBM",
  "WBA",
  "MET",
  "ALL",
  "TRV",
  "PGR",
  "AIG",
  "CB",
  "MMC",
  "AON",
  "MSCI",
  "SPGI",
  "MCO",
  "FDS",
  "CME",
  "ICE",
  "NDAQ",
  "CBOE",
]);

export function normalizeStockLogoSymbol(symbol: string): string {
  return String(symbol ?? "")
    .replace(/^KR_/i, "")
    .replace(/\.(KS|KQ)$/i, "")
    .replace(/^US_/i, "")
    .trim()
    .toUpperCase();
}

export function isKnownLightLogoSymbol(symbol: string, market: Market): boolean {
  if (market === "kr") return false;
  return KNOWN_LIGHT_LOGO_US.has(normalizeStockLogoSymbol(symbol));
}

/**
 * 투명 PNG 위 밝은 마크(흰색·연회색) 비율이 높으면 true
 * @param {HTMLImageElement} img crossOrigin 설정 후 로드 완료된 이미지
 */
export function analyzeLogoNeedsDarkPlate(img: HTMLImageElement): boolean {
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const w = 28;
    const h = 28;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let opaque = 0;
    let bright = 0;
    let mid = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 48) continue;
      opaque += 1;
      const lum =
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (lum >= 205) bright += 1;
      else if (lum >= 145) mid += 1;
    }
    if (opaque < 10) return false;
    const brightRatio = bright / opaque;
    const midRatio = mid / opaque;
    if (brightRatio >= 0.38 && brightRatio + midRatio >= 0.52) return true;
    if (brightRatio >= 0.55) return true;
    return false;
  } catch {
    return false;
  }
}

export function resolveLogoNeedsDarkPlate(
  symbol: string,
  market: Market,
  img?: HTMLImageElement | null,
): boolean {
  if (isKnownLightLogoSymbol(symbol, market)) return true;
  if (img) return analyzeLogoNeedsDarkPlate(img);
  return false;
}
