import { STOCK_VAULT_SCAN_SOURCES } from "./stockVaultFilter";
import { normalizeStockVaultTimeframe } from "./stockVaultTimeframe";
import type { StockVaultScanSource, StockVaultTimeframe } from "../types";

export type StockVaultTabUiState = {
  filter: "all" | "favorite";
  selectedScanSources: StockVaultScanSource[];
  timeframeFilter: StockVaultTimeframe;
  marketFilter: "all" | "kr" | "us";
  industryFilter: string;
  selectedScanDate: string | null;
};

const UI_STORAGE_KEY = "stock-vault-tab-ui-v1";

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

function normalizeUiState(raw: Partial<StockVaultTabUiState> | null): StockVaultTabUiState {
  return {
    filter: raw?.filter === "favorite" ? "favorite" : "all",
    selectedScanSources: normalizeScanSources(raw?.selectedScanSources),
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
