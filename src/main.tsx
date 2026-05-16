import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ko } from "./i18n/ko";
import { applyTheme, readStoredTheme } from "./lib/theme";
import "./index.css";
import "./theme.css";

const App = lazy(() => import("./App"));

applyTheme(readStoredTheme());

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
      <App />
    </Suspense>
  </StrictMode>,
);
