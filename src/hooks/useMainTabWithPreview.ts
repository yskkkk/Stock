import { useCallback, useState } from "react";
import type { AppTab } from "../types";

/** 상단 메인 탭 — 호버 시 미리보기, 클릭 시 고정(테마 팔레트와 동일 패턴) */
export function useMainTabWithPreview(initial: AppTab = "stockLookup") {
  const [committedTab, setCommittedTab] = useState<AppTab>(initial);
  const [hoverTab, setHoverTab] = useState<AppTab | null>(null);
  const appTab = hoverTab ?? committedTab;

  const setAppTab = useCallback((tab: AppTab) => {
    setHoverTab(null);
    setCommittedTab(tab);
  }, []);

  const previewMainTab = useCallback((tab: AppTab) => {
    setHoverTab(tab);
  }, []);

  const clearMainTabPreview = useCallback(() => {
    setHoverTab(null);
  }, []);

  const mainTabClassName = useCallback(
    (tab: AppTab) => {
      const parts = ["main-tab"];
      if (committedTab === tab) parts.push("active");
      if (hoverTab === tab && hoverTab !== committedTab) {
        parts.push("main-tab--preview");
      }
      return parts.join(" ");
    },
    [committedTab, hoverTab],
  );

  return {
    appTab,
    committedTab,
    hoverTab,
    setAppTab,
    previewMainTab,
    clearMainTabPreview,
    mainTabClassName,
  };
}
