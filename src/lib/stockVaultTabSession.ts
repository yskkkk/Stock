import { STOCK_VAULT_SCAN_SOURCES } from "./stockVaultFilter";
import { normalizeStockVaultTimeframe } from "./stockVaultTimeframe";
import type { StockVaultScanSource, StockVaultTimeframe } from "../types";

export type Ma120ApproachFilter = "from_below" | "from_above";

export type StockVaultTabUiState = {
  filter: "all" | "favorite";
  selectedScanSources: StockVaultScanSource[];
  /** null = 전체, 하단·상단 중 하나만 */
  ma120ApproachFilter: Ma120ApproachFilter | null;
  timeframeFilter: StockVaultTimeframe;
  marketFilter: "all" | "kr" | "us";
  industryFilter: string;
  selectedScanDate: string | null;
};

const UI_STORAGE_KEY = "stock-vault-tab-ui-v3";
const LOGIN_HINT_KEY = "stock-vault-login-hint-v1";

let memoryUi: StockVaultTabUiState | null = null;

function normalizeScanSources(
  sources: StockVaultScanSource[] | undefined,
): StockVaultScanSource[] {
  if (sources === undefined) return [];
  if (!sources.length) return [];
  const allowed = new Set(STOCK_VAULT_SCAN_SOURCES);
  return sources.filter((s) => allowed.has(s));
}

function normalizeMarketFilter(
  value: string | undefined,
): StockVaultTabUiState["marketFilter"] {
  if (value === "kr" || value === "us") return value;
  return "all";
}

function normalizeMa120ApproachFilter(
  value: Ma120ApproachFilter | Ma120ApproachFilter[] | null | undefined,
): Ma120ApproachFilter | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const picked = value.filter(
      (v): v is Ma120ApproachFilter => v === "from_below" || v === "from_above",
    );
    return picked.length ? picked[picked.length - 1]! : null;
  }
  if (value === "from_below" || value === "from_above") return value;
  return null;
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

export function shouldShowVaultLoginHint(): boolean {
  if (typeof sessionStorage === "undefined") return true;
  try {
    return !sessionStorage.getItem(LOGIN_HINT_KEY);
  } catch {
    return true;
  }
}

export function markVaultLoginHintShown(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(LOGIN_HINT_KEY, "1");
  } catch {
    /* quota */
  }
}

export function clearVaultLoginHintFlag(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(LOGIN_HINT_KEY);
  } catch {
    /* ignore */
  }
}
