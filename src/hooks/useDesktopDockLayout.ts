import { useEffect, useState } from "react";

export const DESKTOP_DOCK_LAYOUT_MQ = "(min-width: 1180px)";

/** 우측 도크·좌측 계정 카드 분기(1180px 이상) */
export function useDesktopDockLayout(): boolean {
  const [wide, setWide] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(DESKTOP_DOCK_LAYOUT_MQ).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(DESKTOP_DOCK_LAYOUT_MQ);
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return wide;
}
