import { Capacitor } from "@capacitor/core";
import { isNativeApp } from "./isNativeApp";

/** 낮을수록 먼저 처리(모달 > 탭 > 종목 선택) */
export const MOBILE_BACK_PRIORITY = {
  SERVER_GATE: 200,
  ACCESS_ADMIN: 190,
  OPS_PROGRESS: 185,
  PROFIT: 180,
  TELEGRAM_SENT: 170,
  SCREEN_FAILURES: 165,
  PICKS_HISTORY: 160,
  REASON: 155,
  NEWS: 150,
  LIVE_TRADE_CARD_PANEL: 145,
  LIVE_TRADE_EDIT: 140,
  CHART_DRAW: 130,
  TAB: 50,
  WORKSPACE_PICK: 40,
} as const;

type Handler = () => void;

const handlers = new Map<number, Handler>();
let ignoreNextPop = false;
let consumedByPopstate = false;
let initialized = false;

function topPriority(): number {
  let best = -1;
  for (const p of handlers.keys()) {
    if (p > best) best = p;
  }
  return best;
}

function runTopHandler() {
  const p = topPriority();
  if (p < 0) return;
  const fn = handlers.get(p);
  if (fn) fn();
}

/**
 * 네이티브 앱에서 뒤로가기(Android 버튼·iOS edge-swipe) 처리기 등록.
 * @returns 해제 함수
 */
export function registerMobileBackHandler(
  priority: number,
  handler: Handler,
): () => void {
  if (!isNativeApp() || typeof window === "undefined") return () => {};

  window.history.pushState({ stockMobileBack: priority }, "");
  handlers.set(priority, handler);

  return () => {
    handlers.delete(priority);
    if (!consumedByPopstate && !ignoreNextPop) {
      ignoreNextPop = true;
      window.history.back();
    }
  };
}

function onPopState() {
  if (ignoreNextPop) {
    ignoreNextPop = false;
    return;
  }
  consumedByPopstate = true;
  runTopHandler();
  queueMicrotask(() => {
    consumedByPopstate = false;
  });
}

async function onAndroidBackButton() {
  if (handlers.size > 0) {
    window.history.back();
    return;
  }
  try {
    const { App } = await import("@capacitor/app");
    await App.exitApp();
  } catch {
    /* ignore */
  }
}

export function initMobileBackNavigation() {
  if (initialized || !isNativeApp() || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("popstate", onPopState);

  if (Capacitor.getPlatform() === "android") {
    void import("@capacitor/app").then(({ App }) => {
      void App.addListener("backButton", () => {
        void onAndroidBackButton();
      });
    });
  }
}
