import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchSp500Sectors } from "../api";
import type { Sp500SectorsPayload } from "../lib/sp500SectorChart";

export type Sp500SectorPanelTab = "chart" | "list";

type Sp500SectorContextValue = {
  data: Sp500SectorsPayload | null;
  loading: boolean;
  error: string | null;
  selectedSector: string | null;
  setSelectedSector: (sector: string | null) => void;
  panelTab: Sp500SectorPanelTab;
  setPanelTab: (tab: Sp500SectorPanelTab) => void;
  openSectorDetail: (sector: string, tab?: Sp500SectorPanelTab) => void;
  openPanel: (tab?: Sp500SectorPanelTab) => void;
};

const Sp500SectorContext = createContext<Sp500SectorContextValue | null>(null);

export function Sp500SectorProvider({
  children,
  onNavigateToTab,
}: {
  children: ReactNode;
  onNavigateToTab: () => void;
}) {
  const [data, setData] = useState<Sp500SectorsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<Sp500SectorPanelTab>("chart");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSp500Sectors()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openPanel = useCallback(
    (tab: Sp500SectorPanelTab = "chart") => {
      setPanelTab(tab);
      onNavigateToTab();
    },
    [onNavigateToTab],
  );

  const openSectorDetail = useCallback(
    (sector: string, tab: Sp500SectorPanelTab = "list") => {
      setSelectedSector(sector);
      setPanelTab(tab);
      onNavigateToTab();
    },
    [onNavigateToTab],
  );

  const value = useMemo(
    () => ({
      data,
      loading,
      error,
      selectedSector,
      setSelectedSector,
      panelTab,
      setPanelTab,
      openSectorDetail,
      openPanel,
    }),
    [
      data,
      loading,
      error,
      selectedSector,
      panelTab,
      openSectorDetail,
      openPanel,
    ],
  );

  return (
    <Sp500SectorContext.Provider value={value}>{children}</Sp500SectorContext.Provider>
  );
}

export function useSp500Sector() {
  const ctx = useContext(Sp500SectorContext);
  if (!ctx) {
    throw new Error("useSp500Sector must be used within Sp500SectorProvider");
  }
  return ctx;
}

export function useSp500SectorOptional() {
  return useContext(Sp500SectorContext);
}
