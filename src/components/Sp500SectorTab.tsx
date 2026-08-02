import { useEffect } from "react";
import Sp500SectorWheelMini from "./Sp500SectorWheelMini";
import { useSp500Sector } from "../contexts/Sp500SectorContext";
import "../sp500-sector-wheel-mini.css";

export default function Sp500SectorTab() {
  const { ensureLoaded } = useSp500Sector();
  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  return (
    <div className="workspace sp500-sector-tab">
      <Sp500SectorWheelMini />
    </div>
  );
}
