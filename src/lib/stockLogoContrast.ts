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

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** FMP 등 흰 사각 배경 PNG — 근백색 픽셀을 투명 처리 + 대비 소폭 상향 */
export function applyNearWhiteStripToRgba(
  data: Uint8ClampedArray,
  {
    threshold = 236,
    feather = 22,
    sharpen = 1.14,
  }: { threshold?: number; feather?: number; sharpen?: number } = {},
): void {
  const featherStart = threshold - feather;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const min = Math.min(r, g, b);
    if (min >= threshold) {
      data[i + 3] = 0;
      continue;
    }
    if (min >= featherStart) {
      const t = (min - featherStart) / feather;
      data[i + 3] = clampByte(data[i + 3] * (1 - t));
    }
    if (data[i + 3] === 0) continue;
    data[i] = clampByte((r - 128) * sharpen + 128);
    data[i + 1] = clampByte((g - 128) * sharpen + 128);
    data[i + 2] = clampByte((b - 128) * sharpen + 128);
  }
}

/** @returns data URL PNG or null (CORS·canvas 실패) */
export function stripLogoNearWhiteBackground(
  img: HTMLImageElement,
  opts?: { threshold?: number; feather?: number; sharpen?: number; size?: number },
): string | null {
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
    return null;
  }
  try {
    const size = opts?.size ?? 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const scale = Math.min(size / nw, size / nh);
    const dw = nw * scale;
    const dh = nh * scale;
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, dx, dy, dw, dh);
    const imageData = ctx.getImageData(0, 0, size, size);
    applyNearWhiteStripToRgba(imageData.data, opts);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
