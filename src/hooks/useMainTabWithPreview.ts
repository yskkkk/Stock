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
  const mainTabScrollBootRef = useRef(true);

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

  /** 모바일: 활성 탭 aria-current + 가로 스크롤에서 중앙 정렬 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const nav = mainTabsNavRef.current;
    if (!nav) return;

    nav.querySelectorAll<HTMLElement>(".main-tab").forEach((btn) => {
      btn.removeAttribute("aria-current");
    });
    nav.querySelector<HTMLElement>(".main-tab.active")?.setAttribute("aria-current", "page");

    if (window.innerWidth > 900) return;

    let cancelled = false;
    let raf = 0;
    let timeoutId = 0;

    const scrollActiveTabIntoView = () => {
      if (cancelled) return;
      const active =
        nav.querySelector<HTMLElement>(".main-tab[aria-current='page']") ??
        nav.querySelector<HTMLElement>(".main-tab.active");
      if (!active) return;
      const scrollParent = nav.closest<HTMLElement>(".top-bar__right");
      const behavior: ScrollBehavior = mainTabScrollBootRef.current ? "instant" : "smooth";
      mainTabScrollBootRef.current = false;

      if (scrollParent) {
        const parentRect = scrollParent.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        const targetLeft =
          scrollParent.scrollLeft +
          (activeRect.left - parentRect.left) -
          (parentRect.width - activeRect.width) / 2;
        const maxScroll = Math.max(0, scrollParent.scrollWidth - scrollParent.clientWidth);
        scrollParent.scrollTo({
          left: Math.min(maxScroll, Math.max(0, targetLeft)),
          behavior,
        });
        return;
      }
      active.scrollIntoView({ behavior, block: "nearest", inline: "center" });
    };

    const scheduleScroll = () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timeoutId);
      raf = window.requestAnimationFrame(() => {
        raf = window.requestAnimationFrame(scrollActiveTabIntoView);
      });
      timeoutId = window.setTimeout(scrollActiveTabIntoView, 160);
    };

    scheduleScroll();
    window.addEventListener("orientationchange", scheduleScroll);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timeoutId);
      window.removeEventListener("orientationchange", scheduleScroll);
    };
  }, [committedTab]);

  return {
    appTab,
    committedTab,
    setAppTab,
    mainTabClassName,
    mainTabsNavRef,
  };
}
