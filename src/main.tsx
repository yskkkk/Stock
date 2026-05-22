import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ko } from "./i18n/ko";
import { applyTheme, readStoredTheme } from "./lib/theme";
import { ensureMobileBackNavigation } from "./lib/initMobileBack";
import { registerPwaServiceWorker } from "./lib/registerPwa";
import "./index.css";
import "./theme.css";
import "./theme-light-palettes.css";
import "./ui-toss.css";
import "./mobile-polish.css";

const App = lazy(() => import("./App"));
const MobileServerGate = lazy(() => import("./components/MobileServerGate"));

applyTheme(readStoredTheme());
registerPwaServiceWorker();
ensureMobileBackNavigation();

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
