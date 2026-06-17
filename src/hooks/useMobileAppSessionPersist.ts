import { useEffect, useRef, type RefObject } from "react";
import type { AppTab, ChartTimeframe, StockPick } from "../types";
import { writeMobileAppSession } from "../lib/mobileAppSession";

type Args = {
  appTab: AppTab;
  screenerSelected: StockPick | null;
  lookupSelected: StockPick | null;
  timeframe: ChartTimeframe;
  scrollRootRef: RefObject<HTMLElement | null>;
};

/** 모바일 WebView 재기동·탭 복귀 시 탭·종목·스크롤 유지 */
export function useMobileAppSessionPersist({
  appTab,
  screenerSelected,
  lookupSelected,
  timeframe,
  scrollRootRef,
}: Args): void {
  const stateRef = useRef({ appTab, screenerSelected, lookupSelected, timeframe });
  stateRef.current = { appTab, screenerSelected, lookupSelected, timeframe };

  useEffect(() => {
    const persist = () => {
      writeMobileAppSession({
        ...stateRef.current,
        scrollTop: scrollRootRef.current?.scrollTop ?? 0,
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", persist);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", persist);
    };
  }, [scrollRootRef]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      writeMobileAppSession({
        ...stateRef.current,
        scrollTop: scrollRootRef.current?.scrollTop ?? 0,
      });
    }, 12_000);
    return () => window.clearInterval(id);
  }, [scrollRootRef]);
}
