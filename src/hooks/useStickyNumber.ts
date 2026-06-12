import { useRef } from "react";

/** null 구간에도 마지막 유효 숫자를 유지 — 깜빡임·DOM 제거 방지 */
export function useStickyNumber(value: number | null | undefined): number | null {
  const last = useRef<number | null>(null);
  if (value != null && Number.isFinite(value)) {
    last.current = value;
    return value;
  }
  return last.current;
}
