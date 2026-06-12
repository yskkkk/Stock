import { STOCK_VAULT_SCAN_SOURCES } from "./stockVaultFilter";
import { normalizeStockVaultTimeframe } from "./stockVaultTimeframe";
import type { StockVaultScanSource, StockVaultTimeframe } from "../types";

export type Ma120ApproachFilter = "from_below" | "from_above";

export type StockVaultTabUiState = {
  filter: "all" | "favorite";
  selectedScanSources: StockVaultScanSource[];
  ma120ApproachFilter: Ma120ApproachFilter[];
  timeframeFilter: StockVaultTimeframe;
  marketFilter: "all" | "kr" | "us";
  industryFilter: string;
  selectedScanDate: string | null;
};

const UI_STORAGE_KEY = "stock-vault-tab-ui-v3";

let memoryUi: StockVaultTabUiState | null = null;

function normalizeScanSources(
  sources: StockVaultScanSource[] | undefined,
): StockVaultScanSource[] {
  if (!sources?.length) return ["golden_cross"];
  const allowed = new Set(STOCK_VAULT_SCAN_SOURCES);
  const picked = sources.filter((s) => allowed.has(s));
  return picked.length ? [...picked] : ["golden_cross"];
}

function normalizeMarketFilter(
  value: string | undefined,
): StockVaultTabUiState["marketFilter"] {
  if (value === "kr" || value === "us") return value;
  return "all";
}

function normalizeMa120ApproachFilter(
  value: Ma120ApproachFilter[] | undefined,
): Ma120ApproachFilter[] {
  if (!value?.length) return [];
  const allowed = new Set<Ma120ApproachFilter>(["from_below", "from_above"]);
  return value.filter((v) => allowed.has(v));
}

function normalizeUiState(raw: Partial<StockVaultTabUiState> | null): StockVaultTabUiState {
  return {
    filter: raw?.filter === "favorite" ? "favorite" : "all",
    selectedScanSources: normalizeScanSources(raw?.selectedScanSources),
    ma120ApproachFilter: normalizeMa120ApproachFilter(raw?.ma120ApproachFilter),
    timeframeFilter: normalizeStockVaultTimeframe(raw?.timeframeFilter),
    marketFilter: normalizeMarketFilter(raw?.marketFilter),
    industryFilter:
      typeof raw?.industryFilter === "string" && raw.industryFilter.trim()
        ? raw.industryFilter.trim()
        : "all",
    selectedScanDate:
      typeof raw?.selectedScanDate === "string" && raw.selectedScanDate.trim()
        ? raw.selectedScanDate.trim()
        : null,
  };
}

export function defaultStockVaultTabUi(): StockVaultTabUiState {
  return normalizeUiState(null);
}

export function peekStockVaultTabUi(): StockVaultTabUiState | null {
  if (memoryUi) return { ...memoryUi, selectedScanSources: [...memoryUi.selectedScanSources] };
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StockVaultTabUiState>;
    memoryUi = normalizeUiState(parsed);
    return {
      ...memoryUi,
      selectedScanSources: [...memoryUi.selectedScanSources],
    };
  } catch {
    return null;
  }
}

export function saveStockVaultTabUi(state: StockVaultTabUiState): void {
  const next = normalizeUiState(state);
  memoryUi = next;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(UI_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}
