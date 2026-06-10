import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, readStoredTheme } from "./lib/theme";
import { ensureMobileBackNavigation } from "./lib/initMobileBack";
import { registerPwaServiceWorker } from "./lib/registerPwa";
import AppErrorBoundary from "./components/AppErrorBoundary";
import App from "./App";
import MobileServerGate from "./components/MobileServerGate";
import { LiveTradeCardSidePanelProvider } from "./components/LiveTradeAuthAndCredentials";
import "./index.css";
import "./theme.css";
import "./theme-light-palettes.css";
import "./theme-glass.css";
import "./ui-toss.css";
import "./field-validation.css";
import "./mobile-polish.css";
import "./ui-nowrap-lines.css";
import "./app-site-footer.css";
import "./app-theme-corner.css";
import "./stock-lookup-flat.css";
import "./financials-tab.css";
import "./stock-vault-tab.css";
import "./investor-flow-tab.css";
import "./account-snapshot.css";

declare global {
  interface Window {
    __STOCK_BOOT?: number;
  }
}

applyTheme(readStoredTheme());
registerPwaServiceWorker();
ensureMobileBackNavigation();

function renderFatal(message: string) {
  const el = document.getElementById("root");
  if (!el) return;
  el.innerHTML = `
    <div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1.25rem;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0a0e13;color:#eef2f7;">
      <div style="width:min(520px,100%);border:1px solid rgba(148,163,184,.18);background:#161d27;border-radius:12px;padding:1rem 1.05rem;box-shadow:0 8px 28px rgba(0,0,0,.45);">
        <div style="font-weight:800;letter-spacing:-0.02em;margin:0 0 .35rem;">로딩 중 오류</div>
        <div style="font-size:.9rem;line-height:1.55;color:#9aa8bc;white-space:pre-wrap;">${String(message ?? "알 수 없는 오류").replace(/</g, "&lt;")}</div>
        <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.85rem;">
          <button type="button" onclick="location.reload()" style="padding:.45rem .85rem;border-radius:8px;border:1px solid rgba(148,163,184,.25);background:#1e5fc4;color:#fff;font-weight:600;">새로고침</button>
          <button type="button" onclick="(window.stockClearCacheAndReload?window.stockClearCacheAndReload():location.reload())" style="padding:.45rem .85rem;border-radius:8px;border:1px solid rgba(148,163,184,.25);background:#1b2430;color:#eef2f7;font-weight:600;">캐시 삭제 후 재시도</button>
        </div>
        <div style="margin-top:.65rem;font-size:.82rem;color:#6d7d92;">새로고침 후에도 계속되면 콘솔 오류 캡처를 보내주세요.</div>
      </div>
    </div>
  `;
}

window.addEventListener("error", (e) => {
  if ((window.__STOCK_BOOT ?? 0) >= 2) return;
  const msg =
    (e as ErrorEvent).error instanceof Error
      ? (e as ErrorEvent).error.message
      : (e as ErrorEvent).message;
  if (msg && /Cannot update oldest data/i.test(msg)) return;
  if (msg) renderFatal(msg);
});

window.addEventListener("unhandledrejection", (e) => {
  const r = (e as PromiseRejectionEvent).reason;
  const msg = r instanceof Error ? r.message : String(r ?? "");
  if (!msg.trim()) return;
  console.error("[unhandledrejection]", r);
  e.preventDefault();
});

window.__STOCK_BOOT = 1;

try {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppErrorBoundary>
        <LiveTradeCardSidePanelProvider>
          <MobileServerGate>
            <App />
          </MobileServerGate>
        </LiveTradeCardSidePanelProvider>
      </AppErrorBoundary>
    </StrictMode>,
  );
  window.__STOCK_BOOT = 2;
} catch (e) {
  renderFatal(e instanceof Error ? e.message : String(e));
}
