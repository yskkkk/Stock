import { forwardRef, memo, useCallback } from "react";
import { ko } from "../i18n/ko";
import { useSp500Sector } from "../contexts/Sp500SectorContext";
import Sp500SectorWheelMini from "./Sp500SectorWheelMini";

const AppSp500SectorPanelInner = forwardRef<HTMLElement>(function AppSp500SectorPanelInner(
  _props,
  ref,
) {
  const { panelOpen, setPanelOpen } = useSp500Sector();
  const toggle = useCallback(() => setPanelOpen(!panelOpen), [panelOpen, setPanelOpen]);

  return (
    <section
      ref={ref}
      className={
        panelOpen
          ? "app-sp500-sector-panel card"
          : "app-sp500-sector-panel app-sp500-sector-panel--collapsed card"
      }
      aria-label={ko.app.sp500SectorAria}
    >
      <div className="app-sp500-sector-panel__bar">
        <button
          type="button"
          className="app-sp500-sector-panel__toggle"
          aria-expanded={panelOpen}
          onClick={toggle}
        >
          <span className="app-sp500-sector-panel__chevron" aria-hidden>
            {panelOpen ? "▾" : "▸"}
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
      {panelOpen ? <Sp500SectorWheelMini embedded /> : null}
    </section>
  );
});

const AppSp500SectorPanel = memo(AppSp500SectorPanelInner);
export default AppSp500SectorPanel;
