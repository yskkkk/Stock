import { useCallback, useEffect, useRef, useState } from "react";
import { readMobileAppSession } from "../lib/mobileAppSession";
import type { AppTab } from "../types";

/** 상단 메인 탭 — 클릭 시에만 전환 */
export function useMainTabWithPreview(initial: AppTab = "stockLookup") {
  const [committedTab, setCommittedTab] = useState<AppTab>(() => {
    if (typeof window === "undefined") return initial;
    return readMobileAppSession()?.appTab ?? initial;
  });
  const appTab = committedTab;
  const mainTabsNavRef = useRef<HTMLElement | null>(null);

  const setAppTab = useCallback((tab: AppTab) => {
    setCommittedTab(tab);
  }, []);

  const mainTabClassName = useCallback(
    (tab: AppTab) => {
      const parts = ["main-tab"];
      if (committedTab === tab) parts.push("active");
      return parts.join(" ");
    },
    [committedTab],
  );

  /** 모바일: 가로 스크롤 탭에서 활성 탭이 보이도록 스크롤 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth > 900) return;
    const nav = mainTabsNavRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>(".main-tab.active");
    if (!active) return;
    const t = window.setTimeout(() => {
      active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [committedTab]);

  return {
    appTab,
    committedTab,
    setAppTab,
    mainTabClassName,
    mainTabsNavRef,
  };
}
