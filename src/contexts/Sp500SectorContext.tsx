import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { fetchSp500Sectors } from "../api";
import type { Sp500SectorsPayload } from "../lib/sp500SectorChart";

const PANEL_OPEN_KEY = "ystock-sp500-sector-open-v1";

export type Sp500SectorPanelTab = "chart" | "list";

type Sp500SectorContextValue = {
  data: Sp500SectorsPayload | null;
  loading: boolean;
  error: string | null;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  selectedSector: string | null;
  setSelectedSector: (sector: string | null) => void;
  panelTab: Sp500SectorPanelTab;
  setPanelTab: (tab: Sp500SectorPanelTab) => void;
  openSectorDetail: (sector: string, tab?: Sp500SectorPanelTab) => void;
  openPanel: (tab?: Sp500SectorPanelTab) => void;
};

const Sp500SectorContext = createContext<Sp500SectorContextValue | null>(null);

function readPanelOpen(): boolean {
  try {
    return sessionStorage.getItem(PANEL_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function Sp500SectorProvider({
  children,
  panelRef,
}: {
  children: ReactNode;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const [data, setData] = useState<Sp500SectorsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpenState] = useState(readPanelOpen);
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

  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenState(open);
    try {
      sessionStorage.setItem(PANEL_OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const scrollToPanel = useCallback(() => {
    requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [panelRef]);

  const openPanel = useCallback(
    (tab: Sp500SectorPanelTab = "chart") => {
      setPanelTab(tab);
      setPanelOpen(true);
      scrollToPanel();
    },
    [scrollToPanel, setPanelOpen],
  );

  const openSectorDetail = useCallback(
    (sector: string, tab: Sp500SectorPanelTab = "list") => {
      setSelectedSector(sector);
      setPanelTab(tab);
      setPanelOpen(true);
      scrollToPanel();
    },
    [scrollToPanel, setPanelOpen],
  );

  const value = useMemo(
    () => ({
      data,
      loading,
      error,
      panelOpen,
      setPanelOpen,
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
      panelOpen,
      setPanelOpen,
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
