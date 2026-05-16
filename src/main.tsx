import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LaunchShell from "./LaunchShell";
import { applyTheme, readStoredTheme } from "./lib/theme";
import "./index.css";
import "./theme.css";

applyTheme(readStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LaunchShell />
  </StrictMode>,
);
