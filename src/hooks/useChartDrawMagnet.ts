import { useCallback, useState } from "react";

const STORAGE_KEY = "stock-chart-draw-magnet-v1";

/** `0`이면 끔, 그 외(미설정·`1`)는 켬 — 기본은 켜짐 */
function readMagnet(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeMagnet(v: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
}

/** 차트 드로잉 마그넷(OHLC 스냅) — 브라우저에만 저장 */
export function useChartDrawMagnet(): readonly [boolean, (next: boolean) => void] {
  const [magnet, setMagnet] = useState(readMagnet);

  const set = useCallback((next: boolean) => {
    setMagnet(next);
    writeMagnet(next);
  }, []);

  return [magnet, set] as const;
}
