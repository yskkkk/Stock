import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ko } from "./i18n/ko";
import { applyTheme, readStoredTheme } from "./lib/theme";
import { ensureMobileBackNavigation } from "./lib/initMobileBack";
import { registerPwaServiceWorker } from "./lib/registerPwa";
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

const App = lazy(() => import("./App"));
const MobileServerGate = lazy(() => import("./components/MobileServerGate"));

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
        <div style="margin-top:.85rem;font-size:.82rem;color:#6d7d92;">새로고침 후에도 계속되면 콘솔 오류 캡처를 보내주세요.</div>
      </div>
    </div>
  `;
}

window.addEventListener("error", (e) => {
  const msg =
    (e as ErrorEvent).error instanceof Error
      ? (e as ErrorEvent).error.message
      : (e as ErrorEvent).message;
  if (msg) renderFatal(msg);
});

window.addEventListener("unhandledrejection", (e) => {
  const r = (e as PromiseRejectionEvent).reason;
  renderFatal(r instanceof Error ? r.message : String(r ?? "Promise rejection"));
});

try {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Suspense
        fallback={
          <div
            className="launch-shell launch-shell--loading"
            aria-busy="true"
            data-testid="launch-loading"
          >
            <p>{ko.launch.loading}</p>
          </div>
        }
      >
        <MobileServerGate>
          <App />
        </MobileServerGate>
      </Suspense>
    </StrictMode>,
  );
} catch (e) {
  renderFatal(e instanceof Error ? e.message : String(e));
}
