import { lazy, Suspense, useState } from "react";
import { ko } from "./i18n/ko";

const App = lazy(() => import("./App"));

export default function LaunchShell() {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <div className="launch-shell" data-testid="launch-shell">
        <button
          type="button"
          className="launch-shell__btn btn"
          onClick={() => setStarted(true)}
        >
          {ko.launch.run}
        </button>
      </div>
    );
  }

  return (
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
  );
}
