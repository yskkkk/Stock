import { useEffect, useRef } from "react";
import { registerMobileBackHandler } from "../lib/mobileBackStack";

/**
 * 활성일 때만 네이티브 뒤로가기 스택에 등록 (Android 뒤로·iOS 가장자리 스와이프).
 */
export function useMobileBackHandler(
  active: boolean,
  priority: number,
  onBack: () => void,
) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    return registerMobileBackHandler(priority, () => {
      onBackRef.current();
    });
  }, [active, priority]);
}
