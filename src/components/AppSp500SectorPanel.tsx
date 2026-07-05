import { memo, useCallback, useEffect, useState } from "react";
import { ko } from "../i18n/ko";
import Sp500SectorWheelMini from "./Sp500SectorWheelMini";

const STORAGE_KEY = "ystock-sp500-sector-open-v1";

function readOpen(): boolean {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

function AppSp500SectorPanelInner() {
  const [open, setOpen] = useState(readOpen);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <section
      className={
        open
          ? "app-sp500-sector-panel card"
          : "app-sp500-sector-panel app-sp500-sector-panel--collapsed card"
      }
      aria-label={ko.app.sp500SectorAria}
    >
      <div className="app-sp500-sector-panel__bar">
        <button
          type="button"
          className="app-sp500-sector-panel__toggle"
          aria-expanded={open}
          onClick={toggle}
        >
          <span className="app-sp500-sector-panel__chevron" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className="app-sp500-sector-panel__label">{ko.app.sp500SectorTitle}</span>
        </button>
        <a
          className="app-sp500-sector-panel__full"
          href="/sp500-sector-wheel.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          {ko.app.sp500SectorOpenFull}
        </a>
      </div>
      {open ? <Sp500SectorWheelMini embedded /> : null}
    </section>
  );
}

const AppSp500SectorPanel = memo(AppSp500SectorPanelInner);
export default AppSp500SectorPanel;
