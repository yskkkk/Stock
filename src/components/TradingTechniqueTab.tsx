import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchStockVault } from "../api";
import StockVaultTab from "./StockVaultTab";
import { ko } from "../i18n/ko";
import { prefetchStockVaultTab } from "../lib/tabPrefetch";
import {
  countVaultItemsForTechnique,
  findTradingTechniqueEntry,
  TRADING_TECHNIQUE_ENTRIES,
} from "../lib/tradingTechniqueCatalog";
import {
  clearSelectedTechModelId,
  peekSelectedTechModelId,
  saveSelectedTechModelId,
} from "../lib/tradingTechniqueSession";
import type { StockVaultFavoriteMeta, StockVaultItem } from "../types";

export default function TradingTechniqueTab({
  onVaultChange,
}: {
  onVaultChange?: (
    symbols: string[],
    favoriteMeta?: Record<string, StockVaultFavoriteMeta>,
  ) => void;
}) {
  const [vaultItems, setVaultItems] = useState<StockVaultItem[]>([]);
  const [vaultLoading, setVaultLoading] = useState(true);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [selectedTechniqueId, setSelectedTechniqueId] = useState<string | null>(() =>
    peekSelectedTechModelId(),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setVaultLoading(true);
      setVaultError(null);
      try {
        const vault = await fetchStockVault();
        if (cancelled) return;
        setVaultItems(vault.items ?? []);
      } catch (e) {
        if (!cancelled) {
          setVaultError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setVaultLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedTechniqueId) return;
    void prefetchStockVaultTab().catch(() => {});
  }, [selectedTechniqueId]);

  const selectedEntry = useMemo(
    () => findTradingTechniqueEntry(selectedTechniqueId),
    [selectedTechniqueId],
  );

  const handleSelectTechnique = useCallback((id: string) => {
    setSelectedTechniqueId(id);
    saveSelectedTechModelId(id);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedTechniqueId(null);
    clearSelectedTechModelId();
  }, []);

  if (!selectedTechniqueId || !selectedEntry) {
    return (
      <div className="workspace stock-vault-tab trading-technique-tab">
        <section className="stock-vault-tab__panel card">
          <header className="stock-vault-tab__head">
            <h2 className="stock-vault-tab__title">{ko.tradingTechnique.title}</h2>
            <p className="stock-vault-tab__desc">{ko.tradingTechnique.selectDesc}</p>
          </header>
          {vaultLoading ? (
            <p className="stock-vault-tab__muted">{ko.tradingTechnique.loading}</p>
          ) : null}
          {vaultError ? (
            <p className="stock-vault-tab__error" role="alert">
              {vaultError}
            </p>
          ) : null}
          <ul className="trading-technique-tab__model-list">
            {TRADING_TECHNIQUE_ENTRIES.map((entry) => {
              const count = countVaultItemsForTechnique(vaultItems, entry);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="trading-technique-tab__model-btn"
                    onClick={() => handleSelectTechnique(entry.id)}
                  >
                    <span className="trading-technique-tab__model-name">{entry.name}</span>
                    <span className="trading-technique-tab__model-count">
                      {ko.tradingTechnique.discoveredCount(count)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <StockVaultTab
      onVaultChange={onVaultChange}
      techModelHeader={{
        name: selectedEntry.name,
        onBack: handleBack,
      }}
      vaultScanPreset={[...selectedEntry.scanSources]}
    />
  );
}
