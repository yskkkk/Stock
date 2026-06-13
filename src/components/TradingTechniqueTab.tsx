import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchStockVault, fetchTechModels, type TechModelRecord } from "../api";
import StockVaultTab from "./StockVaultTab";
import { ko } from "../i18n/ko";
import { peekLiveTradingPrefetch, prefetchStockVaultTab } from "../lib/tabPrefetch";
import {
  BOTTOM_CANDLE_MODEL_ID,
  isBottomCandleModelId,
  withBottomCandleTechModel,
} from "../lib/bottomCandleTechModel";
import {
  clearSelectedTechModelId,
  peekSelectedTechModelId,
  saveSelectedTechModelId,
} from "../lib/tradingTechniqueSession";
import type { PicksResponse, StockVaultFavoriteMeta, StockVaultItem } from "../types";

function allPickCountByModel(picks: PicksResponse | null): Map<string, number> {
  const counts = new Map<string, number>();
  if (!picks) return counts;
  for (const p of [...(picks.kr ?? []), ...(picks.us ?? []), ...(picks.crypto ?? [])]) {
    const id = p.techModelId?.trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function bottomCandleVaultCount(items: StockVaultItem[]): number {
  const seen = new Set<string>();
  for (const it of items) {
    if (it.source !== "bottom_candle") continue;
    seen.add(`${it.market}:${it.symbol.trim().toUpperCase()}:${it.timeframe ?? "1d"}`);
  }
  return seen.size;
}

export default function TradingTechniqueTab({
  picks,
  onVaultChange,
}: {
  picks: PicksResponse | null;
  onVaultChange?: (
    symbols: string[],
    favoriteMeta?: Record<string, StockVaultFavoriteMeta>,
  ) => void;
}) {
  const prefetched = peekLiveTradingPrefetch();
  const [models, setModels] = useState<TechModelRecord[]>(() =>
    withBottomCandleTechModel(prefetched?.techModels.models ?? []),
  );
  const [modelsLoading, setModelsLoading] = useState(() => models.length === 0);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() =>
    peekSelectedTechModelId(),
  );
  const [bottomCandleCount, setBottomCandleCount] = useState(0);

  useEffect(() => {
    if (models.length) return;
    let cancelled = false;
    void (async () => {
      setModelsLoading(true);
      setModelsError(null);
      try {
        const res = await fetchTechModels();
        if (cancelled) return;
        setModels(withBottomCandleTechModel(res.models ?? []));
      } catch (e) {
        if (!cancelled) {
          setModelsError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [models.length]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const vault = await fetchStockVault();
        if (cancelled) return;
        setBottomCandleCount(bottomCandleVaultCount(vault.items ?? []));
      } catch {
        /* ignore vault count */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedModelId) return;
    void prefetchStockVaultTab().catch(() => {});
  }, [selectedModelId]);

  const pickCounts = useMemo(() => allPickCountByModel(picks), [picks]);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const handleSelectModel = useCallback((id: string) => {
    setSelectedModelId(id);
    saveSelectedTechModelId(id);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedModelId(null);
    clearSelectedTechModelId();
  }, []);

  if (!selectedModelId) {
    return (
      <div className="workspace stock-vault-tab trading-technique-tab">
        <section className="stock-vault-tab__panel card">
          <header className="stock-vault-tab__head">
            <h2 className="stock-vault-tab__title">{ko.tradingTechnique.title}</h2>
            <p className="stock-vault-tab__desc">{ko.tradingTechnique.selectDesc}</p>
          </header>
          {modelsLoading ? (
            <p className="stock-vault-tab__muted">{ko.tradingTechnique.loading}</p>
          ) : null}
          {modelsError ? (
            <p className="stock-vault-tab__error" role="alert">
              {modelsError}
            </p>
          ) : null}
          {!modelsLoading && !modelsError && models.length === 0 ? (
            <p className="stock-vault-tab__muted">{ko.tradingTechnique.emptyModels}</p>
          ) : null}
          <ul className="trading-technique-tab__model-list">
            {models.map((m) => {
              const count = isBottomCandleModelId(m.id)
                ? bottomCandleCount
                : (pickCounts.get(m.id) ?? 0);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="trading-technique-tab__model-btn"
                    onClick={() => handleSelectModel(m.id)}
                  >
                    <span className="trading-technique-tab__model-name">{m.name}</span>
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
        name: selectedModel?.name ?? ko.tradingTechnique.title,
        onBack: handleBack,
      }}
      vaultScanPreset={
        isBottomCandleModelId(selectedModelId) ? [BOTTOM_CANDLE_MODEL_ID] : undefined
      }
    />
  );
}
