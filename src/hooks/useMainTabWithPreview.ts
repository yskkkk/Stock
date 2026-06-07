import { useCallback, useState } from "react";
import type { AppTab } from "../types";

/** 상단 메인 탭 — 클릭 시에만 전환 */
export function useMainTabWithPreview(initial: AppTab = "stockLookup") {
  const [committedTab, setCommittedTab] = useState<AppTab>(initial);
  const appTab = committedTab;

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

  return {
    appTab,
    committedTab,
    setAppTab,
    mainTabClassName,
  };
}
